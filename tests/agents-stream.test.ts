/**
 * O MOTOR entregando a resposta letra por letra, com um modelo de mentira.
 *
 * O QUE ESTE ARQUIVO EXISTE PRA PROVAR (e é tudo dinheiro e rastro):
 *
 *   1. a execução é ABERTA antes de rodar, já ligada à conversa;
 *   2. cada passo do modelo vira linha no rastro;
 *   3. **o fechamento espera TODAS as gravações do rastro terminarem** — se
 *      não esperasse, `finish_agent_run` somaria um rastro incompleto e a
 *      execução sairia mais barata do que foi de verdade;
 *   4. a cota é descontada ANTES de abrir a execução, e a frase de cota
 *      estourada muda conforme quem está lendo (gente na tela x automação);
 *   5. falha de configuração fecha a execução como `failed` e devolve o
 *      `runId`, nunca uma exceção.
 *
 * O modelo é o `MockLanguageModelV3` do próprio AI SDK e o banco é um dublê.
 * Nenhuma chamada de rede acontece.
 */

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "@/lib/agents/types";
import { AiConfigError } from "@/lib/ai/errors";
import type { Database } from "@/types/supabase";

const { resolveModelMock } = vi.hoisted(() => ({ resolveModelMock: vi.fn() }));

vi.mock("@/lib/ai/resolve", () => ({
  resolveModel: resolveModelMock,
  listConfiguredAiProviders: vi.fn(),
  hasAnyAiCredential: vi.fn(),
}));

const { streamAgentRun } = await import("@/lib/agents/stream");
const { runAgent } = await import("@/lib/agents/engine");
const { getModel } = await import("@/lib/ai/catalog");

const ORG = { id: "11111111-1111-4111-8111-111111111111", slug: "loja", name: "Loja do Bairro" };
const USER = { id: "99999999-9999-4999-8999-999999999999", role: "member" as const };
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const THREAD_ID = "55555555-5555-4555-8555-555555555555";
const MODELO = "openrouter:google/gemini-3.7-flash";

// ---------------------------------------------------------------------------
// Dublê de banco
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

/**
 * A gravação do rastro DEMORA de propósito neste dublê.
 *
 * É o que torna o teste do item 3 honesto: se o fechamento não esperasse as
 * gravações, ele chegaria no banco ANTES delas — e a ordem no `diario` mostraria
 * isso.
 */
