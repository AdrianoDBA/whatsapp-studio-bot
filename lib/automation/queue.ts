/**
 * A FILA, por dentro.
 *
 * ⚠️ ESTE É O ÚNICO ARQUIVO DO PROJETO QUE USA `systemPool()`.
 *
 * O conjunto de conexões de sistema entra no banco como `postgres`, que é DONO
 * das tabelas. Como o template não usa `FORCE ROW LEVEL SECURITY` (regra 2 do
 * CLAUDE.md), uma consulta solta por aqui PULARIA a regra de segurança do
 * banco inteira — ou seja, veria dado de todos os workspaces de uma vez.
 *
 * Por isso a disciplina aqui é simples e inegociável:
 *
 *   • **nenhuma string de SQL solta.** Só chamada de função COM NOME, e só as
 *     funções da lista abaixo, todas `security definer` e todas inalcançáveis
 *     por quem está logado (`revoke execute … from authenticated`);
 *   • **nenhuma consulta em tabela de dado do aluno.** Ler agente, conversa
 *     ou documento é trabalho da ponte (`postgrest-bridge.ts`), que
 *     entra como `authenticated` e respeita a regra de segurança.
 *
 * As funções: `claim_job`, `job_for_run`, `mark_job_started`, `finish_job`,
 * `release_job`, `reclaim_stuck_jobs`, `reclaim_stuck_agent_runs`,
 * `enqueue_due_schedules`, `enqueue_webhook_job`, `schedule_report_result`,
 * `webhook_endpoint_for_check`, `webhook_touch`, `automation_budget_left`,
 * `finish_agent_run_system`, `org_ai_budget_status`, `owner_memberships_for_seed`.
 *
 * ⚠️ `org_ai_budget_status` é a ÚNICA da lista que quem está logado também
 * alcança, e isso é de propósito: é a mesma leitura que a tela de Limites faz.
 * Ela se defende sozinha — com sessão, exige pertencer ao workspace; sem
 * sessão, só chega ali o processo do container. Não copie essa exceção pra
 * função que ESCREVE.
 *
 * ⚠️ `owner_memberships_for_seed` é SÓ LEITURA e devolve linha CRUA (nenhuma
 * lógica, nenhuma escolha) — é o que `npm run semear` usa pra descobrir quem
 * impersonar antes de abrir a sessão da ponte (problema do ovo-e-a-galinha:
 * pra ler `memberships` PELA ponte já seria preciso estar impersonando
 * alguém). Uma função nomeada, só leitura, na mesma lista fechada de sempre,
 * é o padrão que a regra 10-G descreve — não uma exceção a ela.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import type { ModoDeExecucao } from "@/lib/agents/acoes";
import type { AgentRunStatus } from "@/lib/agents/types";
import { budgetStatusDaLinha, type LinhaDeStatus } from "@/lib/limits/queries";
import type { BudgetBlockedBy, BudgetStatus } from "@/lib/limits/types";
import { logError } from "@/lib/logger";
import { systemPool } from "./pg";
import type { AutomationSource, JobParaRodar, JobStatus } from "./types";

/** Uma chamada de função, sempre parametrizada. Nunca texto concatenado. */
async function chamar<T extends Record<string, unknown>>(
  text: string,
  values: unknown[],
): Promise<T[]> {
  const { rows } = await systemPool().query<T>({ text, values });
  return rows;
}

function comoFonte(bruto: string | null): AutomationSource {
  return bruto === "schedule" || bruto === "webhook" ? bruto : "manual";
}

// ---------------------------------------------------------------------------
// Pegar e devolver trabalho
// ---------------------------------------------------------------------------

/**
 * Pega UM trabalho da fila e marca como "rodando", travado por este
 * trabalhador. Devolve `null` quando não tem nada esperando.
 *
 * O `for update skip locked` mora dentro da função do banco: é ele que faz
 * duas cópias do app no EasyPanel nunca pegarem o mesmo trabalho.
 */
