/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  O QUE ESTE PRODUTO TEM DENTRO. É aqui que você declara.                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Agente, base de conhecimento, agendamento e webhook nascem DAQUI — não de
 * formulário. Quando um workspace é criado, `materializarWorkspace` lê estas
 * quatro listas e grava as linhas correspondentes. Pra workspaces que já
 * existem, `npm run semear` faz o mesmo.
 */

import { atendimentoAgente } from "@/lib/agents/atendimento";
import type { AgentBlueprint } from "@/lib/agents/blueprint";
import type { ScheduleBlueprint, WebhookBlueprint } from "@/lib/automation/blueprint";
import type { KnowledgeBaseBlueprint } from "@/lib/knowledge/blueprint";

/** Os agentes deste produto. */
export const AGENTES: readonly AgentBlueprint[] = [atendimentoAgente];

/** As bases de conhecimento deste produto. */
export const BASES: readonly KnowledgeBaseBlueprint[] = [];

/** Automação diária de fechamento e resumo de atendimentos */
export const resumoDiarioAtendimento: ScheduleBlueprint = {
  slug: "resumo-diario",
  name: "Resumo Diário de Atendimentos",
  agentSlug: "atendimento",
  kind: "daily",
  hour: 19,
  minute: 0,
  timezone: "America/Sao_Paulo",
  input: {
    instrucao: "Gere um resumo executivo dos atendimentos do dia no WhatsApp da empresa, com perguntas frequentes e solicitações pendentes.",
  },
  entrega: { tipo: "nenhuma" },
};

/** Os agendamentos. Nascem em modo ensaio e podem ser ligados pelo painel de automações. */
export const AGENDAMENTOS: readonly ScheduleBlueprint[] = [resumoDiarioAtendimento];

/** Webhook para integrações externas (CRM, Typeform, Webhooks externos) */
export const webhookAtendimento: WebhookBlueprint = {
  slug: "webhook-atendimento",
  label: "Integração Externa de Atendimento",
  agentSlug: "atendimento",
  esperarResposta: true,
};

/**
 * Os webhooks. Nascem associados ao agente de atendimento.
 */
export const WEBHOOKS: readonly WebhookBlueprint[] = [webhookAtendimento];
