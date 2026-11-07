/**
 * AS FRASES QUE O ALUNO LÊ QUANDO O TETO CORTA.
 *
 * Este arquivo é a parte da onda que separa "entendi, vou aumentar o limite" de
 * "quebrou tudo, socorro". Por isso ele tem teste próprio
 * (`tests/limits-messages.test.ts`): **mudar uma frase aqui é mudar o teste**,
 * de propósito.
 *
 * As cinco regras que TODAS elas seguem:
 *
 *   1. dizem **por que** parou;
 *   2. dizem que **nada quebrou** e nada foi perdido;
 *   3. dizem **quando volta sozinho**;
 *   4. dão **o caminho exato do menu** — ou mandam pedir pra quem tem acesso;
 *   5. **nunca** usam as palavras "erro", "falha", "bloqueado" ou "limite
 *      excedido". O teto não é defeito: é uma decisão que alguém tomou.
 *
 * Arquivo PURO: pode ser importado por componente com "use client" e por teste.
 */
import type { OrgRole } from "@/lib/agents/types";
import { formatTetoUsd } from "./money";
import { rotuloDaProximaVirada } from "./month";
import type { BudgetBlockedBy, BudgetStatus } from "./types";

/** O caminho do menu, escrito UMA vez. Se a tela mudar de lugar, muda aqui. */
const CAMINHO = "Configurações → Limites de IA";

/** Quem está do outro lado da frase. Não é o mesmo texto pra todo mundo. */
export type BudgetAudience =
  /** chat / botão "Rodar agora", pra quem PODE mudar o teto */
  | "pessoa-admin"
  /** chat / botão "Rodar agora", pra quem não pode */
  | "pessoa-membro"
  /** `schedules.last_error` e `jobs.last_error` */
  | "agendamento"
  /** o corpo do 429 */
  | "webhook"
  /** subir/indexar documento na base de conhecimento */
  | "documento";

/** A audiência certa pra uma pessoa, pelo papel dela no workspace. */
export function audienciaDoPapel(role: OrgRole): BudgetAudience {
  return role === "owner" || role === "admin" ? "pessoa-admin" : "pessoa-membro";
}

