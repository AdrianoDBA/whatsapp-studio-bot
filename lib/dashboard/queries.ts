/**
 * AS LEITURAS DO INÍCIO — a primeira tela de dentro do workspace.
 *
 * ⚠️ NENHUMA FUNÇÃO DESTE ARQUIVO LANÇA. E isso não é preguiça de tratar erro:
 * o Início é a tela pra onde TODO caminho leva de volta (o guard de workspace
 * redireciona pra cá, a barra lateral aponta pra cá, o "voltar" das telas de
 * detalhe cai aqui). Uma consulta que piscou não pode derrubar a tela que é o
 * chão do app inteiro — se um bloco não carregou, ele aparece zerado e o resto
 * continua de pé. É a mesma escolha já feita em `getBudgetStatus` e em
 * `getMonthlySpendHistory`, pelo mesmo motivo.
 *
 * ⚠️ TUDO EM PARALELO. São oito idas ao banco; em fila seriam oito esperas
 * somadas na primeira tela que a pessoa abre no dia.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com "use client" — de lá
 * só dá pra importar os TIPOS (`import type` de `./types`).
 */
import { listRuns, type RunListItem } from "@/lib/agents/runs-queries";
import { hasAnyAiCredential } from "@/lib/ai/resolve";
import { getBudgetStatus, getDailySpendHistory } from "@/lib/limits/queries";
import type { BudgetStatus, DaySpend } from "@/lib/limits/types";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { montarProximosPassos } from "./passos";
import type { ProximaAutomacao, ProximoPasso, ResumoDeExecucoes } from "./types";

/** Quantas execuções recentes o bloco "últimas execuções" mostra. */
export const ULTIMAS_EXECUCOES = 5;

/** Quantos dias o gráfico de custo cobre. */
export const DIAS_DO_GRAFICO = 30;

/** Tudo que a tela do Início mostra, numa viagem só. */
export type DadosDoInicio = {
  passos: ProximoPasso[];
  execucoes7d: ResumoDeExecucoes;
  budget: BudgetStatus | null;
  agentesAtivos: number;
  agentesTotal: number;
  trechosIndexados: number;
  gastoPorDia: DaySpend[];
  ultimasExecucoes: RunListItem[];
  /** Vazio pra quem não administra — ver o comentário em `proximasAutomacoes`. */
  proximasAutomacoes: ProximaAutomacao[];
};

// ---------------------------------------------------------------------------
// Os pedaços. Cada um engole o próprio erro e devolve o "não sei" dele.
// ---------------------------------------------------------------------------

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Existe chave de IA valendo aqui? `false` quando não deu pra saber. */
async function temChaveDeIa(supabase: Supabase, orgId: string): Promise<boolean> {
  try {
    return await hasAnyAiCredential(orgId, supabase);
  } catch (err) {
    logError("dashboard.temChaveDeIa", err);
    return false;
  }
}

/**
 * Existe chave de email (Resend) da plataforma? `false` quando não deu pra saber.
 *
 * ⚠️ É de propósito que isto olhe SÓ o nível da plataforma. Email não é coisa
 * de workspace — a tela de Integrações de um workspace nem oferece Resend (ver
 * `lib/email/CLAUDE.md`). Olhar o workspace aqui faria o degrau nunca sumir.
 */
async function temChaveDeEmailDaPlataforma(supabase: Supabase): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("credentials")
      .select("provider")
      .is("organization_id", null)
      .eq("provider", "resend")
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  } catch (err) {
    logError("dashboard.temChaveDeEmailDaPlataforma", err);
    return false;
  }
}

/**
 * Quantos agentes existem, e quantos estão ligados.
 *
 * Os dois números saem da mesma consulta de propósito: `total` decide se o
 * degrau "criar seu primeiro agente" está cumprido, e `ativos` é o número que
 * vai pro cartão. Rascunho conta pra um e não pro outro.
 */
async function contarAgentes(
  supabase: Supabase,
  orgId: string,
): Promise<{ total: number; ativos: number }> {
  const { data, error } = await supabase
    .from("agents")
    .select("status")
    .eq("organization_id", orgId)
    .limit(500);

  if (error) {
    logError("dashboard.contarAgentes", error);
    return { total: 0, ativos: 0 };
  }
  const linhas = data ?? [];
  return {
    total: linhas.length,
    ativos: linhas.filter((a) => a.status === "active").length,
  };
}

/**
 * Execuções dos últimos 7 dias, e quantas delas deram errado.
 *
 * ⚠️ ISTO É `count: "exact"`, NÃO `listRuns(...).length`. A listagem tem teto
 * de 200 linhas (`RUNS_LIMIT_PADRAO`), então num workspace movimentado o
 * cartão diria "200" pra sempre — um número errado que parece certo é pior do
 * que número nenhum. Aqui quem conta é o banco, e não vem linha nenhuma junto.
 */
async function contarExecucoes7d(supabase: Supabase, orgId: string): Promise<ResumoDeExecucoes> {
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [tudo, falhas] = await Promise.all([
    supabase
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", desde),
    supabase
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "failed")
      .gte("created_at", desde),
  ]);

  if (tudo.error) logError("dashboard.contarExecucoes7d", tudo.error);
  if (falhas.error) logError("dashboard.contarExecucoes7d.falhas", falhas.error);

  return { total: tudo.count ?? 0, falhas: falhas.count ?? 0 };
}

/**
 * O conhecimento: quantos trechos já estão indexados, e se alguma base está
 * vazia.
 *
 * ⚠️ A CONTA DE TRECHOS SAI DE `documents.chunk_count`, NÃO de contar linhas
 * em `document_chunks`. A tabela de pedaços carrega uma coluna `embedding` de
 * 1536 números; ela é a maior do banco de longe, e varrer ela pra chegar num
 * número de cartão seria o jeito mais caro possível de escrever "128".
 */
