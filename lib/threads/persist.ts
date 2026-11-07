/**
 * GRAVAR e RELER a conversa — a peça que faz o chat sobreviver ao F5.
 *
 * ⚠️ NÃO tem `"use server"`. Isto aqui é chamado pela rota `/api/chat` e pelas
 * páginas; expor como função do servidor abriria um endereço público que grava
 * balão na conversa de alguém sem passar por guard nenhum.
 *
 * A REGRA MAIS IMPORTANTE DESTE ARQUIVO é o `sanearMensagem`. Leia o comentário
 * dele antes de mexer em qualquer coisa aqui: sem ele, uma resposta
 * interrompida no meio de uma ferramenta deixa a conversa QUEBRADA PRA SEMPRE,
 * sem conserto pelo lado do aluno.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { convertToModelMessages, type ModelMessage, type ToolSet } from "ai";
import { logError } from "@/lib/logger";
import type { Database, Json } from "@/types/supabase";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_JSON_CHARS, MAX_USER_TEXT_CHARS } from "./schemas";
import type { AgentUIMessage, ChatMessageMetadata, ThreadMessageRole } from "./types";

/** Junta os pedaços de texto de um balão numa string só. */
export function textoDaMensagem(message: AgentUIMessage): string {
  return (message.parts ?? [])
    .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

/**
 * O título da conversa, tirado da primeira coisa que a pessoa escreveu.
 *
 * Só a primeira linha, cortada em 60 caracteres. Uma pergunta de três
 * parágrafos viraria um título ilegível na lista lateral.
 */
export function tituloDaConversa(texto: string): string | null {
  const primeiraLinha =
    texto
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.trim() ?? "";
  if (primeiraLinha.length === 0) return null;
  if (primeiraLinha.length <= 60) return primeiraLinha;
  return `${primeiraLinha.slice(0, 57).trimEnd()}…`;
}

/**
 * LIMPA UM BALÃO ANTES DE ELE VIRAR LINHA NO BANCO.
 *
 * Duas coisas, e as duas vieram de bug de verdade:
 *
 * 1. **Derruba toda chamada de ferramenta que NÃO chegou a ter resultado**
 *    (`state` diferente de `output-available` e de `output-error`).
 *
 *    Por quê: quando a pessoa fecha a aba no meio de uma ferramenta, o balão é
 *    gravado com a chamada e SEM a resposta. No turno seguinte,
 *    `convertToModelMessages` monta um `tool-call` sem o `tool-result` que
 *    combina com ele, e o provedor recusa a conversa inteira. Resultado: a
 *    conversa fica quebrada PRA SEMPRE e o aluno não tem como consertar — a
 *    única saída seria apagar tudo.
 *
 * 2. **Corta texto acima do teto.** É a rede de segurança do limite de 60 mil
 *    caracteres por balão. O banco tem outra (200 mil), mas quem explica o
 *    problema em português é esta.
 */
export function sanearMensagem(message: AgentUIMessage): AgentUIMessage {
  const limpas: AgentUIMessage["parts"] = [];

  for (const parte of message.parts ?? []) {
    // Chamada de ferramenta: só entra quando TEM resposta.
    const ehFerramenta = parte.type === "dynamic-tool" || parte.type.startsWith("tool-");
    if (ehFerramenta) {
      const estado = (parte as { state?: string }).state;
      if (estado !== "output-available" && estado !== "output-error") continue;
      limpas.push(parte);
      continue;
    }

    if (parte.type === "text" && parte.text.length > MAX_USER_TEXT_CHARS) {
      limpas.push({ ...parte, text: `${parte.text.slice(0, MAX_USER_TEXT_CHARS)}…` });
      continue;
    }

    limpas.push(parte);
  }

  return { ...message, parts: limpas };
}

/** O balão vira JSON pro banco — e se passar do teto, sai só o texto. */
function partesParaJson(message: AgentUIMessage): Json {
  const saneada = sanearMensagem(message);
  let texto: string;
  try {
    texto = JSON.stringify(saneada.parts) ?? "[]";
  } catch {
    texto = "[]";
  }

  if (texto.length <= MAX_MESSAGE_JSON_CHARS) return JSON.parse(texto) as Json;

  // Balão gigante (uma ferramenta que devolveu muita coisa, por exemplo). Em
  // vez de recusar a gravação — e perder a resposta que a pessoa acabou de
  // ler —, guarda só o texto e avisa que o resto ficou no rastro.
  const soTexto = textoDaMensagem(saneada).slice(0, MAX_USER_TEXT_CHARS);
  return [
    {
      type: "text",
      text:
        soTexto.length > 0
          ? soTexto
          : "(esta resposta era grande demais pra caber na conversa — ela está inteira no rastro da execução)",
    },
  ] as unknown as Json;
}

/**
 * Acrescenta um balão na conversa.
 *
 * NUNCA lança: a resposta já foi lida pela pessoa: falhar a gravação não pode
 * virar erro na cara dela. Fica registrado com `logError` e a conversa segue.
 * O que acontece na prática quando falha: aquele balão some no próximo F5 — e
 * o rastro da execução continua guardando tudo.
 */
export async function appendMessage(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  threadId: string;
  role: ThreadMessageRole;
  message: AgentUIMessage;
  runId: string | null;
  metadata?: ChatMessageMetadata | null;
}): Promise<void> {
  const { error } = await params.supabase.from("thread_messages").insert({
    thread_id: params.threadId,
    organization_id: params.organizationId,
    role: params.role,
    parts: partesParaJson(params.message),
    run_id: params.runId,
    metadata: (params.metadata ?? null) as Json,
  });

  if (error) logError("threads/appendMessage", error);
}

