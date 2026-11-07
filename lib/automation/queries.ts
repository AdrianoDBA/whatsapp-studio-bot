/**
 * Leitura do que a tela de Automações mostra.
 *
 * O que sai daqui já vem no formato da tela: a frase em português do
 * agendamento, o endereço completo do webhook, o nome de quem ele representa.
 * A tela não faz conta e não junta tabela.
 *
 * ⚠️ TODA FUNÇÃO RECEBE O `supabase` COMO PRIMEIRO PARÂMETRO.
 * É a mesma disciplina de `runAgent`: quem chama diz com que identidade a
 * consulta roda. A página do servidor cria um cliente só e reaproveita nas
 * três consultas.
 *
 * ⚠️ NUNCA FAÇA `select("*")` EM `webhook_endpoints`.
 * A coluna `token_hash` está fora do `grant select` de quem está logado, então
 * `select("*")` COMPILA e FALHA em execução com 42501 ("permission denied for
 * column token_hash"). É a rede de segurança funcionando, não bug: peça as
 * colunas na mão, como está feito aqui.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"` — de lá
 * só dá pra importar os TIPOS (`import type` de `./types`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModoDeExecucao } from "@/lib/agents/acoes";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";
import { lerEntrega } from "./entrega";
import { descreverAgendamento } from "./schedules";
import type { AutomationSource, JobStatus, ScheduleSummary, WebhookSummary } from "./types";
import { montarUrlDoWebhook } from "./webhooks";

/** Quantos disparos recentes a tela mostra por padrão. */
export const LIMITE_DE_TRABALHOS_RECENTES = 20;

/** Uma linha da lista "últimos disparos". */
export type TrabalhoRecente = {
  id: string;
  status: JobStatus;
  sourceKind: AutomationSource;
  /** A execução que saiu daqui, quando ela chegou a existir. */
  runId: string | null;
  /** JÁ em PT-BR leigo — quem traduziu foi `run-job.ts`. A tela mostra cru. */
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
};

function comoFonte(bruto: string | null): AutomationSource {
  return bruto === "schedule" || bruto === "webhook" ? bruto : "manual";
}

/** Lixo (ou valor inesperado) vira "ensaio" — o padrão mais seguro. */
function comoModo(bruto: string): ModoDeExecucao {
  return bruto === "real" ? "real" : "ensaio";
}

/**
 * Quem está no time, hoje.
 *
 * Serve pra responder "essa automação ficou órfã?" — o `run_as` pode apontar
 * pra uma pessoa que já saiu do workspace, e nesse caso o agendamento é
 * desligado sozinho na próxima varredura. Melhor a tela avisar antes.
 */
async function membrosDoWorkspace(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", orgId);

  if (error) {
    logError("automation.membrosDoWorkspace", error);
    throw new Error("Não deu pra carregar as automações agora. Atualize a página.");
  }
  return new Set((data ?? []).map((m) => m.user_id));
}

/**
 * Os agendamentos do workspace, já com a frase em português pronta.
 *
 * O apelido da relação de perfil vem com o nome exato da chave estrangeira
 * (`!schedules_run_as_profile_fkey`) porque a coluna `run_as` tem DUAS chaves
 * saindo dela (uma pra `auth.users`, outra pra `profiles`). Sem dizer qual, a
 * consulta fica ambígua e o PostgREST recusa.
 */