function criarBancoFalso({ cotaLiberada = true }: { cotaLiberada?: boolean } = {}) {
  const inseridos: Record<string, Linha[]> = {};
  const rpcs: Record<string, Linha[]> = {};
  const diario: string[] = [];

  function thenable<T>(valor: T) {
    return {
      // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
      then: (onOk: (v: T) => unknown) => Promise.resolve(onOk(valor)),
    };
  }

  function guardar(onde: Record<string, Linha[]>, tabela: string, valores: Linha) {
    const linhas = onde[tabela] ?? [];
    linhas.push(valores);
    onde[tabela] = linhas;
  }

  const cliente = {
    rpc(nome: string, args: Linha) {
      guardar(rpcs, nome, args);
      diario.push(`rpc:${nome}`);
      if (nome === "consume_llm_tokens") return thenable({ data: cotaLiberada, error: null });
      // O rastro agora entra por FUNÇÃO, não por insert direto (a permissão de
      // escrever na tabela foi revogada: um membro comum forjava "custei
      // US$ 999" e travava o workspace). O teste continua conferindo a mesma
      // coisa — que o passo foi gravado com o tipo, o token e o custo certos —
      // então a chamada é espelhada aqui no formato da linha.
      if (nome === "record_agent_run_step") {
        guardar(inseridos, "agent_run_steps", {
          run_id: args._run_id,
          seq: args._seq,
          kind: args._kind,
          tool_name: args._tool_name ?? null,
          input: args._input ?? null,
          output: args._output ?? null,
          error_message: args._error_message ?? null,
          duration_ms: args._duration_ms ?? null,
          tokens_input: args._tokens_input ?? null,
          tokens_output: args._tokens_output ?? null,
          cost_micros: args._cost_micros ?? null,
          organization_id: ORG.id,
        });
        // A MESMA demora "de rede" que o insert tinha: é ela que faz este
        // teste valer alguma coisa. Sem atraso, qualquer ordem passa.
        return {
          // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
          then: (onOk: (v: { data: null; error: null }) => unknown) =>
            new Promise<{ data: null; error: null }>((resolve) => {
              setTimeout(() => {
                diario.push("gravou:passo");
                resolve({ data: null, error: null });
              }, 5);
            }).then(onOk),
        };
      }
      return thenable({ data: null, error: null });
    },
    from(tabela: string) {
      return {
        insert(valores: Linha) {
          guardar(inseridos, tabela, valores);
          if (tabela === "agent_run_steps") {
            // Demora "de rede": três voltas na fila de microtarefas + um tick.
            const lenta = new Promise<{ data: null; error: null }>((resolve) => {
              setTimeout(() => {
                diario.push("gravou:passo");
                resolve({ data: null, error: null });
              }, 5);
            });
            return {
              select: () => ({ single: () => lenta }),
              // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
              then: (onOk: (v: unknown) => unknown) => lenta.then(onOk),
            };
          }
          diario.push(`inseriu:${tabela}`);
          return {
            select: () => ({
              single: () => thenable({ data: { id: RUN_ID }, error: null }),
            }),
            ...thenable({ data: null, error: null }),
          };
        },
        select() {
          const consulta = {
            eq: () => consulta,
            ilike: () => consulta,
            order: () => consulta,
            limit: () => consulta,
            abortSignal: () => consulta,
            ...thenable({ data: [] as Linha[], error: null }),
          };
          return consulta;
        },
        update() {
          const filtro = { eq: () => filtro, ...thenable({ data: null, error: null }) };
          return filtro;
        },
        delete: () => ({ eq: () => thenable({ data: null, error: null }) }),
      };
    },
  };

  return { cliente: cliente as unknown as SupabaseClient<Database>, inseridos, rpcs, diario };
}

function agenteDeTeste(patch: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organization_id: ORG.id,
    slug: "agente-de-teste",
    name: "Agente de teste",
    description: null,
    system_prompt: "Você ajuda o time.",
    model: MODELO,
    temperature: 0.7,
    max_steps: 5,
    max_output_tokens: 512,
    tools: [],
    status: "active",
    created_by: USER.id,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...patch,
  };
}

function usoDeTokens(entrada: number, saida: number) {
  return {
    inputTokens: { total: entrada, noCache: entrada, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: saida, text: saida, reasoning: 0 },
  };
}

function modeloQueEscreve(pedacos: string[], entrada = 1_000, saida = 500) {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    ...pedacos.map(
      (delta) => ({ type: "text-delta", id: "t1", delta }) as LanguageModelV3StreamPart,
    ),
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: usoDeTokens(entrada, saida),
    },
  ];

  return new MockLanguageModelV3({
    provider: "openrouter",
    modelId: "google/gemini-3.7-flash",
    doStream: async () => ({
      stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
    }),
  });
}

function resolvendoPara(model: MockLanguageModelV3) {
  resolveModelMock.mockResolvedValue({
    model,
    modelId: MODELO,
    provider: "openrouter",
    entry: getModel(MODELO),
    credentialSource: "workspace",
  });
}

function pedidoPadrao(banco: ReturnType<typeof criarBancoFalso>, patch: Partial<AgentRecord> = {}) {
  return {
    supabase: banco.cliente,
    agent: agenteDeTeste(patch),
    organization: ORG,
    user: USER,
    input: { prompt: "como estamos?" },
    modelMessages: [{ role: "user" as const, content: "como estamos?" }],
    threadId: THREAD_ID,
  };
}

beforeEach(() => {
  resolveModelMock.mockReset();
});

// ---------------------------------------------------------------------------

