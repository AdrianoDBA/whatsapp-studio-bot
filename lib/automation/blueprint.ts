/**
 * "Plantas" de automação: agendamento e webhook descritos em CÓDIGO.
 *
 * Arquivo quase puro — só `gerarTokenDeWebhook` toca `node:crypto`, e ele já
 * era usado assim.
 *
 * 🔴 DUAS COISAS QUE O ARQUIVO NÃO DECIDE, e não é esquecimento:
 *
 *   • `modo` não é escrito, nos dois. O padrão do banco é `'ensaio'`, e é ele
 *     quem manda. Escrever a coluna daqui, mesmo com o valor certo, abriria a
 *     porta.
 *   • `is_active` do AGENDAMENTO sai SEMPRE `false`. Ligar automação é decisão
 *     de gente, numa tela que diz o que vai passar a acontecer (regra 10-L).
 *     Um campo aqui faria um `git push` disparar automação sem ninguém olhar.
 *
 *     O WEBHOOK é diferente — ver o comentário em `webhookParaInsert` — e
 *     nasce `is_active: true`: ele já nasce inutilizável (token sorteado e
 *     descartado), então não precisa de uma terceira trava sem chave nenhuma.
 *
 * ⚠️ `ScheduleBlueprint.entrega` NÃO é uma terceira coisa que o arquivo não
 * decide — é o oposto: é CONFIGURAÇÃO (o que o trabalho FAZ com o resultado,
 * igual horário e entrada), não decisão operacional (ligar/desligar). Por
 * isso ela é dona do arquivo, ao contrário de `modo` e `is_active`. Ver o
 * comentário completo no campo, em `ScheduleBlueprint`.
 */
import type { Json, TablesInsert } from "@/types/supabase";
import { type EntregaDeEntrada, entregaDeEntradaSchema } from "./entrega";
import { gerarTokenDeWebhook } from "./webhooks";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type ScheduleBlueprint = {
  /** Chave da materialização. Minúsculas, números e hífen. */
  slug: string;
  /** O nome que aparece na tela. 2 a 80 caracteres. */
  name: string;
  /** O apelido do agente que roda. Resolvido para `agent_id` na materialização. */
  agentSlug: string;
  kind: "daily" | "weekly" | "monthly" | "interval";
  /** 0 a 23. Obrigatório em `daily`, `weekly` e `monthly`. */
  hour?: number;
  /** 0 a 59. Obrigatório em `daily`, `weekly` e `monthly`. */
  minute?: number;
  /** 0 = domingo, 6 = sábado. De 1 a 7 dias. Obrigatório em `weekly`. */
  weekdays?: number[];
  /** 1 a 28 — não 31. Ver o comentário em `agendamentoParaInsert`. Obrigatório em `monthly`. */
  dayOfMonth?: number;
  /** 5 a 1440 (um dia). Obrigatório em `interval`. */
  everyMinutes?: number;
  timezone: string;
  input: Record<string, unknown>;
  /**
   * O que fazer com o resultado. Opcional — sem declarar, nasce
   * `{ tipo: "nenhuma" }` (fica só no histórico de Execuções).
   *
   * ⚠️ ISTO É CONFIGURAÇÃO, NÃO DECISÃO OPERACIONAL — por isso é dono do
   * ARQUIVO, ao contrário de `modo` e `is_active` (ver o bloco 🔴 no topo do
   * arquivo). Declarar `entrega: { tipo: "email", para: [...] }` aqui NÃO
   * faz nenhum email sair sozinho: o agendamento ainda nasce
   * `is_active: false` (só uma PESSOA liga, numa tela que diz o que vai
   * passar a acontecer — regra 10-L) e `modo` ainda nasce `'ensaio'` (nesse
   * modo `ctx.acao` não age de verdade — regra 10-K). São duas ações
   * humanas, em duas telas, antes de qualquer email existir.
   *
   * `EntregaDeEntrada`, NUNCA `Entrega` — a mesma restrição que a extinta
   * tela de criação usava: sem `"conexao"`, porque não existe catálogo de
   * conexão pra validar o `slug` contra (guardado pra "a onda das
   * conexões" — ver `lib/automation/entrega.ts`).
   */
  entrega?: EntregaDeEntrada;
};