export async function claimJob(workerId: string): Promise<string | null> {
  const linhas = await chamar<{ id: string | null }>(
    "select public.claim_job(_worker_id => $1) as id",
    [workerId],
  );
  return linhas[0]?.id ?? null;
}

/**
 * A linha do trabalho, SÓ se ele estiver `running` E travado por ESTE
 * trabalhador.
 *
 * ⚠️ É AQUI QUE A AMEAÇA T5 MORRE. Organização, agente e identidade
 * (`run_as`) saem desta linha — que foi gravada por uma função do banco — e
 * nunca do corpo do pedido HTTP. Não existe caminho pra alguém pedir "rode no
 * nome de outra pessoa".
 */
export async function loadJobForRun(jobId: string, workerId: string): Promise<JobParaRodar | null> {
  const linhas = await chamar<{
    id: string;
    organization_id: string;
    kind: string;
    agent_id: string | null;
    payload: unknown;
    run_as: string | null;
    source_kind: string | null;
    source_id: string | null;
    attempts: number;
    max_attempts: number;
    locked_by: string | null;
  }>("select * from public.job_for_run(_job_id => $1, _worker_id => $2)", [jobId, workerId]);

  const linha = linhas[0];
  if (!linha) return null;

  return {
    id: linha.id,
    organizationId: linha.organization_id,
    kind: linha.kind === "ingest_document" ? "ingest_document" : "run_agent",
    agentId: linha.agent_id,
    input: linha.payload,
    runAs: linha.run_as,
    sourceKind: comoFonte(linha.source_kind),
    sourceId: linha.source_id,
    attempts: linha.attempts,
    maxAttempts: linha.max_attempts,
    lockedBy: linha.locked_by,
  };
}

/**
 * Marca que o trabalho COMEÇOU. Devolve `true` só na PRIMEIRA vez.
 *
 * ⚠️ É esta linha que impede cobrar duas vezes. Entrega repetida do mesmo
 * trabalho (a rede repetiu o pedido, o processo reiniciou no meio) devolve
 * `false`, e aí o trabalho é fechado como falha COM EXPLICAÇÃO — em vez de
 * rodar o agente de novo e gastar dinheiro de novo.
 */
export async function markJobStarted(jobId: string): Promise<boolean> {
  const linhas = await chamar<{ ok: boolean | null }>(
    "select public.mark_job_started(_job_id => $1) as ok",
    [jobId],
  );
  return linhas[0]?.ok === true;
}

/**
 * Fecha o trabalho.
 *
 * `retryInSeconds: null` (o padrão) = não tenta de novo. É o padrão de tudo
 * que já gastou dinheiro: perder uma rodada é melhor que cobrar duas vezes.
 */
export async function finishJob(params: {
  jobId: string;
  status: "done" | "failed" | "cancelled";
  /** JÁ em PT-BR leigo. A tela mostra cru. */
  error?: string | null;
  runId?: string | null;
  retryInSeconds?: number | null;
}): Promise<void> {
  const intervalo =
    typeof params.retryInSeconds === "number" && params.retryInSeconds > 0
      ? `${Math.round(params.retryInSeconds)} seconds`
      : null;

  await chamar(
    "select public.finish_job(_job_id => $1, _status => $2, _error => $3, " +
      "_run_id => $4, _retry_in => $5)",
    [params.jobId, params.status, params.error ?? null, params.runId ?? null, intervalo],
  );
}

/**
 * Devolve o trabalho pra fila sem contar como falha final (o site reiniciou, a
 * chamada interna não respondeu). Só vale pra trabalho que NÃO começou.
 */
export async function releaseJob(jobId: string, error?: string | null): Promise<void> {
  await chamar("select public.release_job(_job_id => $1, _error => $2)", [jobId, error ?? null]);
}

// ---------------------------------------------------------------------------
// A faxina
// ---------------------------------------------------------------------------

/** Trabalho travado há muito tempo: volta pra fila ou vira falha explicada. */
export async function reclaimStuckJobs(olderThan = "10 minutes"): Promise<number> {
  const linhas = await chamar<{ n: number | null }>(
    "select public.reclaim_stuck_jobs(_older_than => $1) as n",
    [olderThan],
  );
  return linhas[0]?.n ?? 0;
}

