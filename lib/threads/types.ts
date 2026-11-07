/**
 * Tipos da CONVERSA com o agente.
 *
 * ESTA É A CASA DOS TIPOS DE `lib/threads`. Os outros arquivos da pasta
 * reexportam daqui — ninguém redeclara. Mesma disciplina de `lib/agents/types`
 * e `lib/ai/types`, e pelo mesmo motivo: quando o mesmo tipo existe em dois
 * lugares com formatos diferentes, o código que importa do lugar errado só
 * quebra em produção.
 *
 * Arquivo PURO e só de tipos: pode ser importado por página, por componente
 * com `"use client"` e por teste, sem arrastar nada de servidor junto.
 *
 * ⚠️ O `UIMessage` vem do AI SDK, e isso é de propósito. A coluna
 * `thread_messages.parts` guarda EXATAMENTE o formato que a tela consome, então
 * não existe tradução no meio do caminho — o que sai do banco entra no
 * `useChat` como está.
 */
import type { UIMessage } from "ai";
import type { Database, Tables } from "@/types/supabase";

/** Uma linha da tabela `threads`: a conversa em si. */
export type ThreadRecord = Tables<"threads">;

/** Uma linha da tabela `thread_messages`: um balão da conversa. */
export type ThreadMessageRecord = Tables<"thread_messages">;

/** "user" | "assistant" | "tool" — de quem é o balão. */
export type ThreadMessageRole = Database["public"]["Enums"]["thread_message_role"];

/**
 * A ficha que viaja grudada em cada balão de resposta do agente.
 *
 * É o que deixa a bolha mostrar "custou US$ 0,0012 · 340 tokens · ver o rastro"
 * sem a tela precisar ir buscar a execução no banco. Vai junto no streaming
 * (no `start` e no `finish`) e fica gravada em `thread_messages.metadata`.
 */
export type ChatMessageMetadata = {
  /** A execução que produziu esta resposta. Linka pro rastro completo. */
  runId?: string;
  /** `"provedor:modelo"`, do jeito que está em `agents.model`. */
  model?: string;
  tokensInput?: number;
  tokensOutput?: number;
  /** `null` = preço desconhecido. NUNCA 0 pra "não sei". */
  costMicros?: number | null;
  status?: "succeeded" | "failed" | "cancelled";
  /** JÁ em PT-BR leigo. A tela mostra cru. */
  errorMessage?: string;
  /** Quando a resposta começou, em milissegundos do relógio do servidor. */
  createdAt?: number;
};

/** Uma mensagem da conversa, com a nossa ficha de custo colada nela. */
export type AgentUIMessage = UIMessage<ChatMessageMetadata>;

/** Uma conversa na listagem lateral. */
export type ThreadListItem = {
  id: string;
  title: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  userId: string;
  /** Nome de quem começou a conversa. `null` quando o perfil não tem nome. */
  authorName: string | null;
  /** `true` quando quem está olhando é quem começou — só ele consegue escrever. */
  isMine: boolean;
};

/**
 * Uma resposta que ficou pendurada.
 *
 * Acontece quando a pessoa fecha a aba (ou o container cai) no meio de uma
 * resposta. O `consumeStream()` da rota faz o servidor terminar de consumir o
 * modelo assim mesmo, então o rastro e o custo são apurados — mas o balão da
 * resposta pode não ter sido gravado. Esta é a peça que deixa a tela dizer
 * "essa resposta ficou pela metade" em vez de mostrar a conversa mentindo.
 */
export type PendingAnswer = {
  runId: string;
  status: Database["public"]["Enums"]["agent_run_status"];
  output: string | null;
  /** JÁ em PT-BR leigo. */
  errorMessage: string | null;
  startedAt: string | null;
  /** `true` quando está em "running" há mais de 5 minutos. */
  abandonada: boolean;
};
