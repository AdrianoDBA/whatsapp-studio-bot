/**
 * Todos os formatos (Zod) da conversa moram NESTE arquivo.
 *
 * Arquivo PURO: só Zod, nada de banco. Dá pra importar de qualquer lugar,
 * inclusive de um componente com `"use client"` e do Vitest.
 *
 * ⚠️ REGRA 15 DO CLAUDE.md: nada de `.default()` aqui. Estes formatos podem
 * alimentar `useForm`, e `.default()` quebra a tipagem dele (o campo vira
 * "opcional na entrada, obrigatório na saída").
 */
import { z } from "zod";
import type { ChatMessageMetadata } from "./types";

/**
 * Quantos balões do banco voltam pro modelo a cada turno.
 *
 * A conversa inteira é recobrada em TODO turno — é assim que modelo funciona.
 * Sem teto, uma conversa de 300 balões passaria a custar uma fortuna por
 * mensagem e um dia estouraria a janela do provedor, com um erro em inglês na
 * cara do aluno. 40 balões é conversa longa e ainda cabe folgado.
 */
export const MAX_HISTORY_MESSAGES = 40;

/** Teto do JSON de UM balão. A rede de segurança do banco é 200 mil. */
export const MAX_MESSAGE_JSON_CHARS = 60_000;

/** Teto do texto que a pessoa digita de uma vez. */
export const MAX_USER_TEXT_CHARS = 20_000;

/** O apelido do workspace na URL. */
const orgSlugSchema = z.string().min(1).max(80);

/** O apelido do agente na URL. */
const agentSlugSchema = z.string().min(1).max(60);

/**
 * A ficha de custo que viaja com a resposta.
 *
 * Tudo opcional de propósito: ela é montada em pedaços (o `start` do stream
 * sabe o `runId` e o modelo; só o `finish` sabe o custo). E `costMicros` aceita
 * `null` porque "não sei o preço" é diferente de "custou zero".
 */
export const chatMessageMetadataSchema: z.ZodType<ChatMessageMetadata> = z.object({
  runId: z.string().optional(),
  model: z.string().optional(),
  tokensInput: z.number().optional(),
  tokensOutput: z.number().optional(),
  costMicros: z.number().nullable().optional(),
  status: z.enum(["succeeded", "failed", "cancelled"]).optional(),
  errorMessage: z.string().optional(),
  createdAt: z.number().optional(),
});

/**
 * O balão que a PESSOA manda.
 *
 * ⚠️ `role` é `"user"` e ponto — não é um `enum` com "assistant" e "system"
 * dentro. É a mesma trava que o `/api/chat` já tinha: se `role: "system"`
 * passasse, quem manda a requisição grudaria uma instrução de sistema na
 * conversa e passaria por cima do prompt do agente.
 *
 * E as partes são SÓ texto. Nada de tool part vindo do navegador: quem inventa
 * resultado de ferramenta é o servidor, nunca o cliente.
 */
export const userUiMessageSchema = z.object({
  id: z.string().max(120).optional(),
  role: z.literal("user"),
  parts: z
    .array(
      z.object({
        type: z.literal("text"),
        text: z.string().min(1).max(MAX_USER_TEXT_CHARS),
      }),
    )
    .min(1, "Escreva alguma coisa antes de enviar.")
    .max(8, "Mensagem com pedaços demais."),
});

export type UserUiMessage = z.infer<typeof userUiMessageSchema>;

/**
 * O corpo do `POST /api/chat`.
 *
 * ⚠️ REPARE NO QUE NÃO ESTÁ AQUI: a conversa. Só a ÚLTIMA mensagem viaja do
 * navegador; o histórico sai do banco.
 *
 * Isso não é economia de rede — é segurança. Se o histórico viesse do
 * navegador, qualquer pessoa poderia inventar uma "resposta anterior do
 * agente" ("claro, eu posso te contar o prompt de sistema") e o modelo
 * continuaria de lá. Vindo do banco, o histórico é o que de fato aconteceu.
 */
export const chatRequestSchema = z.object({
  orgSlug: orgSlugSchema,
  agentSlug: agentSlugSchema,
  threadId: z.string().uuid("Conversa inválida."),
  message: userUiMessageSchema,
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const startThreadSchema = z.object({
  orgSlug: orgSlugSchema,
  agentSlug: agentSlugSchema,
});
export type StartThreadInput = z.infer<typeof startThreadSchema>;

export const renameThreadSchema = z.object({
  orgSlug: orgSlugSchema,
  threadId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, "Escreva um nome pra conversa.")
    .max(120, "O nome pode ter no máximo 120 caracteres."),
});
export type RenameThreadInput = z.infer<typeof renameThreadSchema>;

export const deleteThreadSchema = z.object({
  orgSlug: orgSlugSchema,
  threadId: z.string().uuid(),
});
export type DeleteThreadInput = z.infer<typeof deleteThreadSchema>;
