/**
 * `POST /api/chat` — a conversa com um agente, chegando letra por letra.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE MUDOU (e o que NÃO mudou) EM RELAÇÃO À VERSÃO ANTIGA
 * ═══════════════════════════════════════════════════════════════════════════
 * Antes esta rota tinha um assistente genérico escrito à mão aqui dentro.
 * Agora ela é a porta do MOTOR: quem responde é um agente do workspace, com as
 * instruções, o modelo e as ferramentas que o aluno escolheu no painel — e toda
 * conversa deixa rastro em `agent_runs` / `agent_run_steps`.
 *
 * As três proteções que a versão antiga já tinha continuam aqui, iguais:
 *   1. **Zod recusa `role: "system"`** vindo do navegador (jailbreak). Agora a
 *      trava é dupla: o formato só aceita `role: "user"` **e** o motor manda
 *      `allowSystemInMessages: false` pro AI SDK.
 *   2. **Limite de taxa por pessoa** (10 mensagens por minuto), em memória.
 *   3. **Cota diária de token**, agora descontada DENTRO do motor — assim ela
 *      vale pro chat, pro botão "rodar", pro agendamento e pro webhook, e não
 *      só aqui.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS LINHAS QUE PARECEM DETALHE E NÃO SÃO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Só a ÚLTIMA mensagem vem do navegador.** O histórico sai do banco. Se
 *    ele viesse de fora, qualquer pessoa poderia inventar uma "resposta
 *    anterior do agente" e o modelo continuaria de lá.
 *
 * **2. `result.consumeStream()` sem `await`, logo antes do `return`.** Sem essa
 *    linha, quando a pessoa fecha a aba ninguém consome o stream: o provedor é
 *    abortado no meio, os tokens já queimados nunca são apurados e a execução
 *    fica `running` pra sempre.
 *
 * Todo corpo de erro daqui é TEXTO PURO em PT-BR leigo — a tela mostra cru.
 */
import type { ToolSet } from "ai";
import { getAgentBySlug } from "@/lib/agents/queries";
import { esperarFechamento, streamAgentRun } from "@/lib/agents/stream";
import { getCurrentUser } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { getOrgBySlug } from "@/lib/orgs/queries";
import { createClient } from "@/lib/supabase/server";
import {
  appendMessage,
  ensureTitle,
  historicoParaModelo,
  loadHistory,
  textoDaMensagem,
} from "@/lib/threads/persist";
import { chatRequestSchema } from "@/lib/threads/schemas";
import type { AgentUIMessage, ChatMessageMetadata } from "@/lib/threads/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// -----------------------------------------------------------------------------
// Limite de taxa (o mesmo que já existia)
// -----------------------------------------------------------------------------
// Em memória e POR PROCESSO: com duas réplicas no EasyPanel, cada uma conta a
// sua parte. É proteção contra dedo pesado, não contra ataque — quem segura
// abuso de verdade é a cota diária de token, que é contada no banco.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const RATE_MAP_HARD_CAP = 10_000;