async function lerConhecimento(
  supabase: Supabase,
  orgId: string,
): Promise<{ trechos: number; baseVazia: { slug: string; nome: string } | null }> {
  const [bases, docs] = await Promise.all([
    supabase
      .from("knowledge_bases")
      .select("id, slug, name")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true })
      .limit(100),
    supabase
      .from("documents")
      .select("knowledge_base_id, status, chunk_count")
      .eq("organization_id", orgId)
      .limit(2000),
  ]);

  if (bases.error) logError("dashboard.lerConhecimento.bases", bases.error);
  if (docs.error) logError("dashboard.lerConhecimento.documentos", docs.error);

  let trechos = 0;
  const comDocumento = new Set<string>();
  for (const d of docs.data ?? []) {
    comDocumento.add(d.knowledge_base_id);
    if (d.status === "ready") trechos += d.chunk_count;
  }

  const vazia = (bases.data ?? []).find((b) => !comDocumento.has(b.id));
  return {
    trechos,
    baseVazia: vazia ? { slug: vazia.slug, nome: vazia.name } : null,
  };
}

/** As últimas execuções, pra lista curta. Lista vazia quando não deu pra ler. */
async function lerUltimasExecucoes(orgId: string): Promise<RunListItem[]> {
  try {
    return await listRuns(orgId, { limit: ULTIMAS_EXECUCOES });
  } catch (err) {
    logError("dashboard.ultimasExecucoes", err);
    return [];
  }
}

/**
 * O que vai rodar sozinho daqui a pouco.
 *
 * ⚠️ SÓ PRA QUEM ADMINISTRA, e o motivo não é sigilo: qualquer membro PODE ler
 * `schedules` (a policy é "members read schedules"). É que o "ver todas" deste
 * bloco leva pra `/automacoes`, que é `requireOrgRole` — um bloco cuja única
 * saída chuta a pessoa de volta pro Início não é informação, é armadilha.
 *
 * Consulta enxuta de propósito: `listarAgendamentos` monta a frase em
 * português, resolve quem é o dono e ainda busca a lista de membros pra marcar
 * agendamento órfão. Aqui é um nome e uma hora.
 */
async function lerProximasAutomacoes(
  supabase: Supabase,
  orgId: string,
): Promise<ProximaAutomacao[]> {
  const { data, error } = await supabase
    .from("schedules")
    .select("id, name, next_run_at, agent:agents(name)")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .not("next_run_at", "is", null)
    .order("next_run_at", { ascending: true })
    .limit(3);

  if (error) {
    logError("dashboard.proximasAutomacoes", error);
    return [];
  }

  return (data ?? []).map((linha) => ({
    id: linha.id,
    nome: linha.name,
    agenteNome: linha.agent?.name ?? "(agente apagado)",
    proximaEm: linha.next_run_at,
  }));
}

// ---------------------------------------------------------------------------
// A leitura inteira
// ---------------------------------------------------------------------------

/**
 * Tudo que o Início mostra.
 *
 * `administra` é `role === "owner" || role === "admin"` — quem decide isso é a
 * página, que já recebe o papel de `requireOrgMember`.
 */
export async function getDadosDoInicio(args: {
  orgId: string;
  orgSlug: string;
  administra: boolean;
  /** Quem está olhando é dono do sistema? Quem decide isso é a página. */
  ehDonoDaPlataforma: boolean;
}): Promise<DadosDoInicio> {
  const supabase = await createClient();

  const [
    chave,
    agentes,
    execucoes7d,
    budget,
    conhecimento,
    gastoPorDia,
    ultimas,
    automacoes,
    chaveDeEmail,
  ] = await Promise.all([
      temChaveDeIa(supabase, args.orgId),
      contarAgentes(supabase, args.orgId),
      contarExecucoes7d(supabase, args.orgId),
      getBudgetStatus({ organizationId: args.orgId, supabase }),
      lerConhecimento(supabase, args.orgId),
      getDailySpendHistory({
        organizationId: args.orgId,
        days: DIAS_DO_GRAFICO,
        supabase,
      }),
      lerUltimasExecucoes(args.orgId),
      args.administra ? lerProximasAutomacoes(supabase, args.orgId) : Promise.resolve([]),
      // Só quem é dono do sistema vê o degrau — não vale pagar a consulta pros outros.
      args.ehDonoDaPlataforma ? temChaveDeEmailDaPlataforma(supabase) : Promise.resolve(true),
    ]);

  return {
    passos: montarProximosPassos({
      orgSlug: args.orgSlug,
      administra: args.administra,
      temChaveDeIa: chave,
      agentes: agentes.total,
      // ⚠️ O degrau "conversar pela primeira vez" NÃO pode olhar só a janela de
      // 7 dias: quem conversou mês passado já cumpriu esse degrau, e vê-lo
      // reaparecer depois de uma semana parada seria de enlouquecer. A lista
      // das últimas execuções não tem recorte de tempo — é ela que responde
      // "já rodou alguma vez?" quando a janela de 7 dias veio vazia.
      execucoes: execucoes7d.total > 0 ? execucoes7d.total : ultimas.length,
      temTeto: budget?.effectiveMonthlyMicros != null,
      baseVazia: conhecimento.baseVazia,
      ehDonoDaPlataforma: args.ehDonoDaPlataforma,
      temChaveDeEmail: chaveDeEmail,
    }),
    execucoes7d,
    budget,
    agentesAtivos: agentes.ativos,
    agentesTotal: agentes.total,
    trechosIndexados: conhecimento.trechos,
    gastoPorDia,
    ultimasExecucoes: ultimas,
    proximasAutomacoes: automacoes,
  };
}