export async function listarAgendamentos(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<ScheduleSummary[]> {
  const [membros, resposta] = await Promise.all([
    membrosDoWorkspace(supabase, orgId),
    supabase
      .from("schedules")
      .select(
        `id, name, agent_id, kind, hour, minute, weekdays, day_of_month, every_minutes,
         timezone, is_active, next_run_at, last_run_at, last_error, run_as, created_at,
         modo, entrega,
         agent:agents(name),
         profile:profiles!schedules_run_as_profile_fkey(full_name)`,
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  ]);

  if (resposta.error) {
    logError("automation.listarAgendamentos", resposta.error);
    throw new Error("Não deu pra carregar os agendamentos agora. Atualize a página.");
  }

  return (resposta.data ?? []).map((linha) => ({
    id: linha.id,
    name: linha.name,
    agentId: linha.agent_id,
    // O agente pode ter sido apagado — a linha do agendamento cai junto
    // (cascade), então na prática isto quase nunca acontece. Mas não custa.
    agentName: linha.agent?.name ?? "(agente apagado)",
    descricao: descreverAgendamento({
      kind: linha.kind,
      hour: linha.hour,
      minute: linha.minute,
      weekdays: linha.weekdays,
      day_of_month: linha.day_of_month,
      every_minutes: linha.every_minutes,
      timezone: linha.timezone,
    }),
    timezone: linha.timezone,
    isActive: linha.is_active,
    nextRunAt: linha.next_run_at,
    lastRunAt: linha.last_run_at,
    lastError: linha.last_error,
    runAsUserId: linha.run_as,
    runAsName: linha.profile?.full_name ?? null,
    orfa: linha.run_as === null || !membros.has(linha.run_as),
    modo: comoModo(linha.modo),
    entrega: lerEntrega(linha.entrega),
  }));
}

/**
 * Os endereços secretos do workspace.
 *
 * `baseUrl` vem de `getAppUrl()`, na página — assim o endereço que aparece na
 * tela é exatamente o que o aluno acabou de digitar no navegador, e não um
 * `localhost` gravado em algum lugar.
 *
 * ⚠️ REPARE NAS COLUNAS PEDIDAS NA MÃO. Ver o aviso no topo do arquivo.
 */
export async function listarWebhooks(
  supabase: SupabaseClient<Database>,
  orgId: string,
  baseUrl: string,
): Promise<WebhookSummary[]> {
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select(
      `id, label, agent_id, token_prefix, is_active, last_called_at, calls_count, run_as,
       created_at, modo, esperar_resposta,
       agent:agents(name),
       profile:profiles!webhook_endpoints_run_as_profile_fkey(full_name)`,
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    logError("automation.listarWebhooks", error);
    throw new Error("Não deu pra carregar os endereços de webhook agora. Atualize a página.");
  }

  return (data ?? []).map((linha) => ({
    id: linha.id,
    label: linha.label,
    agentId: linha.agent_id,
    agentName: linha.agent?.name ?? "(agente apagado)",
    url: montarUrlDoWebhook(baseUrl, linha.id),
    tokenPrefix: linha.token_prefix,
    isActive: linha.is_active,
    lastCalledAt: linha.last_called_at,
    callsCount: linha.calls_count,
    runAsUserId: linha.run_as,
    runAsName: linha.profile?.full_name ?? null,
    modo: comoModo(linha.modo),
    esperarResposta: linha.esperar_resposta,
  }));
}

/**
 * Os últimos disparos, pra pessoa ver que a automação está mesmo acontecendo.
 *
 * A tabela `jobs` só dá `select` pra quem está logado (entrar e sair da fila é
 * só por função do banco), então aqui não tem risco de escrita nenhuma.
 */
export async function listarTrabalhosRecentes(
  supabase: SupabaseClient<Database>,
  orgId: string,
  limite = LIMITE_DE_TRABALHOS_RECENTES,
): Promise<TrabalhoRecente[]> {
  const teto = Math.min(Math.max(Math.trunc(limite), 1), 100);

  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, source_kind, run_id, last_error, created_at, finished_at")
    .eq("organization_id", orgId)
    // ⚠️ SÓ TRABALHO DE AGENTE. A fila também carrega a leitura de documento
    // (`ingest_document`), e ela NÃO é automação: apareceu aqui uma vez, rotulada
    // "Alguém clicou", e quem subiu um PDF viu um disparo misterioso numa tela
    // que promete "faça um agente rodar sozinho". O andamento do documento mora
    // em Conhecimento, na linha dele, com o erro em português.
    .eq("kind", "run_agent")
    .order("created_at", { ascending: false })
    .limit(teto);

  if (error) {
    logError("automation.listarTrabalhosRecentes", error);
    throw new Error("Não deu pra carregar os últimos disparos agora. Atualize a página.");
  }

  return (data ?? []).map((linha) => ({
    id: linha.id,
    status: linha.status,
    sourceKind: comoFonte(linha.source_kind),
    runId: linha.run_id,
    lastError: linha.last_error,
    createdAt: linha.created_at,
    finishedAt: linha.finished_at,
  }));
}
