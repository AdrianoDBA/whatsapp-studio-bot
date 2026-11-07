/**
 * A LEITURA DO GASTO: quanto este workspace já gastou e quanto ainda pode.
 *
 * Uma leitura só (`org_ai_budget_status`) responde tudo o que o motor e a tela
 * precisam saber: o teto do mês, o do dia, o da plataforma, quanto já foi,
 * quantos porcento, se está parado e por qual dos três tetos. Ela custa uma
 * busca por chave primária mais a soma de no máximo 31 linhas — o caminho caro
 * (somar `agent_runs` na hora) foi justamente o descartado no contrato.
 *
 * ⚠️ `getBudgetStatus` NUNCA LANÇA. Ela devolve `null` quando a leitura falhou,
 * e quem chama decide o que fazer. O motor escolheu DEIXAR PASSAR nesse caso
 * (está comentado lá): uma falha momentânea de leitura parando todos os agentes
 * de todos os workspaces seria muito pior do que uma execução a mais entrando
 * depois da linha — e quem soma o gasto de verdade é o banco, na hora de
 * fechar, que continua somando.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com "use client".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";
import { diaISOAtras, inicioDoMesISO, mesDoDia } from "./month";
import type {
  BudgetBlockedBy,
  BudgetStatus,
  DaySpend,
  MonthSpend,
  PlatformSpendRow,
} from "./types";

/**
 * A linha crua de `org_ai_budget_status`.
 *
 * Os tipos gerados do banco marcam TUDO como não-nulo (o gerador não sabe
 * dizer quais colunas de um `returns table` aceitam nulo), e várias aceitam:
 * `monthly_budget_micros` é nulo quando não existe teto, `percent_used` é nulo
 * quando não existe teto nenhum, `blocked_by` é nulo quando nada cortou. Este
 * tipo é o mesmo formato, só que honesto.
 */
export type LinhaDeStatus = {
  month: Diaish;
  day: Diaish;
  monthly_budget_micros: Numerico;
  daily_budget_micros: Numerico;
  platform_cap_micros: Numerico;
  effective_monthly_micros: Numerico;
  max_run_cost_micros: Numerico;
  hard_stop: boolean | null;
  alert_at_percent: Numerico;
  month_spent_micros: Numerico;
  day_spent_micros: Numerico;
  month_agent_micros: Numerico;
  month_embedding_micros: Numerico;
  unpriced_runs: Numerico;
  unpriced_documents: Numerico;
  percent_used: Numerico;
  over_budget: boolean | null;
  blocked: boolean | null;
  blocked_by: string | null;
};

/**
 * Número que veio do banco — e ele chega de dois jeitos.
 *
 * ⚠️ PELA API (PostgREST) um `bigint` vira NÚMERO no JSON; pela conexão direta
 * do trabalhador (`pg`), vira TEXTO — o driver não converte `int8` sozinho, pra
 * não perder precisão em número gigante. Os dois caminhos leem o mesmo teto,
 * então quem converte é este arquivo, num lugar só. Sem isto, `"20000000" >=
 * 20000000` no TypeScript compararia texto com número e o teto do trabalhador
 * decidiria errado.
 */
type Numerico = number | string | null | undefined;

/**
 * Um dia do banco — e ele TAMBÉM chega de dois jeitos.
 *
 * ⚠️ Pela API vem o texto `"2026-08-21"`; pela conexão direta do trabalhador
 * (`pg`), vem um `Date` já montado na meia-noite LOCAL da máquina. Passar esse
 * `Date` por `toISOString()` mudaria o dia em qualquer servidor que não esteja
 * em UTC — que é o caso do container. Por isso a volta pro texto usa os campos
 * locais, que são o inverso exato do que o driver montou.
 */
type Diaish = string | Date | null | undefined;

function diaIso(valor: Diaish): string {
  if (typeof valor === "string") return valor.slice(0, 10);
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const mes = `${valor.getMonth() + 1}`.padStart(2, "0");
    const dia = `${valor.getDate()}`.padStart(2, "0");
    return `${valor.getFullYear()}-${mes}-${dia}`;
  }
  return "";
}

