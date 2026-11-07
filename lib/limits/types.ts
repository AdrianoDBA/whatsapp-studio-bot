/**
 * Os tipos do TETO DE GASTO.
 *
 * ESTA É A CASA DOS TIPOS DE `lib/limits`. Os outros arquivos da pasta
 * reexportam daqui — ninguém redeclara. Mesma disciplina de
 * `lib/agents/types.ts`: quando o mesmo tipo existe em dois lugares com
 * formatos diferentes, quem importa do lugar errado só quebra em produção.
 *
 * ⚠️ DINHEIRO É INTEIRO, EM MICRO-DÓLARES. US$ 1,00 = 1.000.000.
 * `null` quer dizer "sem teto" (nos limites) ou "não deu pra calcular" (no
 * gasto) — NUNCA `0`, que significa "custou zero mesmo".
 *
 * Arquivo PURO e só de tipos: pode ser importado por página, por componente
 * com "use client" e por teste.
 */

/** Qual dos três tetos cortou. A precedência é: plataforma > mês > dia. */
export type BudgetBlockedBy = "mes" | "dia" | "plataforma";

/**
 * A resposta inteira de `org_ai_budget_status`: quanto pode, quanto já foi, se
 * está parado e por qual teto. Uma leitura só responde tudo.
 */
export type BudgetStatus = {
  /** "2026-08-01" — primeiro dia do mês, no fuso de São Paulo. */
  month: string;
  /** "2026-08-21" — hoje, no fuso de São Paulo. */
  day: string;
  monthlyBudgetMicros: number | null;
  dailyBudgetMicros: number | null;
  platformCapMicros: number | null;
  /** min(teto do workspace, teto da plataforma). `null` = sem teto. */
  effectiveMonthlyMicros: number | null;
  maxRunCostMicros: number | null;
  hardStop: boolean;
  alertAtPercent: number;
  monthSpentMicros: number;
  daySpentMicros: number;
  monthAgentMicros: number;
  monthEmbeddingMicros: number;
  /** Execuções/documentos sem preço no catálogo. NÃO entram na soma. */
  unpricedRuns: number;
  unpricedDocuments: number;
  /** `null` quando não existe teto mensal. Pode passar de 100. */
  percentUsed: number | null;
  /** Passou de algum teto (mesmo com o corte desligado). */
  overBudget: boolean;
  /** Passou E o corte se aplica: nada novo começa. */
  blocked: boolean;
  blockedBy: BudgetBlockedBy | null;
};

/** Um mês da âncora de histórico da tela ("vocês costumam gastar X"). */
export type MonthSpend = {
  /** "2026-08-01" — o primeiro dia daquele mês. */
  month: string;
  spentMicros: number;
};

/** Uma linha de `/plataforma/gastos`: quem está gastando a chave do dono. */
export type PlatformSpendRow = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  monthSpentMicros: number;
  unpricedRuns: number;
  monthlyBudgetMicros: number | null;
  platformCapMicros: number | null;
  percentUsed: number | null;
  usesOwnKey: boolean;
};

/**
 * Um dia do gráfico do Início ("quanto a IA custou ontem?").
 *
 * `day` é "2026-08-21", no calendário de São Paulo — o mesmo que a coluna
 * `day` de `org_ai_spend`. `spentMicros` é agente + embedding somados: pro
 * gráfico interessa quanto saiu do bolso, não de qual balde saiu.
 */
export type DaySpend = {
  day: string;
  spentMicros: number;
};
