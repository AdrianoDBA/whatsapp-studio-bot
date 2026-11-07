/**
 * Leva as declarações de `lib/seed/registro.ts` para dentro de um workspace.
 *
 * Roda em dois momentos: quando um workspace nasce (`createOrganizationAction`)
 * e por `npm run semear`, pros que já existem — inclusive sozinho, a cada
 * deploy. Ou seja: rodar duas vezes é o caso NORMAL.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  ESTE ARQUIVO É SÓ A LISTA DO QUE EXISTE. O ALGORITMO MORA EM             │
 * │  `recurso.ts`, escrito UMA vez, e os quatro tipos abaixo o usam.          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Cada `RECURSO_*` abaixo responde cinco perguntas e mais nada: em que tabela
 * isso mora, de que colunas o ARQUIVO é dono, como virar linha, o que o aluno
 * lê quando dá errado, e se tem algum caso especial. Quem faz o trabalho —
 * ler, comparar, gravar, atualizar, pular, relatar — é `materializarRecurso`.
 *
 * ⚠️ PRA ACRESCENTAR UM QUINTO TIPO (o CRM que o aluno vai pedir, o catálogo
 * de produtos, o que for): escreva a "planta" e a função que vira linha, ponha
 * a tabela em `TabelaDeclarada` (`recurso.ts`), declare um `RECURSO_*` aqui e
 * chame ele em `materializarWorkspace`. Você NÃO reescreve o algoritmo, e é
 * de propósito: as ~120 linhas que você não vai copiar são exatamente onde os
 * dois defeitos conhecidos deste mecanismo nasceram.
 *
 * ⚠️ ESTE ARQUIVO FALA COM O BANCO PELA PONTE. `npm run semear`
 * (`lib/seed/semear.ts`) chama esta função com um `db` impersonado, cujo
 * `fetch` é `lib/automation/postgrest-bridge.ts` — não a API de verdade do
 * Supabase. A ponte só entende um SUBCONJUNTO do PostgREST (regra 10-G). Como
 * as chamadas ao banco agora moram TODAS em `recurso.ts`, a disciplina é lá
 * (e está escrita lá): aqui não tem nenhuma. O SINTOMA de errar aquilo:
 * funciona ao criar o workspace (sessão normal) e quebra no `npm run semear`
 * (sessão pela ponte).
 *
 * 🔴 NÃO É `upsert` CEGO — e não é só cautela, é o único jeito que FUNCIONA.
 * Três motivos, os três descobertos rodando revisão contra o banco de
 * verdade, não lendo o código:
 *
 *   1. **`schedules` tem índice PARCIAL** em `(organization_id, slug)` —
 *      `where slug is not null` (linha órfã, criada à mão antes deste
 *      caminho existir, nunca conta como duplicata). Um `.upsert({onConflict})`
 *      do supabase-js não sabe emitir o `WHERE` que a inferência de
 *      `ON CONFLICT` exige pra usar um índice parcial como árbitro — o
 *      Postgres recusa com `42P10` (nenhuma restrição única bate), NA
 *      PRIMEIRA execução, mesmo sem conflito nenhum ainda existir.
 *   2. **`created_by` é IMUTÁVEL** em `agents` e `schedules` (gatilho
 *      `freeze_org_and_creator`, `20260525000014_security_hardening_a.sql`).
 *      Um `upsert` cujo ramo de conflito dispare UPDATE tenta reescrever
 *      `created_by` pro `ownerId` de quem rodou desta vez — se for alguém
 *      diferente de quem criou a linha da primeira vez, o gatilho recusa, e
 *      NENHUMA tela conserta essa coluna (ela é imutável de propósito).
 *   3. **Automação desligada por decisão de gente não pode voltar a desligada
 *      sozinha.** `agendamentoParaInsert` grava `is_active: false` sempre —
 *      certo na CRIAÇÃO, mas um `upsert` cego carrega esse `false` pro ramo de
 *      UPDATE também, e um `npm run semear` de rotina desligaria a automação
 *      que uma pessoa ligou na tela, calado.
 *
 * QUEM É DONO DE QUÊ (a matriz que `colunas`, em cada recurso, materializa):
 *
 *   - **O arquivo** (reescreve toda materialização): nome, descrição, prompt,
 *     modelo, temperatura, `max_steps`, `max_output_tokens`, ferramentas e
 *     `status` nos agentes; nome e descrição nas bases; `agent_id`, nome,
 *     tipo, horário, dias, input, fuso e `entrega` nos agendamentos —
 *     `agent_id` porque ele vem do apelido (`agentSlug`) que o arquivo
 *     declara, igual na criação.
 *   - **A pessoa, pela tela** (nunca aqui): `is_active`, `modo`, `run_as`.
 *   - **O banco** (nunca aqui, alguns imutáveis por gatilho): `created_by`,
 *     `organization_id`, `slug` — e nas bases também `embedding_model`,
 *     congelado por `freeze_knowledge_base_slug` (regra 10-I).
 *
 * 🔴 WEBHOOK NÃO RE-MATERIALIZA NADA (`soInsere: true`) — é a única tabela
 * 100% INSERT-ONLY. Consequência que precisa ficar dita, não só implícita:
 * mudar `esperarResposta` (ou `agentSlug`) no arquivo pra um webhook que JÁ
 * EXISTE não chega nele — sem erro, sem aviso. Pra mudar um que já existe, é
 * a tela. Motivo: `webhookParaInsert` sorteia um token novo a cada chamada
 * (reescrever trocaria o segredo de um endereço que sistemas de fora já estão
 * chamando), e `webhook_endpoints` nega `grant update (slug)` de propósito.
 *
 * 🔴 N1 — UPDATE de agendamento pode ser recusado pela REGRA DE SEGURANÇA do
 * banco, e isso não é bug daqui. A policy `admins update schedules` tem `with
 * check` com TRÊS condições — `has_org_role(...)`, `auth.uid() = run_as` e
 * `agent_belongs_to_org(...)` — e o Postgres avalia isso contra a LINHA NOVA
 * INTEIRA, não só as colunas do `SET`. DECISÃO DO DONO DO PRODUTO: não
 * afrouxar a policy, não criar `security definer` novo, não abrir ponte de
 * impersonação — PULA aquela linha (`vaiSerRecusado` + `pularQuandoRecusado`,
 * no recurso dos agendamentos), segue com as outras, e RELATA em
 * `ResultadoDaSemeadura.agendamentosPulados`.
 *
 * NUNCA APAGA. Uma linha que existe no banco e não existe mais em código fica
 * onde está, órfã e intocada — e `slug is null` marca as que nasceram à mão,
 * antes deste caminho existir.
 *
 * A ORDEM IMPORTA: automação aponta pra agente por `agent_id`, e o `id` só
 * existe depois que o agente foi lido ou gravado. Por isso agentes primeiro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentBlueprint } from "@/lib/agents/blueprint";
import { blueprintToInsert } from "@/lib/agents/blueprint";
import type { ScheduleBlueprint, WebhookBlueprint } from "@/lib/automation/blueprint";
import { agendamentoParaInsert, webhookParaInsert } from "@/lib/automation/blueprint";
import type { KnowledgeBaseBlueprint } from "@/lib/knowledge/blueprint";
import { baseParaInsert } from "@/lib/knowledge/blueprint";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";
import type { LinhaExistente, Recurso } from "./recurso";
import { materializarRecurso } from "./recurso";
import { AGENDAMENTOS, AGENTES, BASES, WEBHOOKS } from "./registro";

/**
 * Quantas linhas de cada tipo ficaram vivas e em dia nesta chamada — soma de
 * recém-inseridas com recém-atualizadas OU já sincronizadas (não é "quantas
 * o banco devolveu", nem só "quantas são novas"). Órfã e abandonada (ver o
 * comentário no topo do arquivo) não entram na conta: elas não foram
 * tocadas. Agendamento PULADO também não entra: ele ficou vivo, mas não em
 * dia.
 */