/** Execução pendurada em "rodando" vira falha explicada na tela de Execuções. */
export async function reclaimStuckAgentRuns(olderThan = "20 minutes"): Promise<number> {
  const linhas = await chamar<{ n: number | null }>(
    "select public.reclaim_stuck_agent_runs(_older_than => $1) as n",
    [olderThan],
  );
  return linhas[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Entrar na fila (agendamento e webhook)
// ---------------------------------------------------------------------------

/** Os agendamentos vencidos viram trabalho na fila. Devolve quantos entraram. */
export async function enqueueDueSchedules(limite = 20): Promise<number> {
  const linhas = await chamar<{ n: number | null }>(
    "select public.enqueue_due_schedules(_limite => $1) as n",
    [limite],
  );
  return linhas[0]?.n ?? 0;
}

/**
 * Por que a chamada NÃO entrou na fila.
 *
 * Antes a função do banco devolvia `null` pra quatro motivos diferentes e a
 * rota fazia uma leitura EXTRA pra adivinhar qual era — e mesmo assim não
 * conseguia separar "fila cheia" de "chamada repetida". Agora o motivo vem com
 * nome, e cada um vira uma resposta HTTP diferente.
 */
export type MotivoDeRecusaDoWebhook =
  /** o endereço foi desligado */
  | "desligado"
  /** quem o endereço representa saiu do workspace (e ele foi desligado agora) */
  | "sem-responsavel"
  /** o workspace chegou no teto de gasto com IA */
  | "teto-de-gasto"
  /** o workspace já tem 25 trabalhos esperando */
  | "fila-cheia"
  /** essa mesma chave de repetição já tinha entrado */
  | "repetida";

export type EnqueueWebhookResult = {
  jobId: string | null;
  motivo: MotivoDeRecusaDoWebhook | null;
  /** Só quando `motivo === "teto-de-gasto"`: qual dos três tetos cortou. */
  escopo?: BudgetBlockedBy;
};

function comoMotivo(bruto: unknown): MotivoDeRecusaDoWebhook | null {
  return bruto === "desligado" ||
    bruto === "sem-responsavel" ||
    bruto === "teto-de-gasto" ||
    bruto === "fila-cheia" ||
    bruto === "repetida"
    ? bruto
    : null;
}

function comoEscopo(bruto: unknown): BudgetBlockedBy | undefined {
  return bruto === "mes" || bruto === "dia" || bruto === "plataforma" ? bruto : undefined;
}

/**
 * O webhook chegou: enfileira e pronto.
 *
 * ⚠️ A FUNÇÃO DO BANCO DEVOLVE `jsonb`, não mais um uuid. `{ job_id, motivo }`
 * — e quando o motivo é o teto de gasto, mais um `escopo`. Ler isto como texto
 * (`linhas[0]?.id`) devolveria um objeto onde a rota espera um número de
 * trabalho.
 *
 * ⚠️ NÃO EMBRULHE O CORPO DE NOVO. Quem põe o corpo do webhook dentro de
 * `{ "data": … }` é a função do banco, de propósito (é a última camada que
 * ninguém contorna). Embrulhar aqui também produziria `data.data`.
 */
export async function enqueueWebhookJob(params: {
  endpointId: string;
  payload: unknown;
  idempotencyKey?: string | null;
}): Promise<EnqueueWebhookResult> {
  const linhas = await chamar<{
    resultado: { job_id?: unknown; motivo?: unknown; escopo?: unknown } | null;
  }>(
    "select public.enqueue_webhook_job(_endpoint_id => $1, _payload => $2, " +
      "_idempotency_key => $3) as resultado",
    [params.endpointId, JSON.stringify(params.payload ?? {}), params.idempotencyKey ?? null],
  );

  const bruto = linhas[0]?.resultado ?? null;
  const jobId = typeof bruto?.job_id === "string" ? bruto.job_id : null;
  const motivo = comoMotivo(bruto?.motivo);

  // Sem `job_id` E sem motivo conhecido: alguém mexeu na função do banco sem
  // mexer aqui. Tratar como "fila cheia" é o único jeito de não responder
  // "aceitei" pra um trabalho que não existe.
  if (jobId === null && motivo === null) {
    return { jobId: null, motivo: "fila-cheia" };
  }

  const escopo = comoEscopo(bruto?.escopo);
  return escopo ? { jobId, motivo, escopo } : { jobId, motivo };
}

// ---------------------------------------------------------------------------
// Contar o resultado de volta
// ---------------------------------------------------------------------------

/**
 * Conta pro agendamento o que aconteceu.
 *
 * `pausar: true` DESLIGA o agendamento. Use quando repetir amanhã daria o
 * mesmo erro (por exemplo: a automação usa uma ferramenta que ainda não roda
 * fora da tela). Falhar todo dia às 8h calado é o pior resultado possível.
 */
export async function reportScheduleResult(params: {
  scheduleId: string;
  /** JÁ em PT-BR leigo. */
  error: string | null;
  pausar: boolean;
}): Promise<void> {
  await chamar(
    "select public.schedule_report_result(_schedule_id => $1, _error => $2, _pausar => $3)",
    [params.scheduleId, params.error, params.pausar],
  );
}

/**
 * Fecha a execução SEM sessão. É a irmã de `finish_agent_run` pro processo do
 * container, que não tem `auth.uid()` nenhum.
 *
 * ⚠️ A conta (tokens e custo) continua saindo do RASTRO (`agent_run_steps`),
 * nunca de um número que chegue por parâmetro. E `agent_runs` continua SEM
 * permissão de `update` pra quem está logado — nada aqui devolve isso.
 */
export async function finishAgentRunSystem(params: {
  runId: string;
  status: AgentRunStatus;
  output?: string | null;
  /** JÁ em PT-BR leigo. */
  errorMessage?: string | null;
}): Promise<void> {
  await chamar(
    "select public.finish_agent_run_system(_run_id => $1, _status => $2, _output => $3, " +
      "_error_message => $4)",
    [params.runId, params.status, params.output ?? null, params.errorMessage ?? null],
  );
}

// ---------------------------------------------------------------------------
// Webhook: conferência e limite
// ---------------------------------------------------------------------------

export type EndpointParaConferir = {
  id: string;
  organizationId: string;
  agentId: string;
  /** sha256 do token. NUNCA sai deste processo. */
  tokenHash: string;
  isActive: boolean;
  runAs: string | null;
  /** "ensaio" (não age de verdade) ou "real" (age). Nasce em ensaio. */
  modo: ModoDeExecucao;
  /** Se este endereço espera a resposta do agente antes de responder. */
  esperarResposta: boolean;
};

/**
 * A linha do endpoint, com o hash do token, pra comparação em tempo constante
 * do lado do Node.
 *
 * ⚠️ A função do banco é inalcançável por quem está logado, e tem que
 * continuar assim: alcançável, ela entregaria o hash do token de todos os
 * webhooks do banco pra qualquer pessoa com conta.
 */
export async function webhookEndpointForCheck(
  endpointId: string,
): Promise<EndpointParaConferir | null> {
  const linhas = await chamar<{
    id: string;
    organization_id: string;
    agent_id: string;
    token_hash: string;
    is_active: boolean;
    run_as: string | null;
    modo: string;
    esperar_resposta: boolean;
  }>("select * from public.webhook_endpoint_for_check(_endpoint_id => $1)", [endpointId]);

  const linha = linhas[0];
  if (!linha) return null;
  return {
    id: linha.id,
    organizationId: linha.organization_id,
    agentId: linha.agent_id,
    tokenHash: linha.token_hash,
    isActive: linha.is_active,
    runAs: linha.run_as,
    modo: linha.modo === "real" ? "real" : "ensaio",
    esperarResposta: linha.esperar_resposta,
  };
}

/**
 * Conta a chamada e responde se ela cabe no limite do minuto.
 *
 * O limite é contado NO BANCO de propósito: o limitador do `proxy.ts` vive na
 * memória de cada processo, então com duas cópias do app cada uma contaria
 * metade.
 */
export async function webhookTouch(endpointId: string, limitePorMinuto = 60): Promise<boolean> {
  const linhas = await chamar<{ ok: boolean | null }>(
    "select public.webhook_touch(_endpoint_id => $1, _limite_por_minuto => $2) as ok",
    [endpointId, limitePorMinuto],
  );
  return linhas[0]?.ok === true;
}

// ---------------------------------------------------------------------------
// Webhook síncrono: esperar o resultado
// ---------------------------------------------------------------------------
//
// ⚠️ ISTO NÃO RODA O AGENTE. É só uma ESPERA sobre a fila que já existe — quem
// enfileira continua sendo `enqueueWebhookJob` (a linha acima) e quem roda
// continua sendo o trabalhador, do outro processo. Aqui a rota só fica
// perguntando pro banco "esse trabalho já terminou?" a cada meio segundo.
//
// O corte de 50 s (`PRAZO_DO_WEBHOOK_MS`) vem de fora: quem chama o webhook
// está do lado de fora do container, então a chamada atravessa o proxy do
// EasyPanel, que corta requisição parada em ~60 s (mesmo corte de
// `lib/knowledge/actions.ts`, `chunk.ts` e `embed.ts`). 50 s fica abaixo desse
// número, com 10 s de margem pro tempo de rede e de resposta.

/** 50 s: abaixo do corte do proxy do EasyPanel (~60 s), com margem. */
export const PRAZO_DO_WEBHOOK_MS = 50_000;
/** De quanto em quanto tempo a espera pergunta de novo pro banco. */
const INTERVALO_DA_ESPERA_MS = 500;

/** Uma linha de `webhook_job_result`, já traduzida pro formato do TypeScript. */
export type LinhaDeResultadoDoWebhook = {
  status: JobStatus;
  /** JÁ em PT-BR leigo — quem escreveu foi o trabalhador. */
  lastError: string | null;
  runId: string | null;
  output: string | null;
  /** `null` = a execução não tem custo gravado ainda (ou nunca abriu). */
  costMicros: number | null;
  runStatus: AgentRunStatus | null;
  /**
   * EM QUE MODO A RODADA RODOU — de `agent_runs.modo`, nunca de
   * `webhook_endpoints.modo`.
   *
   * ⚠️ A DIFERENÇA ENTRE OS DOIS É UM DEFEITO INTEIRO. O do endereço é
   * CONFIGURAÇÃO: alguém vira a chavinha na tela de Automações e ele muda. O
   * daqui é REGISTRO, e é imutável (`freeze_agent_run_keys`). Ler a
   * configuração pra responder sobre uma rodada que já passou fazia a resposta
   * afirmar `ensaio: true` numa execução em que o email SAIU.
   *
   * `null` = o trabalho nem chegou a abrir execução. Quem chama trata isso
   * como "não foi ensaio" — silêncio, nunca a promessa de que nada saiu.
   */
  runModo: "ensaio" | "real" | null;
};

/**
 * Pergunta pro banco, UMA VEZ, como está o trabalho de um webhook.
 *
 * ⚠️ `_endpoint_id` no `where` (dentro da função do banco) é o que prende o
 * resultado ao endereço que fez a chamada: um `jobId` de outro workspace, ou
 * de outro endereço, devolve nenhuma linha — nunca o resultado de outra
 * organização.
 */
async function webhookJobResult(
  endpointId: string,
  jobId: string,
): Promise<LinhaDeResultadoDoWebhook | null> {
  const linhas = await chamar<{
    status: string;
    last_error: string | null;
    run_id: string | null;
    output: string | null;
    // `bigint` do Postgres chega como STRING pelo driver `pg` (evita perder
    // precisão em número grande demais pro `number` do JS). Micro-dólar não
    // chega nem perto desse teto, então convertemos com segurança.
    cost_micros: string | null;
    run_status: string | null;
    run_modo: string | null;
  }>("select * from public.webhook_job_result(_endpoint_id => $1, _job_id => $2)", [
    endpointId,
    jobId,
  ]);

  const linha = linhas[0];
  if (!linha) return null;

  return {
    status: linha.status as JobStatus,
    lastError: linha.last_error,
    runId: linha.run_id,
    output: linha.output,
    costMicros: linha.cost_micros === null ? null : Number(linha.cost_micros),
    runStatus: (linha.run_status as AgentRunStatus | null) ?? null,
    // Fechado na marra: só o texto exato "ensaio" vira ensaio. Qualquer outra
    // coisa (nulo, coluna que ainda não existe, texto torto) cai em "real",
    // que é o silêncio — mesmo critério do `open_agent_run_system`.
    runModo: linha.run_modo === "ensaio" ? "ensaio" : linha.run_modo === null ? null : "real",
  };
}

/** O que a espera do webhook síncrono devolve. */
export type ResultadoDoTrabalho =
  /** O prazo estourou antes do trabalho terminar. A rota devolve 202 com um
   *  endereço pra buscar o resultado depois. */
  | { tipo: "prazo" }
  /** O trabalho terminou em falha (ou foi cancelado). */
  | { tipo: "falhou"; erro: string }
  /** O trabalho terminou com sucesso. */
  | {
      tipo: "concluido";
      output: string | null;
      costMicros: number | null;
      /** Veio de `agent_runs.modo` — o que a rodada FOI. Ver `runModo` acima. */
      ensaio: boolean;
    };

function comoResultado(linha: LinhaDeResultadoDoWebhook): ResultadoDoTrabalho | null {
  if (linha.status === "done") {
    return {
      tipo: "concluido",
      output: linha.output,
      costMicros: linha.costMicros,
      ensaio: linha.runModo === "ensaio",
    };
  }
  if (linha.status === "failed" || linha.status === "cancelled") {
    return {
      tipo: "falhou",
      erro: linha.lastError ?? "O agente não conseguiu terminar essa execução.",
    };
  }
  // "pending" ou "running": ainda não terminou, a espera continua.
  return null;
}

/**
 * Espera o trabalho de um webhook SÍNCRONO terminar, perguntando pro banco a
 * cada `INTERVALO_DA_ESPERA_MS` até `status` virar `done`/`failed`/`cancelled`
 * ou o prazo (`prazoMs`) estourar.
 *
 * ⚠️ Só função com nome (regra 10-G do CLAUDE.md): a leitura é
 * `webhook_job_result`, `security definer`, inalcançável por quem está
 * logado.
 *
 * `signal` (opcional): quando quem chamou desiste (fechou a conexão), o
 * laço para de perguntar pro banco em vez de continuar até o prazo estourar
 * sem ninguém ouvindo a resposta. Não é uma questão de conexão presa (cada
 * volta pega e devolve do `pool`) — é só consulta jogada fora.
 */
export async function esperarResultadoDoTrabalho(p: {
  endpointId: string;
  jobId: string;
  prazoMs: number;
  signal?: AbortSignal;
}): Promise<ResultadoDoTrabalho> {
  const comeco = Date.now();

  for (;;) {
    if (p.signal?.aborted) {
      return { tipo: "prazo" };
    }

    const linha = await webhookJobResult(p.endpointId, p.jobId);
    if (linha) {
      const resultado = comoResultado(linha);
      if (resultado) return resultado;
    }

    if (Date.now() - comeco >= p.prazoMs) {
      return { tipo: "prazo" };
    }

    await new Promise((resolve) => setTimeout(resolve, INTERVALO_DA_ESPERA_MS));
  }
}

/**
 * A rota de "buscar depois" (`.../j/[jobId]`) chama isto UMA VEZ só, sem
 * laço: se ainda estiver rodando, ela responde 202 com `{ status: "running" }`
 * e quem chamou tenta de novo mais tarde.
 */
export async function buscarResultadoDoTrabalho(
  endpointId: string,
  jobId: string,
): Promise<LinhaDeResultadoDoWebhook | null> {
  return webhookJobResult(endpointId, jobId);
}

/**
 * O TETO DE GASTO daquele workspace, pelo caminho do trabalhador.
 *
 * O motor já confere o teto por dentro (é o passo 2a de `prepareAgentRun`).
 * Esta leitura existe pra a frase sair CERTA antes disso: o trabalhador precisa
 * saber que a rodada foi pulada por causa do dinheiro pra escrever isso em
 * `jobs.last_error` e contar pro agendamento — sem desligar a automação, porque
 * o teto zera sozinho na virada do mês.
 *
 * `null` = não deu pra ler. Quem chama decide (e o `run-job.ts` decidiu seguir:
 * o motor confere de novo lá na frente).
 */
export async function orgBudgetStatus(organizationId: string): Promise<BudgetStatus | null> {
  const linhas = await chamar<LinhaDeStatus>(
    "select * from public.org_ai_budget_status(_organization_id => $1)",
    [organizationId],
  );
  const linha = linhas[0];
  return linha ? budgetStatusDaLinha(linha) : null;
}

/** Quantos tokens de IA sobraram no balde da automação daquele workspace hoje. */
export async function automationBudgetLeft(organizationId: string): Promise<number> {
  const linhas = await chamar<{ n: number | null }>(
    "select public.automation_budget_left(_organization_id => $1) as n",
    [organizationId],
  );
  return linhas[0]?.n ?? 0;
}

/**
 * Fecha o trabalho engolindo o próprio erro.
 *
 * Existe porque fechar a fila é a ÚLTIMA coisa que acontece num caminho de
 * falha: se essa gravação estourar, o erro de verdade (o que fez o agente
 * falhar) sumiria da vista. A faxina (`reclaim_stuck_jobs`) recolhe o trabalho
 * depois.
 */
export async function finishJobBestEffort(params: {
  jobId: string;
  status: "done" | "failed" | "cancelled";
  error?: string | null;
  runId?: string | null;
  retryInSeconds?: number | null;
}): Promise<void> {
  try {
    await finishJob(params);
  } catch (err) {
    logError("automation/finishJob", err);
  }
}

/**
 * "Quem é dono de qual workspace" — pra `npm run semear` saber quem
 * impersonar ANTES de abrir a sessão da ponte. Sem `_organization_id`, devolve
 * TODOS os workspaces (varredura completa); com ele, só aquele.
 *
 * DEVOLVE LINHA CRUA, NUNCA ESCOLHE. `userId: null` (workspace sem dono — não
 * deveria acontecer, mas o banco só garante "pelo menos um" por gatilho, não
 * "no máximo um") ou 2+ linhas pro MESMO `organizationId` (dois owners —
 * também não deveria acontecer; o único caminho pra virar dono é
 * `transfer_ownership`, atômico) são decisão de quem chama: nunca adivinhar
 * identidade, sempre pular e registrar — o mesmo padrão de
 * `ResultadoDaSemeadura.agendamentosPulados` (`lib/seed/materializar.ts`).
 *
 * ⚠️ RODADA DE CONSERTO 1 (I2): a função do banco faz `left join` a partir de
 * `organizations`, então TODO workspace relevante devolve PELO MENOS uma
 * linha — nunca "0 linhas" pra um workspace que existe. Sem isso, um
 * workspace órfão desaparecia da varredura completa em silêncio, em vez de
 * cair no ramo "sem-dono" de `semearWorkspaces` (`lib/seed/semear.ts`).
 */
export async function ownerMembershipsForSeed(
  organizationId?: string,
): Promise<{ organizationId: string; userId: string | null }[]> {
  const linhas = await chamar<{ organization_id: string; user_id: string | null }>(
    "select * from public.owner_memberships_for_seed(_organization_id => $1)",
    [organizationId ?? null],
  );
  return linhas.map((l) => ({ organizationId: l.organization_id, userId: l.user_id }));
}
