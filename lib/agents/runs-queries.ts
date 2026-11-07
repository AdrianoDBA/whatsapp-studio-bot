/**
 * Leitura das EXECUÇÕES — moldada pro que as telas mostram.
 *
 * Arquivo separado de `queries.ts` de propósito: ali é o agente (o molde),
 * aqui é o histórico do que ele já fez. E o nome é `runs-queries` pra não
 * colidir com a ESCRITA das execuções, que mora em `recorder.ts` e é do motor.
 *
 * O que sai daqui já vem no formato da tela (camelCase, duração calculada,
 * nome de quem rodou resolvido). A tela não faz conta nem junta tabela.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com "use client" — só os
 * TIPOS daqui podem ser importados por tela (`import type`).
 */
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { ModoDeExecucao } from "./acoes";
import type { AgentRunStatus, AgentTriggerKind } from "./types";

export type RunStatus = AgentRunStatus;
export type TriggerKind = AgentTriggerKind;
/** `"ensaio"` = nada saiu pra fora. Ver `lerModo` logo abaixo. */
export type RunModo = ModoDeExecucao;

/** Um passo do rastro: uma fala do modelo ou uma ferramenta que rodou. */
export type RunTraceStep = {
  seq: number;
  kind: "model" | "tool";
  toolName: string | null;
  /** jsonb do banco. Nunca `any`: quem mostra decide como desenhar. */
  input: unknown;
  output: unknown;
  /** JÁ em português claro — quem traduziu foi o motor. */
  errorMessage: string | null;
  durationMs: number | null;
  /** `null` = preço desconhecido. Não confundir com 0. */
  costMicros: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  /**
   * `true` só num passo de AÇÃO (`tool_name` em `acao:email` / `acao:http`)
   * rodado em modo ensaio: a ação NÃO saiu de verdade. A explicação inteira
   * mora em `lib/agents/acoes.ts`; o comentário em `<RunTrace>` cobre a
   * ordem deste passo no rastro (ele pode aparecer antes da ferramenta que
   * o disparou).
   */
  simulado: boolean;
  /**
   * O que a ação fez — **ou o que ela TERIA feito**, quando o passo é um
   * ensaio. É esta frase que o rastro escreve no aviso "✋ Ensaio", em vez do
   * genérico "eu teria feito isso".
   *
   * Ela mora dentro do `output` do passo (`{ detalhe }`, ver
   * `recordAcaoStep`); desembrulhar aqui é o que deixa a tela sem precisar
   * saber o formato do jsonb. `null` em passo de modelo, em ferramenta comum e
   * quando a ação deu erro (aí o que houve já mora em `errorMessage`).
   */
  detalhe: string | null;
};

export type RunListItem = {
  id: string;
  agentId: string | null;
  /** Congelado na linha da execução: sobrevive ao agente ser apagado. */
  agentSlug: string;
  /** `null` quando o agente foi apagado depois. */
  agentName: string | null;
  triggerKind: TriggerKind;
  status: RunStatus;
  triggeredByName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  costMicros: number | null;
  createdAt: string;
  /**
   * Em que modo essa execução rodou (`agent_runs.modo`, onda 7).
   *
   * ⚠️ É DAQUI que sai o selo de ensaio das telas — e o selo é a ÚNICA coisa
   * honesta na tela quando o modelo mente. Foi medido: com o ensaio ligado, o
   * card de resposta dizia "Enviei o email com o relatório do dia para
   * chefe@empresa.com" e nada tinha saído. `agent_run_steps.simulado` não
   * resolvia porque passo de ação só existe quando o agente AGIU: uma execução
   * em ensaio que não agiu — o caso mais comum — não tinha sinal nenhum.
   */
  modo: RunModo;
};

export type RunDetail = RunListItem & {
  input: unknown;
  output: string | null;
  errorMessage: string | null;
  tokensInput: number;
  tokensOutput: number;
  model: string | null;
  steps: RunTraceStep[];
};

export type RunFilters = {
  agentSlug?: string;
  status?: RunStatus;
  period?: "24h" | "7d" | "30d" | "tudo";
  /** Teto de linhas. Padrão e máximo: 200. */
  limit?: number;
};

/** Teto de linhas da listagem. Ver o aviso na tela quando bater nele. */
export const RUNS_LIMIT_PADRAO = 200;

/**
 * Fecha o `modo` cru do banco nos dois valores possíveis.
 *
 * Valor desconhecido vira `"real"`, nunca `"ensaio"`: execução gravada ANTES
 * de a coluna existir chega aqui com o padrão do banco, e execução que vier
 * por um caminho que não pediu a coluna chega `undefined` — os dois viram o
 * silêncio, não a afirmação "nada saiu pra fora" que o selo faz.
 */
function lerModo(valor: unknown): RunModo {
  return valor === "ensaio" ? "ensaio" : "real";
}

/**
 * Desembrulha o `detalhe` de dentro do `output` de um passo de ação.
 *
 * O `output` é `jsonb` — pode ser qualquer coisa, inclusive de uma versão
 * antiga do gravador. Por isso a conferência é na marra, e qualquer formato
 * inesperado vira `null` (a tela cai na frase genérica) em vez de exceção.
 */