export type ResultadoDaSemeadura = {
  agentes: number;
  bases: number;
  agendamentos: number;
  webhooks: number;
  /**
   * Apelidos de agendamento que já existiam, tinham mudança de verdade no
   * arquivo, mas o UPDATE não foi confirmado — previsto (roda no nome de
   * outra pessoa: `run_as !== ownerId`) ou descoberto na hora (a regra de
   * segurança recusou por outro motivo, ou bateu em zero linhas em silêncio).
   * DECISÃO DO DONO DO PRODUTO: pula a linha, não derruba a materialização
   * inteira, relata aqui.
   *
   * ⚠️ `run_as` pode ser `null` — a pessoa saiu do workspace (`run_as uuid
   * references auth.users(id) on delete set null`). `null !== ownerId` é
   * sempre verdade, então cai no mesmo "previsto": comportamento CORRETO
   * (ninguém confirma autorização em nome de uma conta que sumiu), mas a
   * metade "peça pra ela rodar" da mensagem fica inacionável — não tem "ela"
   * pra pedir. A segunda metade ("assuma na tela de Automações") continua
   * valendo, e é a única saída pra este caso.
   */
  agendamentosPulados: string[];
};

// ---------------------------------------------------------------------------
// Os quatro tipos que este produto declara
// ---------------------------------------------------------------------------