/**
 * Relê a conversa do banco, já saneada e já pronta pro modelo.
 *
 * Devolve `AgentUIMessage[]` (o formato da tela) — quem converte pro formato do
 * modelo é quem chama, com `convertToModelMessages`, porque só ele sabe quais
 * ferramentas estão ligadas nesta execução.
 *
 * ⚠️ ORDENA POR `seq`, NUNCA por `created_at`. Duas mensagens gravadas na
 * mesma transação empatam no relógio e a conversa embaralha.
 */
export async function loadHistory(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  threadId: string;
  /** As ferramentas desta execução. Só serve pro `convertToModelMessages`. */
  tools: ToolSet;
  limit?: number;
}): Promise<AgentUIMessage[]> {
  const limite = Math.max(1, Math.min(params.limit ?? MAX_HISTORY_MESSAGES, 200));

  // Pega os ÚLTIMOS `limite` balões (por isso desc) e depois vira do avesso:
  // o que interessa numa conversa longa é o fim dela, não o começo.
  const { data, error } = await params.supabase
    .from("thread_messages")
    .select("id, role, parts, metadata, seq")
    .eq("organization_id", params.organizationId)
    .eq("thread_id", params.threadId)
    .order("seq", { ascending: false })
    .limit(limite);

  if (error) {
    logError("threads/loadHistory", error);
    return [];
  }

  const linhas = [...(data ?? [])].reverse();

  return linhas.map((linha) =>
    sanearMensagem({
      id: linha.id,
      // O banco tem três papéis ("user" | "assistant" | "tool"), mas o formato
      // da tela só conhece dois — o resultado da ferramenta mora DENTRO do
      // balão do agente, não num balão separado.
      role: linha.role === "user" ? "user" : "assistant",
      parts: Array.isArray(linha.parts) ? (linha.parts as unknown as AgentUIMessage["parts"]) : [],
      metadata: (linha.metadata ?? undefined) as ChatMessageMetadata | undefined,
    }),
  );
}

/**
 * Converte o histórico pro formato que o modelo entende.
 *
 * Fica aqui (e não na rota) porque o `ignoreIncompleteToolCalls` é a SEGUNDA
 * rede de segurança do problema descrito em `sanearMensagem` — a primeira é o
 * saneamento na gravação, e ela não alcança o que já estava gravado antes.
 */
export async function historicoParaModelo(
  mensagens: AgentUIMessage[],
  tools: ToolSet,
): Promise<ModelMessage[]> {
  return convertToModelMessages(mensagens, { tools, ignoreIncompleteToolCalls: true });
}

/**
 * Dá nome pra conversa, se ela ainda não tiver um.
 *
 * `is("title", null)` no filtro é o que evita corrida: duas mensagens quase
 * simultâneas não renomeiam a conversa duas vezes, e renomear na mão nunca é
 * desfeito por uma mensagem nova.
 *
 * NUNCA lança — conversa sem título é feia, não é erro.
 */
export async function ensureTitle(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  threadId: string;
  texto: string;
}): Promise<void> {
  const titulo = tituloDaConversa(params.texto);
  if (!titulo) return;

  const { error } = await params.supabase
    .from("threads")
    .update({ title: titulo })
    .eq("organization_id", params.organizationId)
    .eq("id", params.threadId)
    .is("title", null);

  if (error) logError("threads/ensureTitle", error);
}