function lerDetalhe(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null;
  const valor = (output as { detalhe?: unknown }).detalhe;
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/**
 * As colunas que a listagem precisa, mais dois "empréstimos" de outras
 * tabelas: o nome atual do agente e o nome de quem mandou rodar.
 *
 * O apelido da relação de perfil vem com o nome exato da chave estrangeira
 * (`!agent_runs_triggered_by_profile_fkey`) porque a coluna `triggered_by` tem
 * DUAS chaves saindo dela (uma pra `auth.users`, outra pra `profiles`). Sem
 * dizer qual, a consulta fica ambígua.
 */
const COLUNAS_LISTA = `
  id, agent_id, agent_slug, trigger_kind, status, modo,
  started_at, finished_at, cost_micros, created_at,
  agent:agents(name),
  profile:profiles!agent_runs_triggered_by_profile_fkey(full_name)
`;

const COLUNAS_DETALHE = `
  id, agent_id, agent_slug, trigger_kind, status, modo,
  started_at, finished_at, cost_micros, created_at,
  input, output, error_message, tokens_input, tokens_output, model,
  agent:agents(name),
  profile:profiles!agent_runs_triggered_by_profile_fkey(full_name)
`;

/** Quanto tempo a execução levou, em milissegundos. `null` se não deu pra saber. */
function duracao(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const inicio = new Date(startedAt).getTime();
  const fim = new Date(finishedAt).getTime();
  if (Number.isNaN(inicio) || Number.isNaN(fim) || fim < inicio) return null;
  return fim - inicio;
}

/** A data-limite de um período, ou `null` pra "tudo". */
function desdeQuando(period: RunFilters["period"]): string | null {
  const horas = period === "24h" ? 24 : period === "7d" ? 24 * 7 : period === "30d" ? 24 * 30 : 0;
  if (horas === 0) return null;
  return new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
}

type LinhaComEmprestimos = {
  id: string;
  agent_id: string | null;
  agent_slug: string;
  trigger_kind: TriggerKind;
  status: RunStatus;
  /**
   * Texto cru do banco, de propósito: quem fecha nos dois valores possíveis é
   * `lerModo`. Execução gravada ANTES da coluna existir chega aqui com o
   * padrão do banco ('real'), e execução que vier por um caminho que não
   * pediu a coluna chega `undefined` — os dois viram "real", que é o silêncio.
   */
  modo: string | null;
  started_at: string | null;
  finished_at: string | null;
  cost_micros: number | null;
  created_at: string;
  agent: { name: string } | null;
  profile: { full_name: string | null } | null;
};

function paraItem(linha: LinhaComEmprestimos): RunListItem {
  return {
    id: linha.id,
    agentId: linha.agent_id,
    agentSlug: linha.agent_slug,
    agentName: linha.agent?.name ?? null,
    triggerKind: linha.trigger_kind,
    status: linha.status,
    triggeredByName: linha.profile?.full_name ?? null,
    startedAt: linha.started_at,
    finishedAt: linha.finished_at,
    durationMs: duracao(linha.started_at, linha.finished_at),
    costMicros: linha.cost_micros,
    createdAt: linha.created_at,
    modo: lerModo(linha.modo),
  };
}

/** As execuções do workspace, da mais recente pra mais antiga. */
export async function listRuns(orgId: string, filters: RunFilters): Promise<RunListItem[]> {
  const supabase = await createClient();
  const teto = Math.min(Math.max(1, filters.limit ?? RUNS_LIMIT_PADRAO), RUNS_LIMIT_PADRAO);

  let consulta = supabase
    .from("agent_runs")
    .select(COLUNAS_LISTA)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(teto);

  if (filters.agentSlug) consulta = consulta.eq("agent_slug", filters.agentSlug);
  if (filters.status) consulta = consulta.eq("status", filters.status);

  const desde = desdeQuando(filters.period);
  if (desde) consulta = consulta.gte("created_at", desde);

  const { data, error } = await consulta;
  if (error) {
    logError("agents.listRuns", error);
    throw new Error("Não deu pra carregar as execuções agora. Atualize a página.");
  }

  return (data ?? []).map(paraItem);
}

/**
 * Uma execução com o rastro inteiro.
 *
 * ⚠️ OS PASSOS SÃO ORDENADOS POR `seq`, NÃO POR ORDEM DE GRAVAÇÃO.
 * O motor grava a ferramenta ANTES da fala do modelo que pediu ela (é assim
 * que o AI SDK avisa). Sem `order("seq")` o rastro sairia de cabeça pra baixo.
 */
export async function getRunDetail(orgId: string, runId: string): Promise<RunDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_runs")
    .select(COLUNAS_DETALHE)
    .eq("organization_id", orgId)
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    logError("agents.getRunDetail", error);
    throw new Error("Não deu pra carregar essa execução agora. Atualize a página.");
  }
  if (!data) return null;

  const { data: passos, error: erroPassos } = await supabase
    .from("agent_run_steps")
    .select(
      "seq, kind, tool_name, input, output, error_message, duration_ms, cost_micros, tokens_input, tokens_output, simulado",
    )
    .eq("organization_id", orgId)
    .eq("run_id", runId)
    .order("seq", { ascending: true });

  if (erroPassos) {
    logError("agents.getRunDetail.steps", erroPassos);
    throw new Error("Não deu pra carregar o rastro dessa execução. Atualize a página.");
  }

  return {
    ...paraItem(data),
    input: data.input,
    output: data.output,
    errorMessage: data.error_message,
    tokensInput: data.tokens_input,
    tokensOutput: data.tokens_output,
    model: data.model,
    steps: (passos ?? []).map((p) => ({
      seq: p.seq,
      kind: p.kind,
      toolName: p.tool_name,
      input: p.input,
      output: p.output,
      errorMessage: p.error_message,
      durationMs: p.duration_ms,
      costMicros: p.cost_micros,
      tokensInput: p.tokens_input,
      tokensOutput: p.tokens_output,
      simulado: p.simulado,
      detalhe: lerDetalhe(p.output),
    })),
  };
}
