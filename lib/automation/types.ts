/**
 * Os tipos da automação: fila, agendamento e webhook.
 *
 * Arquivo PURO e só de tipos: dá pra importar de página, de componente com
 * `"use client"` e de teste, sem arrastar `pg` nem cliente de banco junto.
 *
 * A casa dos tipos é AQUI. Os outros arquivos da pasta reexportam daqui —
 * ninguém redeclara. Mesma disciplina de `lib/agents/types.ts`.
 */
import type { ModoDeExecucao } from "@/lib/agents/acoes";
import type { Database, Tables } from "@/types/supabase";
import type { Entrega } from "./entrega";

/** Uma linha da tabela `jobs`: um trabalho na fila. */
export type JobRecord = Tables<"jobs">;

/** Uma linha da tabela `schedules`: um agendamento ("toda segunda às 9h"). */
export type ScheduleRecord = Tables<"schedules">;

/** Uma linha da tabela `webhook_endpoints`: um endereço secreto de disparo. */
export type WebhookEndpointRecord = Tables<"webhook_endpoints">;

/** "pending" | "running" | "done" | "failed" | "cancelled" */
export type JobStatus = Database["public"]["Enums"]["job_status"];

/**
 * Como o agendamento se repete.
 *
 * Não usamos sintaxe de cron de propósito: leigo não escreve `0 8 * * 1-5` e
 * não confere se escreveu certo. Quem monta a frase em português é
 * `descreverAgendamento`, em `lib/automation/schedules.ts`.
 */
export type ScheduleKind = "daily" | "weekly" | "monthly" | "interval";

/** De onde veio o trabalho que está na fila. */
export type AutomationSource = "schedule" | "webhook" | "manual";

/**
 * O que a TELA pode ver de um endpoint de webhook.
 *
 * ⚠️ NÃO TEM `token` NEM `token_hash`, e não pode ter. O token aparece uma vez
 * só, na hora em que é criado; depois disso o banco guarda só o sha256 dele, e
 * a coluna `token_hash` está fora do `grant select` de `authenticated`.
 */
export type WebhookSummary = {
  id: string;
  label: string;
  agentId: string;
  agentName: string;
  url: string;
  /** Os primeiros caracteres, só pra pessoa reconhecer qual é qual. */
  tokenPrefix: string;
  isActive: boolean;
  lastCalledAt: string | null;
  callsCount: number;
  runAsUserId: string | null;
  runAsName: string | null;
  /** "ensaio" (não age de verdade) ou "real" (age). Nasce em ensaio. */
  modo: ModoDeExecucao;
  /**
   * `true` = quem chamar espera a resposta do agente na própria chamada.
   * `false` = recebe um comprovante na hora e busca o resultado depois.
   * Escolhido na criação; não tem tela de editar.
   */
  esperarResposta: boolean;
};

/** O que a tela mostra de um agendamento. */
export type ScheduleSummary = {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  /** A frase em português ("toda segunda-feira às 9:00"). */
  descricao: string;
  timezone: string;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** JÁ em PT-BR leigo. A tela mostra cru. */
  lastError: string | null;
  runAsUserId: string | null;
  runAsName: string | null;
  /** true quando quem armou a automação não está mais no workspace. */
  orfa: boolean;
  /** "ensaio" (não age de verdade) ou "real" (age). Nasce em ensaio. */
  modo: ModoDeExecucao;
  /** O que fazer com o resultado quando ela roda. Escolhido na criação. */
  entrega: Entrega;
};

/**
 * Um trabalho pronto pra rodar, do jeito que a rota interna precisa dele.
 *
 * ⚠️ TODO CAMPO AQUI SAI DA LINHA DA TABELA `jobs`, gravada pelas funções de
 * enfileirar (que são `security definer`). NADA disso vem do corpo de um
 * pedido HTTP — é isso que impede alguém de pedir "rode no nome de outra
 * pessoa" (ameaça T5 do contrato).
 */
/** O que este trabalho é. Cada tipo tem um caminho próprio no trabalhador. */
export type JobKind = "run_agent" | "ingest_document";

export type JobParaRodar = {
  id: string;
  organizationId: string;
  kind: JobKind;
  /** `null` quando o trabalho não é de agente (indexar documento, por ex.). */
  agentId: string | null;
  /** A entrada do agente. Ainda NÃO validada — quem valida é o motor. */
  input: unknown;
  /** Quem o agente representa. É o `auth.uid()` da execução agendada. */
  runAs: string | null;
  sourceKind: AutomationSource;
  /** O agendamento ou o webhook que originou isto. */
  sourceId: string | null;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
};

/** O resultado de rodar um trabalho. `error` JÁ em PT-BR leigo. */
export type RunJobResult =
  // `runId` é `null` quando o trabalho não abre execução de agente — é o caso
  // de indexar documento, que não é o agente pensando e por isso não tem
  // rastro nem custo de modelo.
  | { ok: true; runId: string | null; status: "succeeded" | "failed" | "cancelled" }
  | { ok: false; error: string; runId: string | null; retryable: boolean };

/** Um token de webhook recém-sorteado. Ele só existe nesta volta. */
export type TokenNovo = { token: string; tokenHash: string; tokenPrefix: string };

/** O que sai da conferência de um webhook que chegou. */
export type VerificacaoWebhook =
  | {
      ok: true;
      endpointId: string;
      organizationId: string;
      agentId: string;
      runAs: string | null;
      /** "ensaio" (não age de verdade) ou "real" (age). A rota usa isso pra
       *  avisar, na resposta síncrona, que a execução foi um ensaio. */
      modo: ModoDeExecucao;
      /** Se este endereço espera a resposta do agente antes de responder. */
      esperarResposta: boolean;
    }
  | { ok: false; motivo: "nao-encontrado" | "token-invalido" | "desligado" | "limite" };