export type WebhookBlueprint = {
  /** Chave da materialização. Minúsculas, números e hífen. */
  slug: string;
  /** O rótulo na tela. Até 80 caracteres. */
  label: string;
  /** O apelido do agente que roda. */
  agentSlug: string;
  /**
   * O chamador espera a resposta do agente, ou recebe "recebi" na hora?
   *
   * Escolhido no arquivo porque trocar depois muda o contrato de quem já está
   * chamando o endereço — e o arquivo é justamente onde uma mudança dessas fica
   * visível numa revisão, ATÉ o webhook nascer.
   *
   * ⚠️ DEPOIS DISSO, A VERDADE MUDA: `materializarWorkspace` nunca atualiza um
   * webhook que já existe (é insert-only — ver o comentário no topo de
   * `lib/seed/materializar.ts`). Mudar este campo no arquivo, pra um webhook
   * JÁ MATERIALIZADO, não chega nele — sem erro, sem aviso. Só afeta webhooks
   * NOVOS. Pra mudar um que já existe, é a tela.
   */
  esperarResposta: boolean;
};

function exigir(condicao: boolean, mensagem: string): void {
  if (!condicao) throw new Error(`blueprint de automação: ${mensagem}`);
}

function conferirApelido(slug: string): void {
  exigir(
    SLUG_RE.test(slug) && slug.length >= 2 && slug.length <= 60,
    `apelido "${slug}" fora do formato (minúsculas, números e hífen, de 2 a 60 caracteres)`,
  );
}

/**
 * Converte a entrada do agendamento pra `Json` DE VERDADE — não só o tipo.
 *
 * `Record<string, unknown>` pode ter `undefined`, função, `NaN` ou referência
 * circular, e nada disso é `Json`. O round-trip por `JSON.stringify` +
 * `JSON.parse` é a mesma ideia de `comoJson` em `lib/agents/engine.ts`:
 * normaliza os três primeiros do mesmo jeito que um `JSON.stringify` sozinho
 * já faria (undefined/função somem, `NaN` vira `null`) e transforma o quarto —
 * que do contrário lançaria um `TypeError` cru — numa mensagem legível.
 *
 * Devolve também o texto serializado, pra reaproveitar no teto de tamanho em
 * vez de serializar duas vezes.
 */
function serializarInput(input: Record<string, unknown>): { json: Json; texto: string } {
  let texto: string;
  try {
    texto = JSON.stringify(input);
  } catch {
    throw new Error(
      "blueprint de automação: a entrada do agendamento não é serializável em JSON (referência circular?)",
    );
  }
  return { json: JSON.parse(texto) as Json, texto };
}