/**
 * `ownerId` entra em `paraInserir` porque `created_by` é coluna do BANCO,
 * escrita só no INSERT. Ele nunca aparece em `colunas`: reescrever
 * `created_by` numa re-materialização bateria no gatilho de imutabilidade.
 */
export function recursoDosAgentes(
  organizationId: string,
  ownerId: string,
): Recurso<AgentBlueprint, "agents"> {
  return {
    tabela: "agents",
    descricao: "os agentes",
    mensagemAoGravar: "não deu pra gravar os agentes deste workspace",
    mensagemAoAtualizar: "não deu pra atualizar os agentes deste workspace",
    colunas: [
      "name",
      "description",
      "system_prompt",
      "model",
      "temperature",
      "max_steps",
      "max_output_tokens",
      "tools",
      "status",
    ],
    colunasDoBanco: ["organization_id", "created_by", "slug"],
    colunasDaPessoa: [],
    apelido: (bp) => bp.slug,
    paraInserir: (bp) => blueprintToInsert(bp, organizationId, ownerId),
  };
}

/**
 * A mensagem de erro carrega a saída da regra 10-I, e carrega nos DOIS casos
 * (gravar e atualizar): o modelo de embedding é congelado por gatilho assim
 * que a base nasce, e "crie outra base" é literalmente a única saída — se a
 * frase não disser isso, o aluno fica tentando editar o arquivo pra sempre.
 */
export function recursoDasBases(
  organizationId: string,
  ownerId: string,
): Recurso<KnowledgeBaseBlueprint, "knowledge_bases"> {
  const mensagem =
    "não deu pra gravar as bases de conhecimento deste workspace. Se mudou o modelo de " +
    "embedding de uma base que já existe, esse valor é congelado assim que a base nasce — " +
    "crie outra base, com outro apelido, e suba os arquivos de novo.";

  return {
    tabela: "knowledge_bases",
    descricao: "as bases de conhecimento",
    mensagemAoGravar: mensagem,
    mensagemAoAtualizar: mensagem,
    colunas: ["name", "description", "status"],
    // `embedding_model` e o apelido sao CONGELADOS por gatilho assim que a
    // base nasce (regra 10-I): reescrever e recusado pelo banco, de proposito.
    colunasDoBanco: ["organization_id", "created_by", "slug", "embedding_model"],
    colunasDaPessoa: [],
    apelido: (bp) => bp.slug,
    paraInserir: (bp) => baseParaInsert(bp, organizationId, ownerId),
  };
}

/**
 * `run_as` entra na LEITURA (pra prever que a regra de segurança vai recusar)
 * mas NUNCA em `colunas` — quem decide em nome de quem a automação roda é a
 * pessoa, na tela.
 *
 * `agent_id` ENTRA em `colunas`: ele vem do apelido (`agentSlug`) que o
 * arquivo declara. Deixar de fora faria um agendamento continuar apontando
 * pro agente antigo pra sempre, mesmo depois de alguém trocar `agentSlug` em
 * código — o oposto de "quem manda é o arquivo".
 */
export function recursoDosAgendamentos(
  organizationId: string,
  ownerId: string,
  idPorApelido: Map<string, string>,
): Recurso<ScheduleBlueprint, "schedules"> {
  return {
    tabela: "schedules",
    descricao: "os agendamentos",
    mensagemAoGravar: "não deu pra gravar os agendamentos deste workspace",
    mensagemAoAtualizar: "não deu pra atualizar os agendamentos deste workspace",
    colunas: [
      "agent_id",
      "name",
      "kind",
      "hour",
      "minute",
      "weekdays",
      "day_of_month",
      "every_minutes",
      "timezone",
      "input",
      "entrega",
    ],
    colunasSoDeLeitura: ["run_as"],
    colunasDoBanco: ["organization_id", "created_by", "slug"],
    colunasDaPessoa: ["run_as", "is_active"],
    apelido: (bp) => bp.slug,
    paraInserir: (bp) =>
      agendamentoParaInsert(bp, organizationId, idPorApelido.get(bp.agentSlug)!, ownerId),
    /*
     * PREVISÃO, não classificação de erro por texto. Se `atual.run_as` não
     * bate com `ownerId`, a policy `admins update schedules` vai recusar de
     * qualquer jeito (o `with check` dela exige `auth.uid() = run_as`), então
     * nem tenta.
     *
     * Por que dá pra comparar direto com `ownerId`, sem consultar
     * `auth.uid()`: SE esta chamada estiver sujeita à regra de segurança
     * (autenticada como uma pessoa), então `ownerId === auth.uid()` já é
     * PRÉ-CONDIÇÃO pra ter chegado aqui — a policy de INSERT exige
     * `auth.uid() = created_by and auth.uid() = run_as`, e
     * `agendamentoParaInsert` grava os dois como `ownerId`. Logo, se `ownerId`
     * não fosse `auth.uid()` de quem chama, nem a PRIMEIRA materialização
     * teria criado esta linha.
     */
    vaiSerRecusado: (atual: LinhaExistente) => atual.run_as !== ownerId,
    pularQuandoRecusado: true,
  };
}

