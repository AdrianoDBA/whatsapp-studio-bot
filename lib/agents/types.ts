/**
 * Tipos da camada de agentes.
 *
 * ESTA É A CASA DOS TIPOS DE `lib/agents` que vêm do banco. Os outros arquivos
 * da pasta reexportam daqui — ninguém redeclara. É a mesma disciplina de
 * `lib/secrets/types.ts` e `lib/ai/types.ts`, e pelo mesmo motivo: quando o
 * mesmo tipo existe em dois lugares com formatos diferentes, o código que
 * importa do lugar errado só quebra em produção.
 *
 * Arquivo PURO e só de tipos: pode ser importado por página, por componente
 * com "use client" e por teste, sem arrastar nada de servidor junto.
 */
import type { Database, Tables } from "@/types/supabase";

/** Uma linha da tabela `agents`: o agente como ele está gravado no banco. */
export type AgentRecord = Tables<"agents">;

/** Uma linha da tabela `agent_runs`: uma execução do agente, do começo ao fim. */
export type AgentRunRecord = Tables<"agent_runs">;

/** Uma linha da tabela `agent_run_steps`: um passo do rastro daquela execução. */
export type AgentRunStepRecord = Tables<"agent_run_steps">;

/** "draft" (rascunho) | "active" (no ar) | "archived" (aposentado) */
export type AgentStatus = Database["public"]["Enums"]["agent_status"];

/** Quem puxou o gatilho: o chat, o botão "rodar", o agendamento ou um webhook. */
export type AgentTriggerKind = Database["public"]["Enums"]["agent_trigger_kind"];

/** "queued" | "running" | "succeeded" | "failed" | "cancelled" */
export type AgentRunStatus = Database["public"]["Enums"]["agent_run_status"];

/** Um passo do rastro é ou uma fala do modelo ("model") ou uma ferramenta ("tool"). */
export type AgentStepKind = Database["public"]["Enums"]["agent_step_kind"];

/** "owner" | "admin" | "member" — o papel da pessoa dentro do workspace. */
export type OrgRole = Database["public"]["Enums"]["org_role"];