function sweepExpired(now: number) {
  if (rateLimitMap.size < RATE_MAP_HARD_CAP) return;
  for (const [k, v] of rateLimitMap) {
    if (now > v.resetAt) rateLimitMap.delete(k);
  }
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  sweepExpired(now);
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

/**
 * Que código HTTP corresponde a uma recusa do motor.
 *
 * ⚠️ ACOPLAMENTO CONSCIENTE: as duas frases de cota do motor (a do chat e a da
 * automação) carregam as palavras "cota de IA". Se alguém reescrever aquelas
 * frases sem olhar aqui, a resposta vira 503 em vez de 429 — o chat continua
 * dizendo a coisa certa pra pessoa, só o número do cabeçalho fica errado. É o
 * pior caso, e ele é pequeno.
 */
function statusDaRecusa(texto: string): number {
  return /cota de ia/i.test(texto) ? 429 : 503;
}

/**
 * ⚠️ O conjunto de ferramentas usado SÓ pra reler o histórico.
 *
 * `convertToModelMessages` usa `tools` por um motivo só: chamar o
 * `toModelOutput` da ferramenta, quando ela tem um. Nenhuma ferramenta deste
 * app tem (`lib/agents/define-tool.ts` não oferece esse campo), e sem ele o AI
 * SDK serializa o resultado como JSON — exatamente o que acontece passando
 * vazio. Conferido em `node_modules/ai/dist/index.mjs`, `createToolModelOutput`.
 *
 * Vazio, e não o conjunto de verdade, porque o conjunto de verdade só existe
 * DEPOIS que a execução é aberta (ele carrega o gravador de rastro dela), e o
 * histórico precisa estar pronto ANTES.
 *
 * ➕ SE UM DIA `defineTool` GANHAR `toModelOutput`: esta linha para de servir e
 * o histórico volta a ser serializado como JSON puro. O conserto é passar o
 * conjunto de verdade, o que exige abrir a execução antes de reler o histórico.
 */
const SEM_FERRAMENTAS: ToolSet = {};

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Sua sessão expirou. Entre de novo.", { status: 401 });
  }

  if (!checkRateLimit(user.id)) {
    return new Response(
      "Você mandou muitas mensagens em pouco tempo. Espere um minutinho e tente de novo.",
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("Não entendi o formato da mensagem.", { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(raw);
  if (!parsed.success) {
    // ⚠️ A FRASE DO ZOD NÃO VAI PRA TELA. Ela sai em inglês quando o campo não
    // tem mensagem própria — a tela chegou a mostrar "Invalid input: expected
    // object, received undefined" pro aluno. E ninguém digita este corpo: ele é
    // montado pelo `useChat`, então um formato errado aqui é defeito nosso, não
    // erro de quem está escrevendo. Vai pro registro do servidor.
    logError("chat.formato", parsed.error.issues[0]?.message ?? "corpo fora do formato");
    return new Response("Não consegui entender essa mensagem. Atualize a página e tente de novo.", {
      status: 400,
    });
  }
  const { orgSlug, agentSlug, threadId, message } = parsed.data;

  // ⚠️ `getOrgBySlug` e NÃO `requireOrgMember`: o guard chama `redirect()`, que
  // numa rota de API vira um 307 pro /login no meio de um `fetch` — e a tela
  // mostraria "não deu pra falar com a IA" sem nenhuma pista do motivo.
  const membership = await getOrgBySlug(orgSlug, user.id);
  if (!membership) {
    return new Response("Você não faz parte desse workspace.", { status: 403 });
  }
  const org = membership.organization;

  const agent = await getAgentBySlug(org.id, agentSlug);
  if (!agent) {
    return new Response("Esse agente não existe mais neste workspace.", { status: 404 });
  }
  if (agent.status === "archived") {
    return new Response(
      `O agente "${agent.name}" está aposentado, então ele não conversa. Abra ele no painel ` +
        'e mude a situação pra "No ar".',
      { status: 503 },
    );
  }

  // ⚠️ O CLIENTE É CRIADO AQUI, ANTES do `return`. O `consumeStream()` mantém
  // trabalho vivo depois que a resposta já foi devolvida, e ler `cookies()`
  // naquele momento não funciona mais.
  const supabase = await createClient();

  // A conversa tem que existir, ser DESTE agente e ser DESTA pessoa. A regra de
  // segurança do banco recusaria a gravação de qualquer jeito — mas em silêncio
  // (o `appendMessage` nunca lança), e a pessoa veria a mensagem sumir sem
  // explicação.
  const { data: conversa, error: erroDaConversa } = await supabase
    .from("threads")
    .select("id, agent_id, user_id")
    .eq("organization_id", org.id)
    .eq("id", threadId)
    .maybeSingle();

  if (erroDaConversa) {
    logError("chat/getThread", erroDaConversa);
    return new Response("Não deu pra abrir essa conversa agora. Atualize a página.", {
      status: 503,
    });
  }
  if (!conversa || conversa.agent_id !== agent.id) {
    return new Response("Essa conversa não existe mais.", { status: 404 });
  }
  if (conversa.user_id !== user.id) {
    return new Response(
      "Só quem começou a conversa pode escrever nela. Clique em “Nova conversa” pra falar " +
        "com esse agente.",
      { status: 403 },
    );
  }

  // ---------------------------------------------------------------------------
  // Grava a pergunta ANTES de rodar. Se o modelo estourar, a pergunta continua
  // lá e a pessoa não perde o que digitou.
  // ---------------------------------------------------------------------------
  const mensagemDaPessoa: AgentUIMessage = {
    id: message.id ?? crypto.randomUUID(),
    role: "user",
    parts: message.parts,
  };
  const textoDaPergunta = textoDaMensagem(mensagemDaPessoa);

  await appendMessage({
    supabase,
    organizationId: org.id,
    threadId,
    role: "user",
    message: mensagemDaPessoa,
    runId: null,
  });
  await ensureTitle({ supabase, organizationId: org.id, threadId, texto: textoDaPergunta });

  // O HISTÓRICO VEM DO BANCO — inclusive a pergunta que acabou de entrar.
  const historico = await loadHistory({
    supabase,
    organizationId: org.id,
    threadId,
    tools: SEM_FERRAMENTAS,
  });
  const modelMessages = await historicoParaModelo(historico, SEM_FERRAMENTAS);

  const stream = await streamAgentRun({
    supabase,
    agent,
    organization: { id: org.id, slug: org.slug, name: org.name },
    user: { id: user.id, role: membership.role },
    input: { prompt: textoDaPergunta },
    modelMessages,
    threadId,
  });

  if (!stream.ok) {
    return new Response(stream.error, { status: statusDaRecusa(stream.error) });
  }

  const { result, accounting, runId } = stream.data;

  /**
   * A ficha de custo que viaja com a resposta, montada na hora.
   *
   * ⚠️ "AINDA RODANDO" NÃO É "DEU ERRADO", e essa linha já foi escrita errada
   * uma vez. A apuração nasce com `status: "running"` e só vira
   * succeeded/failed/cancelled quando a execução FECHA no banco — o que
   * acontece depois do `finish` do stream. Traduzir "tudo que não é succeeded"
   * pra "failed" fazia TODA resposta ao vivo aparecer com a moldura vermelha de
   * erro, e voltar ao normal quando a pessoa recarregava a página (aí sim a
   * ficha vinha do banco, já fechada).
   *
   * Enquanto está rodando a ficha vai SEM `status`. Quem grava no banco é o
   * `onFinish`, que espera o fechamento antes de montar a ficha de verdade.
   */
  function fichaDaResposta(): ChatMessageMetadata {
    const a = accounting();
    return {
      runId: a.runId,
      model: a.model,
      tokensInput: a.tokensInput,
      tokensOutput: a.tokensOutput,
      costMicros: a.costMicros,
      status:
        a.status === "succeeded" || a.status === "failed" || a.status === "cancelled"
          ? a.status
          : undefined,
      errorMessage: a.errorMessage ?? undefined,
      createdAt: Date.now(),
    };
  }

  // ⚠️ SEM `await`, e IMEDIATAMENTE antes do `return`. Ver o item 2 do topo.
  void result.consumeStream();

  return result.toUIMessageStreamResponse<AgentUIMessage>({
    originalMessages: [...historico],
    generateMessageId: () => crypto.randomUUID(),

    messageMetadata: ({ part }) => {
      if (part.type === "start") {
        return { runId, model: agent.model, createdAt: Date.now() };
      }
      if (part.type === "finish") return fichaDaResposta();
      return undefined;
    },

    onFinish: async ({ responseMessage }) => {
      // Espera a execução FECHAR no banco antes de gravar o balão: é o
      // fechamento que soma tokens e custo do rastro, e é esse número que vai
      // parar na ficha da resposta.
      await esperarFechamento(stream.data);
      const ficha = fichaDaResposta();

      // Resposta que morreu antes de escrever qualquer coisa vira um balão com
      // a explicação. Sem isso, quem recarregasse a página veria a própria
      // pergunta sozinha, sem nenhuma pista de que o agente tentou e falhou.
      const semConteudo = (responseMessage.parts ?? []).length === 0;
      const paraGravar: AgentUIMessage =
        semConteudo && ficha.errorMessage
          ? { ...responseMessage, parts: [{ type: "text", text: ficha.errorMessage }] }
          : responseMessage;

      await appendMessage({
        supabase,
        organizationId: org.id,
        threadId,
        role: "assistant",
        message: paraGravar,
        runId,
        metadata: ficha,
      });
    },

    onError: (error) => {
      logError("chat/stream", error);
      return (
        "O provedor de IA não respondeu direito nesta conversa. Tente de novo em alguns " +
        "instantes; se continuar, confira a chave em Configurações → Integrações."
      );
    },
  });
}
