/**
 * Todos os formatos (Zod) do domínio de agentes moram NESTE arquivo.
 *
 * Não tem formato de criar/editar/apagar agente — isso não é mais função do
 * servidor nenhuma. Agente nasce de arquivo (`lib/agents/blueprint.ts`) e é
 * gravado por `materializarWorkspace`; editar é editar a planta e materializar
 * de novo. O único formato de tela que sobra é `runAgentInputSchema`, do
 * playground.
 *
 * Arquivo PURO: só Zod, nada de banco. Dá pra importar de qualquer lugar.
 */
import { z } from "zod";

/**
 * O apelido do agente na URL. Bate com a restrição `agents_slug_format` do
 * banco: minúsculas, números e hífen, de 2 a 60 caracteres.
 */
export const agentSlugSchema = z
  .string()
  .min(2, "O apelido precisa de pelo menos 2 caracteres.")
  .max(60, "O apelido pode ter no máximo 60 caracteres.")
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "O apelido só aceita letras minúsculas, números e hífen (ex.: meu-agente).",
  );

/** O identificador de uma ferramenta do registro em código. */
export const toolIdSchema = z
  .string()
  .min(2, "O nome da ferramenta é curto demais.")
  .max(48, "O nome da ferramenta é longo demais.")
  .regex(
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    "Nome de ferramenta só aceita letras minúsculas, números e hífen.",
  );

/**
 * Uma mensagem da conversa que o agente recebe.
 *
 * NÃO aceita `role: "system"`, de propósito. Se aceitasse, quem manda a
 * requisição poderia grudar uma instrução de sistema na conversa e passar por
 * cima do prompt do agente — é o mesmo bloqueio que o `/api/chat` já tem.
 */
export const agentRunMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .min(1, "Mensagem vazia.")
    .max(20_000, "Mensagem longa demais (máximo 20.000 caracteres)."),
});

export type AgentRunMessage = z.infer<typeof agentRunMessageSchema>;

/**
 * A entrada que o MOTOR aceita.
 *
 * Três jeitos de pedir alguma coisa pro agente, e dá pra combinar:
 *   • `prompt`   — um pedido só, em texto. É o caso do botão "rodar".
 *   • `messages` — a conversa inteira. É o caso do chat.
 *   • `data`     — dado estruturado (o corpo de um webhook, por exemplo). Ele
 *                  entra na conversa marcado como DADO, nunca como instrução.
 */
export const agentRunInputSchema = z
  .object({
    prompt: z.string().min(1).max(20_000).optional(),
    messages: z.array(agentRunMessageSchema).min(1).max(50).optional(),
    data: z.unknown().optional(),
  })
  .refine((v) => Boolean(v.prompt) || (v.messages?.length ?? 0) > 0, {
    message: "Escreva o que você quer pedir pro agente.",
  });

export type AgentRunInput = z.infer<typeof agentRunInputSchema>;

/** O apelido do workspace na URL. */
const orgSlugSchema = z.string().min(1).max(80);

/**
 * O que o playground manda pra rodar o agente.
 *
 * Não confundir com o `agentRunInputSchema` lá de cima: aquele é o que o MOTOR
 * aceita (conversa inteira, dado estruturado); este é o que a TELA manda (uma
 * mensagem só, e o endereço de qual agente rodar).
 */
export const runAgentInputSchema = z.object({
  orgSlug: orgSlugSchema,
  agentId: z.string().uuid(),
  message: z
    .string()
    .trim()
    .min(1, "Escreva o que você quer pedir pro agente.")
    .max(8_000, "O pedido passou de 8.000 caracteres. Encurte um pouco."),
  /**
   * A chave de ensaio do playground. `"ensaio"` = nenhuma ação sai pra fora
   * (`ctx.acao` não manda email de verdade). Opcional e SEM `.default()` de
   * propósito (regra 15 do CLAUDE.md: `.default()` quebra a tipagem do
   * `useForm`) — quem decide o padrão é a tela (a chave nasce ligada) e o
   * motor (`RunAgentParams.modo` cai pra `"real"` se nada chegar aqui).
   */
  modo: z.enum(["ensaio", "real"]).optional(),
});
export type RunAgentActionInput = z.infer<typeof runAgentInputSchema>;
