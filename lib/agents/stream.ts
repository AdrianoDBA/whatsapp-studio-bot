/**
 * O MOTOR, mas entregando a resposta LETRA POR LETRA.
 *
 * É o mesmo motor: `prepareAgentRun()` faz os passos 1 a 5 (cota, execução
 * aberta, modelo, ferramentas, prompt) e este arquivo só troca o
 * `generateText` por `streamText`. Se algum dia os dois caminhos divergirem, é
 * porque alguém montou a execução por fora do `prepareAgentRun` — não faça
 * isso.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS TRÊS COISAS QUE NÃO PODEM SE PERDER NO CAMINHO DO STREAMING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. O rastro completo.** Cada passo do modelo vira linha em
 *    `agent_run_steps`, igual no caminho de espera-terminar.
 *
 * **2. A conta.** `finish_agent_run` SOMA o rastro no momento em que roda. Se
 *    ela rodar antes da última linha do rastro entrar, o custo sai MENOR que o
 *    real — e é esse número que o teto de gasto vai ler depois. Por isso toda
 *    gravação entra num array e o fechamento espera
 *    `Promise.allSettled(gravacoes)`. Não dá pra confiar que o AI SDK espera o
 *    callback terminar.
 *
 * **3. O fechamento.** A execução SEMPRE fecha, pelos três caminhos:
 *    `onFinish` → succeeded, `onError` → failed, `onAbort` → cancelled (a
 *    pessoa) ou failed (o relógio). E sempre por `finish_agent_run`, nunca por
 *    `update` em `agent_runs` — a permissão de UPDATE nessa tabela foi
 *    revogada de propósito.
 *
 * ⚠️ NÃO EXISTE BOTÃO "PARAR" no chat, e isso é decisão, não esquecimento: a
 * rota chama `consumeStream()`, então parar no navegador não pararia o
 * servidor. O botão prometeria uma economia que não acontece.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import { type ModelMessage, streamText, type ToolSet } from "ai";
import { calcCostMicrosById, extractProviderCostMicros } from "@/lib/ai/cost";
import { logError } from "@/lib/logger";
import { montarParadas, prepareAgentRun, type RunAgentParams } from "./engine";
import type { AgentRunStatus } from "./types";

/** Teto entre um pedaço e outro da resposta: 30 s parado = provedor travou. */
const CHUNK_TIMEOUT_MS = 30_000;

/** Teto de relógio da conversa inteira. */
const TIMEOUT_DO_CHAT_MS = 120_000;

/** Quanto o chamador espera pelo fechamento antes de desistir de esperar. */
const ESPERA_MAXIMA_DO_FECHAMENTO_MS = 20_000;

export type AgentStreamAccounting = {
  runId: string;
  status: AgentRunStatus;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  /** `null` = preço desconhecido. NUNCA 0 pra "não sei". */
  costMicros: number | null;
  stepCount: number;
  toolsUsed: string[];
  /** JÁ em PT-BR leigo. */
  errorMessage: string | null;
};

export type AgentStream = {
  readonly runId: string;
  /** Avisos em PT-BR (ferramenta que sumiu, ferramenta sem papel). */
  readonly warnings: string[];
  readonly result: ReturnType<typeof streamText<ToolSet>>;
  /** Uma FOTO da apuração no instante da chamada. Muda enquanto o stream corre. */
  accounting(): AgentStreamAccounting;
  /** Resolve quando a execução JÁ FOI FECHADA no banco. */
  readonly closed: Promise<void>;
};

export type StreamAgentRunParams = Omit<RunAgentParams, "triggerKind"> & {
  /** A conversa inteira, já convertida do formato da tela pro do modelo. */
  modelMessages: ModelMessage[];
  /** A conversa dona desta execução. Vai pra `agent_runs.thread_id`. */
  threadId: string;
};

export type StreamAgentRunResult =
  | { ok: true; data: AgentStream }
  | { ok: false; error: string; runId: string | null };

/**
 * Espera o fechamento da execução, com um teto.
 *
 * Existe pra um caso só: se algum dia o AI SDK terminar o stream sem chamar
 * nenhum dos três callbacks terminais, quem estivesse esperando o fechamento
 * ficaria pendurado pra sempre — e o balão da resposta NUNCA seria gravado. Um
 * balão com a ficha de custo incompleta é muito melhor que nenhum balão.
 */