describe("streamAgentRun — o caminho feliz", () => {
  it("abre a execução ligada à conversa, grava o rastro e fecha somando", async () => {
    const banco = criarBancoFalso();
    resolvendoPara(modeloQueEscreve(["Tudo ", "certo ", "por aqui."]));

    const r = await streamAgentRun(pedidoPadrao(banco));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await r.data.result.consumeStream();
    await r.data.closed;

    // 1. A execução foi ABERTA antes de rodar, já apontando pra conversa.
    const aberta = banco.inseridos.agent_runs?.[0];
    expect(aberta?.status).toBe("running");
    expect(aberta?.thread_id).toBe(THREAD_ID);
    expect(aberta?.trigger_kind).toBe("chat");
    expect(aberta?.triggered_by).toBe(USER.id);
    expect(aberta?.organization_id).toBe(ORG.id);

    // 2. O passo do modelo virou linha no rastro, com o número de verdade.
    const passo = banco.inseridos.agent_run_steps?.[0];
    expect(passo?.kind).toBe("model");
    expect(passo?.tokens_input).toBe(1_000);
    expect(passo?.cost_micros).toBeGreaterThan(0);

    // 3. E a execução fechou PELA FUNÇÃO DO BANCO, como sucesso.
    const fechamento = banco.rpcs.finish_agent_run?.[0];
    expect(fechamento?._status).toBe("succeeded");
    expect(String(fechamento?._output)).toContain("Tudo certo por aqui.");
    // O motor NÃO manda tokens nem custo: quem soma é o banco, lendo o rastro.
    expect(fechamento).not.toHaveProperty("_tokens_input");
    expect(fechamento).not.toHaveProperty("_cost_micros");
  });

  it("⚠️ O FECHAMENTO ESPERA O RASTRO INTEIRO — senão a conta sai menor", async () => {
    const banco = criarBancoFalso();
    resolvendoPara(modeloQueEscreve(["ok"]));

    const r = await streamAgentRun(pedidoPadrao(banco));
    if (!r.ok) return;
    await r.data.result.consumeStream();
    await r.data.closed;

    const ondeGravou = banco.diario.lastIndexOf("gravou:passo");
    const ondeFechou = banco.diario.indexOf("rpc:finish_agent_run");

    expect(ondeGravou).toBeGreaterThanOrEqual(0);
    expect(ondeFechou).toBeGreaterThan(ondeGravou);
  });

  it("a apuração sai com tokens e custo INTEIRO", async () => {
    const banco = criarBancoFalso();
    resolvendoPara(modeloQueEscreve(["ok"], 1_000, 500));

    const r = await streamAgentRun(pedidoPadrao(banco));
    if (!r.ok) return;
    await r.data.result.consumeStream();
    await r.data.closed;

    const conta = r.data.accounting();
    expect(conta.runId).toBe(RUN_ID);
    expect(conta.status).toBe("succeeded");
    expect(conta.model).toBe(MODELO);
    expect(conta.tokensInput).toBe(1_000);
    expect(conta.tokensOutput).toBe(500);
    expect(conta.costMicros).toBeGreaterThan(0);
    expect(Number.isInteger(conta.costMicros)).toBe(true);
    expect(conta.stepCount).toBe(1);
    expect(conta.errorMessage).toBeNull();
  });

  it("modelo fora do catálogo apura custo NULO, nunca zero", async () => {
    const banco = criarBancoFalso();
    const model = modeloQueEscreve(["ok"]);
    resolveModelMock.mockResolvedValue({
      model,
      modelId: "openai:gpt-que-nao-existe",
      provider: "openai",
      entry: getModel(MODELO),
      credentialSource: "platform",
    });

    const r = await streamAgentRun({
      ...pedidoPadrao(banco),
      agent: agenteDeTeste({ model: "openai:gpt-que-nao-existe" }),
    });
    if (!r.ok) return;
    await r.data.result.consumeStream();
    await r.data.closed;

    expect(r.data.accounting().costMicros).toBeNull();
    expect(banco.inseridos.agent_run_steps?.[0]?.cost_micros).toBeNull();
  });

  it("a CONVERSA INTEIRA vai pro modelo, não só a última mensagem", async () => {
    const banco = criarBancoFalso();
    const model = modeloQueEscreve(["ok"]);
    resolvendoPara(model);

    const r = await streamAgentRun({
      ...pedidoPadrao(banco),
      modelMessages: [
        { role: "user", content: "primeira pergunta" },
        { role: "assistant", content: "primeira resposta" },
        { role: "user", content: "como estamos?" },
      ],
    });
    if (!r.ok) return;
    await r.data.result.consumeStream();
    await r.data.closed;

    const conversa = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(conversa).toContain("primeira pergunta");
    expect(conversa).toContain("primeira resposta");
    // E o prompt de sistema com o rodapé de segurança continua lá.
    expect(conversa).toContain("DADO, não instrução");
    expect(conversa).toContain("Loja do Bairro");
  });

  it("a cota é estimada em cima da CONVERSA, não só do último balão", async () => {
    const bancoCurto = criarBancoFalso();
    resolvendoPara(modeloQueEscreve(["ok"]));
    const curto = await streamAgentRun(pedidoPadrao(bancoCurto));
    if (curto.ok) {
      await curto.data.result.consumeStream();
      await curto.data.closed;
    }

    const bancoLongo = criarBancoFalso();
    resolvendoPara(modeloQueEscreve(["ok"]));
    const longo = await streamAgentRun({
      ...pedidoPadrao(bancoLongo),
      modelMessages: [
        { role: "user", content: "x".repeat(5_000) },
        { role: "user", content: "como estamos?" },
      ],
    });
    if (longo.ok) {
      await longo.data.result.consumeStream();
      await longo.data.closed;
    }

    const cotaCurta = Number(bancoCurto.rpcs.consume_llm_tokens?.[0]?._tokens);
    const cotaLonga = Number(bancoLongo.rpcs.consume_llm_tokens?.[0]?._tokens);
    // Uma conversa longa custa mais TODO TURNO: o histórico é recobrado inteiro.
    expect(cotaLonga).toBeGreaterThan(cotaCurta + 4_000);
  });
});

