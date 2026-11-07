/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  O QUE ESTE PRODUTO TEM DENTRO. É aqui que você declara.                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Agente, base de conhecimento, agendamento e webhook nascem DAQUI — não de
 * formulário. Quando um workspace é criado, `materializarWorkspace` lê estas
 * quatro listas e grava as linhas correspondentes. Pra workspaces que já
 * existem, `npm run semear` faz o mesmo.
 *
 * Workspace novo já materializa sozinho: `createOrganizationAction` chama
 * `materializarWorkspace` logo depois da RPC de criação. Pra workspace que já
 * existe, `npm run semear` (`lib/seed/semear.ts`) faz o mesmo, no nome do
 * dono de cada workspace.
 *
 * COMO ACRESCENTAR
 * ----------------
 * Peça ao Claude Code: "quero um agente que faz X". Ele escreve o arquivo em
 * `lib/agents/`, importa aqui, e `npm run verify` confere que a declaração é
 * válida antes de qualquer coisa chegar no banco.
 *
 * ⚠️ APELIDO (`slug`) É PRA SEMPRE. Ele é a chave da materialização: trocar o
 * apelido de uma declaração não renomeia a linha — cria outra, e a antiga vira
 * órfã (fica no banco, intocada). Em base de conhecimento é pior ainda, porque
 * um gatilho do banco congela o apelido e o modelo de embedding.
 *
 * 🔴 `AGENTES` importa `meuAgente` de `_TEMPLATE_agente.ts` — e isso é decisão,
 * não descuido. O prefixo `_TEMPLATE_` normalmente diz "copie-me", mas o
 * produto precisa nascer com UM agente dentro, e criar um segundo arquivo
 * quase idêntico ao molde só pra preencher essa lista seria duplicação.
 * Quando você copiar o molde pra um agente de verdade, troque esta linha pelo
 * import do seu arquivo (ou acrescente o seu do lado — não existe limite).
 */

import { atendimentoAgente } from "@/lib/agents/atendimento";
import type { AgentBlueprint } from "@/lib/agents/blueprint";
import type { ScheduleBlueprint, WebhookBlueprint } from "@/lib/automation/blueprint";
import type { KnowledgeBaseBlueprint } from "@/lib/knowledge/blueprint";

/** Os agentes deste produto. */
export const AGENTES: readonly AgentBlueprint[] = [atendimentoAgente];

/** As bases de conhecimento deste produto. */
export const BASES: readonly KnowledgeBaseBlueprint[] = [];

/** Os agendamentos. Todos nascem DESLIGADOS e em modo ensaio. */
export const AGENDAMENTOS: readonly ScheduleBlueprint[] = [];

/**
 * Os webhooks. Todos nascem LIGADOS, mas inutilizáveis: o token é sorteado e
 * descartado na hora — só "Gerar token", na tela, mostra um que funciona.
 */
export const WEBHOOKS: readonly WebhookBlueprint[] = [];