export async function esperarFechamento(stream: AgentStream): Promise<void> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const desistir = new Promise<void>((resolve) => {
    relogio = setTimeout(resolve, ESPERA_MAXIMA_DO_FECHAMENTO_MS);
  });
  try {
    await Promise.race([stream.closed, desistir]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

/**
 * Roda o agente entregando a resposta aos poucos.
 *
 * NUNCA lança por falha do agente (regra 5 do `lib/agents/CLAUDE.md`): tudo
 * vira `{ ok: false, error, runId }` com o texto já em PT-BR leigo.
 */
export async function streamAgentRun(params: StreamAgentRunParams): Promise<StreamAgentRunResult> {
  const preparada = await prepareAgentRun({
    ...params,
    // A conversa é o único gatilho que produz stream. Os outros três
    // (`manual`, `schedule`, `webhook`) esperam terminar.
    triggerKind: "chat",
    timeoutMs: params.timeoutMs ?? TIMEOUT_DO_CHAT_MS,
  });

  if (!preparada.ok) {
    return { ok: false, error: preparada.error, runId: preparada.runId };
  }

  const p = preparada.prepared;
  const { agent } = params;

  // -------------------------------------------------------------------------
  // A apuração, montada enquanto o stream corre
  // -------------------------------------------------------------------------
  /**
   * TODA chamada do gravador entra aqui e NENHUMA é esperada na hora — esperar
   * dentro do callback seguraria a resposta na tela. O fechamento é que espera
   * todas (ver o item 2 do topo do arquivo).
   */
  const gravacoes: Promise<unknown>[] = [];

  let custoDosPassos = 0;
  let passosVistos = 0;
  let todoPassoTeveCustoDoProvedor = true;
  const ferramentasUsadas = new Set<string>();

  const apuracao: AgentStreamAccounting = {
    runId: p.runId,
    status: "running",
    model: agent.model,
    tokensInput: 0,
    tokensOutput: 0,
    costMicros: null,
    stepCount: 0,
    toolsUsed: [],
    errorMessage: null,
  };

  let jaFechou = false;
  let avisarFechamento: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    avisarFechamento = resolve;
  });

  /** Fecha a execução no banco. Idempotente: só o PRIMEIRO caminho vale. */
  async function fechar(p2: {
    status: AgentRunStatus;
    output: string | null;
    errorMessage: string | null;
  }): Promise<void> {
    if (jaFechou) return;
    jaFechou = true;

    apuracao.status = p2.status;
    apuracao.errorMessage = p2.errorMessage;

    try {
      // ⚠️ ESTA LINHA É A DIFERENÇA ENTRE COBRAR O CERTO E COBRAR MENOS.
      // `finish_agent_run` soma o rastro no instante em que roda.
      await Promise.allSettled(gravacoes);
      await p.finish(p2);
    } catch (err) {
      logError("agents/streamAgentRun/fechar", err);
    } finally {
      p.dispose();
      avisarFechamento();
    }
  }

  const result = streamText({
    model: p.model.model,
    system: p.system,
    messages: p.messages,
    tools: p.tools,
    // As MESMAS paradas do caminho de espera-terminar (número de passos + teto
    // de gasto por execução). Elas moram no `engine.ts` justamente pra os dois
    // caminhos não divergirem.
    stopWhen: montarParadas(p),
    // Anti-jailbreak: nem quem chama a função consegue enfiar uma instrução de
    // sistema no meio das mensagens.
    allowSystemInMessages: false,
    temperature: agent.temperature,
    maxOutputTokens: agent.max_output_tokens,
    abortSignal: p.signal,
    // `chunkMs` é o que separa "o modelo está pensando" de "o provedor travou":
    // sem ele, uma conexão pendurada só seria cortada no teto total.
    timeout: { totalMs: p.timeoutMs, chunkMs: CHUNK_TIMEOUT_MS },

    experimental_onStepStart: () => {
      p.recorder.markModelStepStart();
    },

    onStepFinish: (step) => {
      passosVistos += 1;
      apuracao.stepCount = passosVistos;
      for (const chamada of step.toolCalls) ferramentasUsadas.add(chamada.toolName);
      apuracao.toolsUsed = [...ferramentasUsadas];

      const custo = extractProviderCostMicros(step.usage);
      if (custo === null) todoPassoTeveCustoDoProvedor = false;
      else custoDosPassos += custo;

      gravacoes.push(p.recorder.recordModelStep(step));
    },

    onFinish: async (evento) => {
      apuracao.tokensInput = Math.max(0, Math.trunc(evento.totalUsage.inputTokens ?? 0));
      apuracao.tokensOutput = Math.max(0, Math.trunc(evento.totalUsage.outputTokens ?? 0));

      const daTabela = calcCostMicrosById(agent.model, {
        input: evento.totalUsage.inputTokens,
        output: evento.totalUsage.outputTokens,
      });
      // Verdade do provedor ganha de preço decorado — e só vale quando TODOS os
      // passos informaram, senão o total sairia menor que a conta real.
      // `passosVistos > 0` importa: sem ele, uma execução sem nenhum passo
      // gravaria custo ZERO — e zero significa "custou zero mesmo".
      apuracao.costMicros =
        todoPassoTeveCustoDoProvedor && passosVistos > 0
          ? custoDosPassos
          : (daTabela?.totalMicros ?? null);

      const texto = evento.text.trim();
      await fechar({
        status: "succeeded",
        output:
          texto.length > 0
            ? texto
            : "O agente terminou sem escrever uma resposta. Olhe o rastro pra ver o que ele fez.",
        errorMessage: null,
      });
    },

    onError: async ({ error }) => {
      logError("agents/streamAgentRun", error);
      await fechar({
        status: "failed",
        output: null,
        errorMessage:
          "O provedor de IA não respondeu direito nesta conversa. Tente de novo em alguns " +
          "instantes; se continuar, confira a chave em Configurações → Integrações.",
      });
    },

    onAbort: async () => {
      // Duas coisas MUITO diferentes chegam aqui, e o texto tem que separar:
      // o relógio estourou (é falha, e a pessoa precisa saber por quê) ou
      // alguém cancelou de propósito.
      if (p.timedOut()) {
        await fechar({
          status: "failed",
          output: null,
          errorMessage:
            `O agente passou de ${Math.round(p.timeoutMs / 1000)} segundos e foi ` +
            "interrompido. Diminua o número de passos do agente ou peça uma coisa de cada vez.",
        });
        return;
      }
      await fechar({ status: "cancelled", output: null, errorMessage: "Execução cancelada." });
    },
  });

  return {
    ok: true,
    data: {
      runId: p.runId,
      warnings: p.warnings,
      result,
      accounting: () => ({ ...apuracao, toolsUsed: [...apuracao.toolsUsed] }),
      closed,
    },
  };
}
