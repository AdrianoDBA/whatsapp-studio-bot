/**
 * Leitura das conversas — o que as TELAS mostram.
 *
 * ⚠️ TODA FUNÇÃO AQUI RECEBE O `supabase` COMO PRIMEIRO PARÂMETRO, em vez de
 * chamar `createClient()` lá dentro. É a mesma disciplina de `runAgent`: quem
 * chama diz com que identidade a consulta vai rodar. E é o que deixa a página
 * do servidor reaproveitar um cliente só em vez de abrir quatro.
 *
 * A regra de segurança do banco já prende cada consulta ao workspace de quem
 * está logado; o `.eq("organization_id", orgId)` daqui é o cinto além do
 * suspensório.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";
import { MAX_HISTORY_MESSAGES } from "./schemas";
import type {
  AgentUIMessage,
  ChatMessageMetadata,
  PendingAnswer,
  ThreadListItem,
  ThreadRecord,
} from "./types";

/** Depois de quanto tempo uma resposta "rodando" é considerada abandonada. */
const ABANDONADA_APOS_MS = 5 * 60_000;

/**
 * As conversas daquele agente.
 *
 * Por padrão traz as do workspace inteiro — a conversa é DO WORKSPACE (todo
 * membro lê, só quem começou escreve). Passe `userId` pra filtrar só as de uma
 * pessoa.
 */
export async function listThreads(
  supabase: SupabaseClient<Database>,
  orgId: string,
  params: { agentId: string; userId?: string; limit?: number },
): Promise<ThreadListItem[]> {
  let consulta = supabase
    .from("threads")
    // ⚠️ O texto do `select` PRECISA ser um literal de uma peça só. Montado com
    // `+`, o TypeScript não consegue ler o formato e a linha inteira vira
    // `GenericStringError`.
    //
    // O `!threads_user_profile_fkey` desambigua: `user_id` tem DUAS chaves
    // estrangeiras (uma pra `auth.users`, outra pra `profiles`), e sem dizer
    // qual é o PostgREST responde "more than one relationship was found".
    .select(
      `id, title, message_count, last_message_at, created_at, user_id,
       autor:profiles!threads_user_profile_fkey(full_name)`,
    )
    .eq("organization_id", orgId)
    .eq("agent_id", params.agentId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(params.limit ?? 50, 200)));

  if (params.userId) consulta = consulta.eq("user_id", params.userId);

  const { data, error } = await consulta;

  if (error) {
    logError("threads.listThreads", error);
    throw new Error("Não deu pra carregar as conversas agora. Atualize a página.");
  }

  return (data ?? []).map((linha) => ({
    id: linha.id,
    title: linha.title,
    messageCount: linha.message_count,
    lastMessageAt: linha.last_message_at,
    createdAt: linha.created_at,
    userId: linha.user_id,
    authorName: linha.autor?.full_name ?? null,
    isMine: params.userId ? linha.user_id === params.userId : false,
  }));
}

/** Uma conversa, ou `null` quando ela não existe neste workspace. */
export async function getThread(
  supabase: SupabaseClient<Database>,
  orgId: string,
  threadId: string,
): Promise<ThreadRecord | null> {
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", threadId)
    .maybeSingle();

  if (error) {
    logError("threads.getThread", error);
    throw new Error("Não deu pra carregar essa conversa agora. Atualize a página.");
  }
  return data;
}

/**
 * Os balões da conversa, no formato que a tela consome.
 *
 * ⚠️ ORDENA POR `seq`, NUNCA por `created_at` (duas mensagens da mesma
 * transação empatam no relógio).
 */
export async function getThreadMessages(
  supabase: SupabaseClient<Database>,
  orgId: string,
  threadId: string,
  limit = MAX_HISTORY_MESSAGES,
): Promise<AgentUIMessage[]> {
  const { data, error } = await supabase
    .from("thread_messages")
    .select("id, role, parts, metadata, seq")
    .eq("organization_id", orgId)
    .eq("thread_id", threadId)
    .order("seq", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error) {
    logError("threads.getThreadMessages", error);
    throw new Error("Não deu pra carregar essa conversa agora. Atualize a página.");
  }

  return [...(data ?? [])].reverse().map((linha) => ({
    id: linha.id,
    role: linha.role === "user" ? ("user" as const) : ("assistant" as const),
    parts: Array.isArray(linha.parts) ? (linha.parts as unknown as AgentUIMessage["parts"]) : [],
    metadata: (linha.metadata ?? undefined) as ChatMessageMetadata | undefined,
  }));
}

/**
 * A conversa mais recente daquela pessoa com aquele agente.
 *
 * É o que faz "Conversar" cair direto na última conversa em vez de abrir uma
 * em branco toda vez.
 */
export async function getLatestThreadId(
  supabase: SupabaseClient<Database>,
  orgId: string,
  agentId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("threads")
    .select("id")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logError("threads.getLatestThreadId", error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * A execução que ficou sem balão de resposta nesta conversa.
 *
 * QUANDO ISSO ACONTECE: a pessoa fecha a aba (ou o container cai) no meio da
 * resposta. O servidor termina de consumir o modelo assim mesmo — é pra isso
 * que existe o `consumeStream()` na rota —, então a execução fecha e o custo é
 * apurado. O que pode faltar é o balão da conversa.
 *
 * Sem isto, a pessoa voltaria e veria a própria pergunta sozinha, sem nenhuma
 * pista de que o agente respondeu (e cobrou).
 */
export async function getPendingAnswer(
  supabase: SupabaseClient<Database>,
  orgId: string,
  threadId: string,
): Promise<PendingAnswer | null> {
  const { data: execucao, error } = await supabase
    .from("agent_runs")
    .select("id, status, output, error_message, started_at")
    .eq("organization_id", orgId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logError("threads.getPendingAnswer", error);
    return null;
  }
  if (!execucao) return null;

  // Tem balão gravado pra essa execução? Então não sobrou nada pendente.
  const { count, error: erroDoBalao } = await supabase
    .from("thread_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("thread_id", threadId)
    .eq("run_id", execucao.id);

  if (erroDoBalao) {
    logError("threads.getPendingAnswer", erroDoBalao);
    return null;
  }
  if ((count ?? 0) > 0) return null;

  const inicio = execucao.started_at ? Date.parse(execucao.started_at) : Number.NaN;
  const abandonada =
    execucao.status === "running" &&
    Number.isFinite(inicio) &&
    Date.now() - inicio > ABANDONADA_APOS_MS;

  // ⚠️ Execução que COMEÇOU AGORA e ainda está rodando não é aviso nenhum: ela
  // pode estar chegando neste segundo, em outra aba. Dizer "essa resposta ficou
  // pela metade" pra uma resposta de dois segundos atrás seria assustar à toa.
  // Só vira aviso depois de 5 minutos parada.
  if (execucao.status === "running" && !abandonada) return null;

  return {
    runId: execucao.id,
    status: execucao.status,
    output: execucao.output,
    errorMessage: execucao.error_message,
    startedAt: execucao.started_at,
    abandonada,
  };
}