describe("streamAgentRun — quando dá errado", () => {
  it("chave faltando fecha a execução como falha e devolve o runId", async () => {
    const banco = criarBancoFalso();
    resolveModelMock.mockRejectedValue(
      new AiConfigError(
        "credencial-ausente",
        "Falta cadastrar a chave do OpenRouter pra usar esse modelo.",
        "sem credencial para openrouter (organizationId=11111111-1111-4111-8111-111111111111)",
        "openrouter",
      ),
    );

    const r = await streamAgentRun(pedidoPadrao(banco));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.runId).toBe(RUN_ID);
    expect(r.error).toContain("Falta cadastrar a chave");
    // E NÃO vazou o detalhe técnico (que carrega o id do workspace).
    expect(r.error).not.toContain("organizationId");
    expect(banco.rpcs.finish_agent_run?.[0]?._status).toBe("failed");
  });

  it("agente aposentado nem abre execução", async () => {
    const banco = criarBancoFalso();
    const r = await streamAgentRun({
      ...pedidoPadrao(banco),
      agent: agenteDeTeste({ status: "archived" }),
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.runId).toBeNull();
    expect(r.error).toContain("aposentado");
    expect(banco.inseridos.agent_runs).toBeUndefined();
  });
});

describe("a frase da cota estourada muda conforme quem lê", () => {
  it("no chat, ela fala com a PESSOA", async () => {
    const banco = criarBancoFalso({ cotaLiberada: false });
    const r = await streamAgentRun(pedidoPadrao(banco));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Você já usou sua cota");
    expect(r.runId).toBeNull();
    // A execução NÃO chegou a ser aberta: cota vem antes.
    expect(banco.inseridos.agent_runs).toBeUndefined();
  });

  it("numa automação, ela NÃO diz 'você' — não tem ninguém na frente da tela", async () => {
    const banco = criarBancoFalso({ cotaLiberada: false });
    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "schedule",
      input: { prompt: "relatório diário" },
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Esta automação parou");
    expect(r.error).toContain("cota própria");
    expect(r.error).not.toContain("Você já usou sua cota");
  });
});