export function agendamentoParaInsert(
  bp: ScheduleBlueprint,
  organizationId: string,
  agentId: string,
  runAs: string,
): TablesInsert<"schedules"> {
  conferirApelido(bp.slug);
  exigir(
    bp.name.trim().length >= 2 && bp.name.trim().length <= 80,
    `nome "${bp.name}" precisa ter de 2 a 80 caracteres`,
  );
  exigir(
    bp.timezone.length >= 1 && bp.timezone.length <= 64,
    "o fuso precisa ter de 1 a 64 caracteres",
  );
  const entrada = serializarInput(bp.input);
  exigir(entrada.texto.length <= 65_536, "a entrada do agendamento passa de 65.536 caracteres");

  // Sem declarar, vira `{ tipo: "nenhuma" }` — o mesmo padrão da coluna no
  // banco (`schedules_entrega_check`, `20260821110000_agente_que_age.sql`).
  // Validado com o MESMO schema que a extinta tela de criação usava
  // (`entregaDeEntradaSchema`): aceita `nenhuma` e `email`, nunca `conexao`.
  const entregaValidada = entregaDeEntradaSchema.safeParse(
    bp.entrega ?? { tipo: "nenhuma" as const },
  );
  if (!entregaValidada.success) {
    throw new Error(
      `blueprint de automação: entrega inválida — ${
        entregaValidada.error.issues[0]?.message ?? "confira o formato"
      }`,
    );
  }

  const precisaDeHorario = bp.kind !== "interval";
  if (precisaDeHorario) {
    exigir(
      Number.isInteger(bp.hour) && bp.hour! >= 0 && bp.hour! <= 23,
      `hora ${bp.hour} fora da faixa 0 a 23`,
    );
    exigir(
      Number.isInteger(bp.minute) && bp.minute! >= 0 && bp.minute! <= 59,
      `minuto ${bp.minute} fora da faixa 0 a 59`,
    );
  }
  if (bp.kind === "weekly") {
    // `schedules_weekdays_range` no banco: subconjunto de 0..6 E
    // `array_length(weekdays, 1) between 1 and 7`. Sem o teto de 7, uma lista
    // com repetição (ex.: sete zeros) passaria aqui e estouraria lá.
    exigir(
      Array.isArray(bp.weekdays) &&
        bp.weekdays.length >= 1 &&
        bp.weekdays.length <= 7 &&
        bp.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      "um agendamento semanal precisa de 1 a 7 dias da semana, de 0 (domingo) a 6 (sábado)",
    );
  }
  if (bp.kind === "monthly") {
    // `schedules_day_of_month_range` no banco vai só até 28, NÃO 31: 28 é o
    // maior dia que existe em TODO mês, fevereiro incluso. "Dia 31" pularia
    // meses inteiros calado — o mesmo motivo do comentário na migration.
    exigir(
      Number.isInteger(bp.dayOfMonth) && bp.dayOfMonth! >= 1 && bp.dayOfMonth! <= 28,
      `dia do mês ${bp.dayOfMonth} fora da faixa 1 a 28 (o teto é 28, não 31 — é o maior dia que existe em todo mês)`,
    );
  }
  if (bp.kind === "interval") {
    // `schedules_every_minutes_range` no banco: 5 a 1440. 1440 é um dia
    // inteiro em minutos; abaixo de 5 o próprio banco já recusa.
    exigir(
      Number.isInteger(bp.everyMinutes) && bp.everyMinutes! >= 5 && bp.everyMinutes! <= 1440,
      `intervalo de ${bp.everyMinutes} minuto(s) fora da faixa 5 a 1440`,
    );
  }

  return {
    organization_id: organizationId,
    agent_id: agentId,
    run_as: runAs,
    created_by: runAs,
    slug: bp.slug,
    name: bp.name.trim(),
    kind: bp.kind,
    hour: precisaDeHorario ? bp.hour! : null,
    minute: precisaDeHorario ? bp.minute! : null,
    weekdays: bp.kind === "weekly" ? bp.weekdays! : null,
    day_of_month: bp.kind === "monthly" ? bp.dayOfMonth! : null,
    every_minutes: bp.kind === "interval" ? bp.everyMinutes! : null,
    timezone: bp.timezone,
    // O JSON de verdade, não o `Record<string, unknown>` original — ver
    // `serializarInput`.
    input: entrada.json,
    // Configuração, dona do arquivo — ver o comentário de `entrega` em
    // `ScheduleBlueprint`. Não é a mesma classe de coisa que `is_active`,
    // logo abaixo (que É protegida pelo bloco 🔴 no topo do arquivo).
    entrega: entregaValidada.data,
    // Ver o bloco 🔴 no topo do arquivo.
    is_active: false,
  };
}

export function webhookParaInsert(
  bp: WebhookBlueprint,
  organizationId: string,
  agentId: string,
  runAs: string,
): TablesInsert<"webhook_endpoints"> {
  conferirApelido(bp.slug);
  exigir(bp.label.length <= 80, "o rótulo passa de 80 caracteres");

  /* 🔴 SORTEADO E DESCARTADO. O endpoint nasce com um segredo que ninguém viu,
     ou seja, inutilizável — e é isso que torna seguro declarar webhook em
     arquivo versionado. Quem precisa do endereço aperta "gerar token" na tela,
     que sorteia outro e mostra uma vez. A URL não muda, porque ela vem do `id`
     (`montarUrlDoWebhook`). */
  const novo = gerarTokenDeWebhook();

  return {
    organization_id: organizationId,
    agent_id: agentId,
    run_as: runAs,
    created_by: runAs,
    slug: bp.slug,
    label: bp.label,
    token_hash: novo.tokenHash,
    token_prefix: novo.tokenPrefix,
    // 🔴 `is_active: true`, e NÃO É DESCUIDO DA REGRA 10-L.
    //
    // O webhook não precisa nascer desligado, porque ele já nasce
    // INUTILIZÁVEL: o token é sorteado e ninguém o vê, então nenhuma chamada
    // de fora consegue passar. Somado a `modo = 'ensaio'` (padrão do banco),
    // são duas travas de verdade. `is_active: false` seria uma terceira, SEM
    // CHAVE — não existe tela que ligue webhook (ver `lib/automation/CLAUDE.md`,
    // regra 15): um endereço materializado com `is_active: false` nasceria
    // inalcançável PRA SEMPRE, porque nada no produto liga essa coluna de
    // volta pra webhook.
    //
    // A regra 10-L continua respeitada: o ato humano que ARMA o endereço é
    // gerar o token, e o que o faz AGIR DE VERDADE é trocar pro modo real. Os
    // dois são decisão de gente, numa tela.
    is_active: true,
    esperar_resposta: bp.esperarResposta,
  };
}