export function recursoDosWebhooks(
  organizationId: string,
  ownerId: string,
  idPorApelido: Map<string, string>,
): Recurso<WebhookBlueprint, "webhook_endpoints"> {
  return {
    tabela: "webhook_endpoints",
    descricao: "os webhooks",
    mensagemAoGravar: "não deu pra gravar os webhooks deste workspace",
    mensagemAoAtualizar: "não deu pra atualizar os webhooks deste workspace",
    // Vazia de propósito: com `soInsere`, nada é reescrito — nem o token, que
    // é o motivo (ver o bloco 🔴 no topo do arquivo).
    colunas: [],
    // Declarados no arquivo, gravados SO AO NASCER: mudar qualquer um deles
    // no arquivo nao chega num webhook que ja existe (ver o bloco no topo).
    colunasSoAoNascer: ["agent_id", "label", "esperar_resposta"],
    // `token_hash`/`token_prefix` sao do BANCO: quem troca o segredo e a acao
    // humana "Gerar token", nunca uma re-materializacao.
    colunasDoBanco: ["organization_id", "created_by", "slug", "token_hash", "token_prefix"],
    colunasDaPessoa: ["run_as", "is_active"],
    soInsere: true,
    apelido: (bp) => bp.slug,
    paraInserir: (bp) =>
      webhookParaInsert(bp, organizationId, idPorApelido.get(bp.agentSlug)!, ownerId),
  };
}

/**
 * Automação que aponta pra um agente que não foi resolvido nesta chamada é
 * DESCARTADA, não gravada com id inventado.
 *
 * `tests/seed-registro.test.ts` já reprova apelido inexistente no `npm run
 * verify`, então chegar aqui com um apelido não resolvido significa que o
 * insert/update de agentes falhou pela metade — logado, nunca calado, mesmo
 * não sendo um erro que interrompe a materialização.
 */
function resolvidosPorAgente<Bp extends { agentSlug: string }>(
  plantas: readonly Bp[],
  idPorApelido: Map<string, string>,
  /** No plural — é a chave que aparece no registro: `seed.agendamentos.apelido`. */
  chaveDoRegistro: string,
  /** No singular — entra na frase: "2 agendamento(s) descartado(s)". */
  oQueE: string,
): readonly Bp[] {
  const resolvidos = plantas.filter((bp) => idPorApelido.has(bp.agentSlug));
  if (resolvidos.length !== plantas.length) {
    logError(
      `seed.${chaveDoRegistro}.apelido`,
      new Error(
        `${plantas.length - resolvidos.length} ${oQueE}(s) descartado(s): apelido de agente não resolvido nesta materialização`,
      ),
    );
  }
  return resolvidos;
}

// ---------------------------------------------------------------------------

export async function materializarWorkspace(
  db: SupabaseClient<Database>,
  organizationId: string,
  ownerId: string,
): Promise<ResultadoDaSemeadura> {
  const agentes = await materializarRecurso(
    db,
    organizationId,
    recursoDosAgentes(organizationId, ownerId),
    AGENTES,
  );
  // Os `id` dos agentes: é o que amarra automação a agente, e por isso os
  // agentes vêm primeiro.
  const idPorApelido = agentes.idPorApelido;

  const bases = await materializarRecurso(
    db,
    organizationId,
    recursoDasBases(organizationId, ownerId),
    BASES,
  );

  const agendamentos = await materializarRecurso(
    db,
    organizationId,
    recursoDosAgendamentos(organizationId, ownerId, idPorApelido),
    resolvidosPorAgente(AGENDAMENTOS, idPorApelido, "agendamentos", "agendamento"),
  );

  const webhooks = await materializarRecurso(
    db,
    organizationId,
    recursoDosWebhooks(organizationId, ownerId, idPorApelido),
    resolvidosPorAgente(WEBHOOKS, idPorApelido, "webhooks", "webhook"),
  );

  return {
    agentes: agentes.tocados,
    bases: bases.tocados,
    agendamentos: agendamentos.tocados,
    webhooks: webhooks.tocados,
    agendamentosPulados: agendamentos.pulados,
  };
}