/** Essa pessoa consegue mudar o teto do workspace sozinha? */
export function podeMudarOTeto(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * O TETO QUE CORTOU, em micro-dólares.
 *
 * Não é sempre o do mês: quando quem cortou foi o freio do dia, o número que a
 * frase precisa mostrar é o do dia. Mostrar o do mês ali faria a pessoa
 * procurar um teto que não é o que parou o agente.
 */
export function tetoDoBloqueio(status: BudgetStatus): number | null {
  switch (status.blockedBy) {
    case "plataforma":
      return status.platformCapMicros;
    case "dia":
      return status.dailyBudgetMicros;
    default:
      return status.effectiveMonthlyMicros;
  }
}

/** Quanto já foi gasto no período do teto que cortou. */
export function gastoDoBloqueio(status: BudgetStatus): number {
  return status.blockedBy === "dia" ? status.daySpentMicros : status.monthSpentMicros;
}

/**
 * "(US$ 16,40 de US$ 20,00)" · "(US$ 20,00)" · "" quando não existe número
 * confiável pra mostrar.
 */
function entreParenteses(tetoMicros: number | null, gastoMicros: number | null): string {
  if (tetoMicros === null) return "";
  if (gastoMicros === null) return ` (${formatTetoUsd(tetoMicros)})`;
  return ` (${formatTetoUsd(gastoMicros)} de ${formatTetoUsd(tetoMicros)})`;
}

export type BudgetBlockedMessageArgs = {
  audience: BudgetAudience;
  blockedBy: BudgetBlockedBy;
  /**
   * O teto QUE CORTOU (mês, dia ou plataforma), não necessariamente o do mês.
   * `null` = não mostra número nenhum.
   */
  effectiveMicros: number | null;
  /**
   * Quanto já foi gasto no período desse teto.
   *
   * DIFERENÇA EM RELAÇÃO AO CONTRATO: ele não listava este campo, e sem ele a
   * frase A ("US$ 20,00 de US$ 20,00") não teria como sair — sobraria repetir o
   * teto duas vezes, que é justamente o número errado quando o corte está
   * desligado e o gasto já passou. É opcional: sem ele, a frase mostra só o
   * teto.
   */
  spentMicros?: number | null;
  /** Só pra teste conseguir fixar o "1º de setembro". */
  agora?: Date;
};

/**
 * A frase de "o teto cortou", escrita pra quem está lendo.
 *
 * Nunca lança e nunca devolve texto vazio: uma frase genérica é melhor que uma
 * tela sem explicação nenhuma.
 */
export function budgetBlockedMessage(args: BudgetBlockedMessageArgs): string {
  const { audience, blockedBy, effectiveMicros } = args;
  const gasto = args.spentMicros ?? null;
  const virada = rotuloDaProximaVirada(args.agora);
  const numeros = entreParenteses(effectiveMicros, gasto);
  const soOTeto = effectiveMicros === null ? "" : ` (${formatTetoUsd(effectiveMicros)})`;

  // -------------------------------------------------------------------------
  // Uma pessoa, olhando a tela (chat e botão "Rodar agora")
  // -------------------------------------------------------------------------
  if (audience === "pessoa-admin" || audience === "pessoa-membro") {
    const admin = audience === "pessoa-admin";

    if (blockedBy === "plataforma") {
      // Frase D: igual pros dois papéis DE PROPÓSITO. Este teto não muda aqui
      // dentro nem pra quem é dono do workspace — mandar ele "aumentar em
      // Configurações" seria mandar procurar um campo que não existe.
      return (
        "Os agentes deste workspace estão parados: foi atingido o limite de gasto com IA que " +
        `quem cuida do sistema definiu pra este workspace${soOTeto}. Esse limite não muda ` +
        `aqui dentro — fale com quem administra o sistema. Ele zera sozinho em ${virada}.`
      );
    }

    if (blockedBy === "dia") {
      return admin
        ? "Os agentes deste workspace estão parados até amanhã: vocês chegaram no teto de " +
            `gasto com IA de hoje${soOTeto}. Esse é o freio diário, pra um dia ruim não comer ` +
            "o mês inteiro. Ele zera à meia-noite (horário de Brasília) — ou você pode mudar " +
            `em ${CAMINHO}.`
        : "Os agentes deste workspace estão parados até amanhã: o time chegou no teto de " +
            "gasto com IA de hoje. Esse é o freio diário, pra um dia ruim não comer o mês " +
            "inteiro. Ele zera à meia-noite (horário de Brasília) — se precisar antes, peça " +
            `pra quem administra o workspace mudar o limite em ${CAMINHO}.`;
    }

    return admin
      ? "Os agentes deste workspace estão parados: vocês chegaram no teto de gasto com IA " +
          `deste mês${numeros}. Nada quebrou e nada foi perdido. O teto zera sozinho em ` +
          `${virada} — ou você pode aumentar agora em ${CAMINHO}.`
      : "Os agentes deste workspace estão parados: o time chegou no teto de gasto com IA " +
          `deste mês. Nada quebrou. O teto zera sozinho em ${virada} — se precisar antes, ` +
          `peça pra quem administra o workspace aumentar o limite em ${CAMINHO}.`;
  }

  // -------------------------------------------------------------------------
  // Agendamento: ninguém está olhando. A rodada é PULADA, não perdida.
  // -------------------------------------------------------------------------
  // A automação NÃO é desligada: o teto zera sozinho na virada, e desligar
  // deixaria ela morta esperando alguém lembrar de religar.
  if (audience === "agendamento") {
    if (blockedBy === "plataforma") {
      return (
        "A rodada de hoje foi pulada: foi atingido o limite de gasto com IA definido por quem " +
        "cuida do sistema. A automação continua ligada e volta sozinha na virada do mês. Esse " +
        "limite não muda aqui dentro — fale com quem administra o sistema."
      );
    }
    if (blockedBy === "dia") {
      return (
        "A rodada de hoje foi pulada: o workspace chegou no teto de gasto com IA de hoje. A " +
        "automação continua ligada e tenta de novo amanhã. Pra ela voltar antes, aumente o " +
        `teto em ${CAMINHO}.`
      );
    }
    return (
      "A rodada de hoje foi pulada: o workspace chegou no teto de gasto com IA deste mês. A " +
      "automação continua ligada e volta sozinha na virada do mês. Pra ela voltar antes, " +
      `aumente o teto em ${CAMINHO}.`
    );
  }

  // -------------------------------------------------------------------------
  // Webhook: do outro lado tem um SISTEMA esperando resposta HTTP.
  // -------------------------------------------------------------------------
  // Sem caminho de menu e sem número: quem lê isto é um programa, e o texto vai
  // parar num registro (log) de outra empresa.
  if (audience === "webhook") {
    if (blockedBy === "dia") {
      return (
        "Este workspace chegou no teto de gasto com IA de hoje. As chamadas voltam a ser " +
        "aceitas amanhã, à meia-noite (horário de Brasília)."
      );
    }
    if (blockedBy === "plataforma") {
      return (
        "Este workspace chegou no limite de gasto com IA definido por quem cuida do sistema. " +
        `As chamadas voltam a ser aceitas em ${virada}.`
      );
    }
    return (
      "Este workspace chegou no teto de gasto com IA deste mês. As chamadas voltam a ser " +
      `aceitas em ${virada}.`
    );
  }

  // -------------------------------------------------------------------------
  // Documento: indexar TAMBÉM gasta, e quase ninguém sabe disso.
  // -------------------------------------------------------------------------
  const quando = blockedBy === "dia" ? "à meia-noite, horário de Brasília" : virada;
  const qualTeto =
    blockedBy === "plataforma"
      ? "foi atingido o limite de gasto com IA definido por quem cuida do sistema"
      : blockedBy === "dia"
        ? "o workspace chegou no teto de gasto com IA de hoje"
        : "o workspace chegou no teto de gasto com IA deste mês";

  return (
    `Não dá pra indexar este arquivo agora: ${qualTeto}. Indexar também gasta — é a IA que ` +
    "lê o arquivo pra deixar ele pesquisável. O arquivo fica guardado; assim que o teto " +
    `zerar (${quando}) ou for aumentado, é só clicar em "Tentar de novo".`
  );
}

/**
 * O atalho que o motor, a fila e a indexação usam: a frase certa a partir do
 * status inteiro, sem ninguém precisar lembrar qual teto cortou.
 */
export function budgetBlockedMessageFromStatus(
  status: BudgetStatus,
  audience: BudgetAudience,
  agora?: Date,
): string {
  return budgetBlockedMessage({
    audience,
    blockedBy: status.blockedBy ?? "mes",
    effectiveMicros: tetoDoBloqueio(status),
    spentMicros: gastoDoBloqueio(status),
    agora,
  });
}

// ---------------------------------------------------------------------------
// A faixa do topo (aparece em TODA página dentro do workspace)
// ---------------------------------------------------------------------------

/** "aviso" = ainda dá tempo · "parado" = já cortou · "passou" = corte desligado. */
export type BudgetBannerTone = "aviso" | "parado" | "passou";

export type BudgetBanner = {
  tom: BudgetBannerTone;
  titulo: string;
  texto: string;
  /** Quem está lendo consegue mudar o teto? É isso que decide o botão da faixa. */
  podeMudar: boolean;
};

/**
 * A faixa do topo — ou `null` quando não há nada a dizer.
 *
 * Ela só aparece em três situações, nesta ordem de gravidade: parou, passou do
 * teto com o corte desligado, ou cruzou o aviso. Fora disso a tela fica limpa:
 * faixa que aparece sempre vira enfeite e ninguém lê.
 */
export function budgetBanner(status: BudgetStatus, role: OrgRole): BudgetBanner | null {
  const podeMudar = podeMudarOTeto(role);
  const virada = rotuloDaProximaVirada();
  const teto = tetoDoBloqueio(status);
  const comoAumentar = podeMudar
    ? `Dá pra aumentar em ${CAMINHO}.`
    : `Quem administra o workspace pode aumentar em ${CAMINHO}.`;

  // Frase I — parado.
  if (status.blocked) {
    if (status.blockedBy === "dia") {
      return {
        tom: "parado",
        titulo: "Os agentes deste workspace estão parados até amanhã.",
        texto:
          `O teto de gasto com IA de hoje (${formatTetoUsd(teto)}) acabou. Eles voltam ` +
          "sozinhos à meia-noite (horário de Brasília), ou agora, se o teto do dia subir.",
        podeMudar,
      };
    }
    if (status.blockedBy === "plataforma") {
      return {
        tom: "parado",
        titulo: "Os agentes deste workspace estão parados.",
        texto:
          `O limite de gasto com IA que quem cuida do sistema definiu (${formatTetoUsd(teto)}) ` +
          "acabou. Esse limite não muda aqui dentro — fale com quem administra o sistema. Ele " +
          `zera sozinho em ${virada}.`,
        // Nem quem é dono do workspace mexe no teto da plataforma.
        podeMudar: false,
      };
    }
    return {
      tom: "parado",
      titulo: "Os agentes deste workspace estão parados.",
      texto:
        `O teto de gasto com IA deste mês (${formatTetoUsd(teto)}) acabou. Eles voltam ` +
        `sozinhos em ${virada}, ou agora, se você aumentar o teto.`,
      podeMudar,
    };
  }

  // Frase J — passou do teto, mas o corte automático está desligado.
  //
  // ⚠️ Quem estourou pode ter sido o teto do DIA, não o do mês. Antes esta
  // frase falava sempre do mês: com teto do mês em "sem teto" e teto do dia
  // estourado, ela imprimia literalmente "US$ 6,00 de sem teto" e acusava um
  // estouro que não aconteceu.
  if (status.overBudget) {
    const diaEstourou =
      status.dailyBudgetMicros !== null && status.daySpentMicros >= status.dailyBudgetMicros;
    const mesEstourou =
      status.effectiveMonthlyMicros !== null &&
      status.monthSpentMicros >= status.effectiveMonthlyMicros;

    if (diaEstourou && !mesEstourou) {
      return {
        tom: "passou",
        titulo: "Vocês passaram do teto de gasto com IA de hoje.",
        texto:
          `${formatTetoUsd(status.daySpentMicros)} de ` +
          `${formatTetoUsd(status.dailyBudgetMicros)} hoje. Como o corte automático está ` +
          "desligado, os agentes continuam rodando e a conta continua subindo.",
        podeMudar,
      };
    }

    return {
      tom: "passou",
      titulo: "Vocês passaram do teto de gasto com IA deste mês.",
      texto:
        `${formatTetoUsd(status.monthSpentMicros)} de ` +
        `${formatTetoUsd(status.effectiveMonthlyMicros)}. Como o corte automático está ` +
        "desligado, os agentes continuam rodando e a conta continua subindo.",
      podeMudar,
    };
  }

  // Frase H — o aviso.
  if (status.percentUsed !== null && status.percentUsed >= status.alertAtPercent) {
    // Quando o teto que está apertando é o da PLATAFORMA, mandar a pessoa
    // "aumentar em Configurações → Limites de IA" é mandar ela pra uma tela
    // onde esse número não existe. Ela mexeria no teto errado e continuaria
    // parando no mesmo lugar.
    const daPlataforma =
      status.platformCapMicros !== null &&
      (status.monthlyBudgetMicros === null ||
        status.platformCapMicros <= status.monthlyBudgetMicros);

    return {
      tom: "aviso",
      titulo: `Vocês já usaram ${status.percentUsed}% do teto de gasto com IA deste mês.`,
      texto:
        `${formatTetoUsd(status.monthSpentMicros)} de ` +
        `${formatTetoUsd(status.effectiveMonthlyMicros)}. Quando chegar no teto, os agentes ` +
        `param até ${virada}. ` +
        (daPlataforma
          ? "Esse limite foi definido por quem cuida do sistema e não muda aqui dentro — " +
            "fale com essa pessoa."
          : comoAumentar),
      podeMudar: daPlataforma ? false : podeMudar,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Os textos fixos da tela de Limites
// ---------------------------------------------------------------------------

/** Frase K — execuções cujo modelo não está no catálogo de preços. */
export function textoExecucoesSemPreco(quantas: number): string | null {
  if (quantas <= 0) return null;
  const plural = quantas === 1 ? "execução usou" : "execuções usaram";
  return (
    `Além disso, ${quantas} ${plural} um modelo que não está na tabela de preços do ` +
    "template — elas não entram nessa conta. Em Execuções elas aparecem como " +
    '"preço desconhecido".'
  );
}

/** Frase L — o rodapé de honestidade. É o texto mais importante da tela. */
export const TEXTO_MEDIDOR_NAO_E_FATURA =
  "Esta conta é o medidor do seu app, não a fatura do provedor. Ela soma o que o template " +
  "calculou, execução por execução, no horário de Brasília. A fatura da Anthropic, da OpenAI " +
  "ou do OpenRouter fecha noutro fuso e arredonda de outro jeito. Os dois números são " +
  "parecidos, nunca iguais — na dúvida, o que vale é o do provedor.";

/** Frase M — por que o teto é em dólar. */
export const TEXTO_POR_QUE_EM_DOLAR =
  "Por que em dólar? Porque é em dólar que a conta chega. Converter pra real exigiria uma " +
  "cotação, e cotação parada faz o teto mentir quando o dólar mexe — aí você confiaria num " +
  "número errado. Aqui o número é o mesmo que o provedor cobra.";

/** Frase N — os dois freios de token, que não mudam por workspace (§5). */
export const TEXTO_FREIOS_DO_SISTEMA =
  "Além do teto, existem dois freios que não mudam por workspace: cada pessoa pode usar 50 " +
  "mil tokens de IA por dia, e a automação do workspace pode usar 500 mil por dia. Os dois " +
  "zeram à meia-noite (horário de Brasília).";

// ---------------------------------------------------------------------------
// "Isso aí foi o teto, não foi defeito"
// ---------------------------------------------------------------------------

/**
 * As duas marcas que TODA frase de teto carrega — as daqui e as que o BANCO
 * escreve em `schedules.last_error` (a migration `20260821040000`, seção 11).
 *
 * Elas são a mesma frase em dois lugares de propósito: quem pula a rodada é o
 * SQL, dentro da mesma transação que avança o relógio do agendamento, e
 * mandá-lo chamar o TypeScript pra escrever o texto seria trocar uma
 * duplicação visível por uma volta de rede que pode falhar.
 */
const MARCAS_DE_TETO = ["teto de gasto com ia", "limite de gasto com ia"] as const;

/**
 * Esse texto de `last_error` é uma RODADA PULADA por teto, e não uma falha?
 *
 * A tela de Automações precisa saber disso pra não pintar de vermelho uma
 * coisa que não quebrou: a automação continua ligada, o relógio dela andou, e
 * ela volta sozinha na virada. Um distintivo igual ao de "Deu errado" faria a
 * pessoa procurar defeito onde só existe uma decisão de gasto.
 *
 * ⚠️ É comparação de TEXTO, e isso é uma escolha. A alternativa seria uma
 * coluna nova em `schedules`/`jobs` só pra guardar o motivo — mudança de tabela
 * existente, num dado que já está escrito na frase.
 * `tests/limits-messages.test.ts` trava as duas pontas: as frases daqui e as
 * três do SQL, copiadas na mão.
 */
export function ehRecusaDeTeto(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const minusculo = texto.toLowerCase();
  return MARCAS_DE_TETO.some((marca) => minusculo.includes(marca));
}