/** Número que veio do banco: inteiro, ou `null` quando a coluna aceita nulo. */
function inteiroOuNulo(valor: Numerico): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? Math.trunc(valor) : null;
  if (typeof valor !== "string" || valor.trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** O mesmo, mas pra número que NÃO pode ser nulo (gasto acumulado, contagem). */
function inteiroOuZero(valor: Numerico): number {
  return inteiroOuNulo(valor) ?? 0;
}

function comoBlockedBy(bruto: string | null | undefined): BudgetBlockedBy | null {
  return bruto === "mes" || bruto === "dia" || bruto === "plataforma" ? bruto : null;
}

/**
 * O teto e o medidor deste workspace, agora.
 *
 * `null` = não deu pra ler (e aí quem chama decide). NUNCA lança.
 *
 * ⚠️ O `supabase` é OBRIGATÓRIO e explícito, igual ao do motor: numa execução
 * agendada quem fala com o banco é o cliente da ponte, e um `createClient()`
 * escondido aqui dentro leria o teto com a sessão errada (ou sem sessão
 * nenhuma).
 */
export async function getBudgetStatus(args: {
  organizationId: string;
  supabase: SupabaseClient<Database>;
}): Promise<BudgetStatus | null> {
  const { data, error } = await args.supabase.rpc("org_ai_budget_status", {
    _organization_id: args.organizationId,
  });

  if (error) {
    logError("limits.getBudgetStatus", error);
    return null;
  }

  const linha: LinhaDeStatus | undefined = (data ?? [])[0];
  if (!linha) return null;

  return budgetStatusDaLinha(linha);
}

/**
 * A linha crua de `org_ai_budget_status` → o formato que o app usa.
 *
 * Exportada porque DOIS caminhos leem a mesma função do banco: as telas e o
 * motor, pela API; e o trabalhador da automação, pela conexão direta
 * (`lib/automation/queue.ts`). Mapear nos dois lugares seria a receita pra eles
 * discordarem — e o jeito de descobrir seria o teto funcionando no painel e
 * falhando às 8h da manhã.
 */
export function budgetStatusDaLinha(linha: LinhaDeStatus): BudgetStatus {
  return {
    month: diaIso(linha.month),
    day: diaIso(linha.day),
    monthlyBudgetMicros: inteiroOuNulo(linha.monthly_budget_micros),
    dailyBudgetMicros: inteiroOuNulo(linha.daily_budget_micros),
    platformCapMicros: inteiroOuNulo(linha.platform_cap_micros),
    effectiveMonthlyMicros: inteiroOuNulo(linha.effective_monthly_micros),
    maxRunCostMicros: inteiroOuNulo(linha.max_run_cost_micros),
    hardStop: linha.hard_stop ?? true,
    alertAtPercent: inteiroOuNulo(linha.alert_at_percent) ?? 80,
    monthSpentMicros: inteiroOuZero(linha.month_spent_micros),
    daySpentMicros: inteiroOuZero(linha.day_spent_micros),
    monthAgentMicros: inteiroOuZero(linha.month_agent_micros),
    monthEmbeddingMicros: inteiroOuZero(linha.month_embedding_micros),
    unpricedRuns: inteiroOuZero(linha.unpriced_runs),
    unpricedDocuments: inteiroOuZero(linha.unpriced_documents),
    percentUsed: inteiroOuNulo(linha.percent_used),
    overBudget: linha.over_budget === true,
    blocked: linha.blocked === true,
    blockedBy: comoBlockedBy(linha.blocked_by),
  };
}

/**
 * Os últimos N meses de gasto — a ÂNCORA da tela.
 *
 * É ela que dá escala pro leigo: "US$ 20,00" não significa nada sozinho, mas
 * "nos últimos 3 meses vocês gastaram US$ 2,13, US$ 1,04 e US$ 3,80" significa
 * na hora. Por isso mês sem gasto nenhum também entra na lista, com zero — uma
 * lista com buraco faria a pessoa achar que faltou dado.
 *
 * Vem do MAIS NOVO pro mais antigo, e o primeiro item é o mês corrente.
 *
 * ⚠️ Não precisa de conta de fuso: `org_ai_spend.day` já foi gravado no fuso de
 * São Paulo por `public.ai_today()`. Agrupar por "os 7 primeiros caracteres"
 * é exato.
 */
export async function getMonthlySpendHistory(args: {
  organizationId: string;
  /** Quantos meses, contando o corrente. Padrão 6. */
  months?: number;
  supabase: SupabaseClient<Database>;
}): Promise<MonthSpend[]> {
  const quantos = Math.min(Math.max(Math.trunc(args.months ?? 6), 1), 24);
  const agora = new Date();

  // A lista sai pronta (do mais novo pro mais antigo) e depois recebe os
  // valores. Assim mês sem linha nenhuma aparece com zero em vez de sumir.
  const meses: string[] = [];
  for (let i = 0; i < quantos; i++) meses.push(inicioDoMesISO(agora, i));
  const soma = new Map<string, number>(meses.map((m) => [m, 0]));

  const { data, error } = await args.supabase
    .from("org_ai_spend")
    .select("day, agent_micros, embedding_micros")
    .eq("organization_id", args.organizationId)
    .gte("day", meses[meses.length - 1] ?? inicioDoMesISO(agora, 0))
    .order("day", { ascending: false });

  if (error) {
    logError("limits.getMonthlySpendHistory", error);
    // Histórico é contexto, não decisão. Devolver a lista zerada deixa a tela
    // de pé; estourar aqui derrubaria a página inteira de Limites.
    return meses.map((month) => ({ month, spentMicros: 0 }));
  }

  for (const linha of data ?? []) {
    const mes = mesDoDia(linha.day);
    if (!soma.has(mes)) continue;
    const total = inteiroOuZero(linha.agent_micros) + inteiroOuZero(linha.embedding_micros);
    soma.set(mes, (soma.get(mes) ?? 0) + total);
  }

  return meses.map((month) => ({ month, spentMicros: soma.get(month) ?? 0 }));
}

/**
 * O gasto DIA A DIA, pro gráfico do Início.
 *
 * Irmã de `getMonthlySpendHistory`, com duas diferenças que importam:
 *
 * 1. **A lista sai completa antes de receber valor.** Dia sem gasto nenhum não
 *    tem linha em `org_ai_spend`, e um gráfico que pula esses dias desenha uma
 *    reta ligando segunda a sexta como se quarta e quinta não existissem.
 *    Aqui todo dia aparece, com zero quando foi zero.
 * 2. **Sai do mais antigo pro mais novo**, que é a ordem em que o gráfico lê.
 *
 * ⚠️ NUNCA LANÇA, pelo mesmo motivo da irmã: no Início isso é contexto, não
 * decisão. Uma leitura que piscou não pode derrubar a primeira tela que a
 * pessoa abre no dia — devolve a lista zerada e o resto da tela continua de pé.
 */
export async function getDailySpendHistory(args: {
  organizationId: string;
  /** Quantos dias, contando hoje. Padrão 30. */
  days?: number;
  supabase: SupabaseClient<Database>;
}): Promise<DaySpend[]> {
  const quantos = Math.min(Math.max(Math.trunc(args.days ?? 30), 1), 90);
  const agora = new Date();

  const dias: string[] = [];
  for (let i = quantos - 1; i >= 0; i--) dias.push(diaISOAtras(agora, i));
  const soma = new Map<string, number>(dias.map((d) => [d, 0]));

  const { data, error } = await args.supabase
    .from("org_ai_spend")
    .select("day, agent_micros, embedding_micros")
    .eq("organization_id", args.organizationId)
    .gte("day", dias[0] ?? diaISOAtras(agora, 0));

  if (error) {
    logError("limits.getDailySpendHistory", error);
    return dias.map((day) => ({ day, spentMicros: 0 }));
  }

  for (const linha of data ?? []) {
    // A coluna `day` chega como texto pela API e como `Date` pela conexão
    // direta do trabalhador — o mesmo cuidado de `diaIso` no topo do arquivo.
    const dia = diaIso(linha.day);
    if (!soma.has(dia)) continue;
    const total = inteiroOuZero(linha.agent_micros) + inteiroOuZero(linha.embedding_micros);
    soma.set(dia, (soma.get(dia) ?? 0) + total);
  }

  return dias.map((day) => ({ day, spentMicros: soma.get(day) ?? 0 }));
}

/**
 * "Quem está queimando a minha chave" — a tela `/plataforma/gastos`.
 *
 * SÓ QUEM CUIDA DO SISTEMA. A função do banco confere `is_platform_admin()` e
 * recusa qualquer outra pessoa; aqui a recusa vira uma frase em português, e
 * não o texto do Postgres.
 *
 * `month` opcional, no formato "2026-08-01". Sem ele, é o mês corrente.
 */
export async function getPlatformSpendOverview(month?: string): Promise<PlatformSpendRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_ai_spend_overview", {
    _month: month,
  });

  if (error) {
    logError("limits.getPlatformSpendOverview", error);
    throw new Error(
      "Não deu pra carregar o gasto dos workspaces agora. Atualize a página — se continuar, " +
        "pode ser que sua conta não seja mais dona do sistema.",
    );
  }

  return (data ?? []).map((linha) => ({
    organizationId: linha.organization_id,
    organizationName: linha.organization_name,
    organizationSlug: linha.organization_slug,
    monthSpentMicros: inteiroOuZero(linha.month_spent_micros),
    unpricedRuns: inteiroOuZero(linha.unpriced_runs),
    monthlyBudgetMicros: inteiroOuNulo(linha.monthly_budget_micros),
    platformCapMicros: inteiroOuNulo(linha.platform_cap_micros),
    percentUsed: inteiroOuNulo(linha.percent_used),
    usesOwnKey: linha.uses_own_key === true,
  }));
}
