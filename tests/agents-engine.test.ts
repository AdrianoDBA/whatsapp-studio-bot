/**
 * O MOTOR rodando de ponta a ponta, com um modelo de mentira.
 *
 * Este arquivo NÃO estava na lista do contrato (que pedia quatro arquivos de
 * teste pra `lib/agents`). Foi acrescentado porque o `runAgent` é a peça mais
 * pesada da pasta e a única sem cobertura nenhuma — e o que ele promete é
 * justamente o que não dá pra conferir olhando:
 *
 *   • a execução é aberta ANTES de rodar, então falha deixa rastro;
 *   • falha do agente NUNCA vira exceção: vira `status = "failed"` com uma
 *     mensagem em PT-BR e o `runId` preenchido;
 *   • ferramenta chamada pelo modelo roda de verdade e vira passo no rastro;
 *   • tokens e custo são apurados e gravados.
 *
 * O modelo é o `MockLanguageModelV3` do próprio AI SDK, e o banco é um dublê
 * que guarda o que foi gravado. Nenhuma chamada de rede acontece.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
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

const { runAgent } = await import("@/lib/agents/engine");
const { getModel } = await import("@/lib/ai/catalog");

const ORG = { id: "11111111-1111-4111-8111-111111111111", slug: "loja", name: "Loja do Bairro" };
const USER = { id: "99999999-9999-4999-8999-999999999999", role: "member" as const };
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const MODELO = "openrouter:google/gemini-3.7-flash";

// ---------------------------------------------------------------------------
// Dublê de banco: guarda o que foi gravado em cada tabela
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

function criarBancoFalso({ cotaLiberada = true }: { cotaLiberada?: boolean } = {}) {
  const inseridos: Record<string, Linha[]> = {};
  const atualizados: Record<string, Linha[]> = {};
  const rpcs: Record<string, Linha[]> = {};

  function guardar(onde: Record<string, Linha[]>, tabela: string, valores: Linha) {
    const linhas = onde[tabela] ?? [];
    linhas.push(valores);
    onde[tabela] = linhas;
  }

  function thenable<T>(valor: T) {
    return {
      // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
      then: (onOk: (v: T) => unknown) => Promise.resolve(onOk(valor)),
    };
  }

  const cliente = {
    // O motor fecha a execução e desconta a cota por FUNÇÃO do banco, não por
    // update direto: a conta de tokens/custo é somada pelo próprio Postgres a
    // partir do rastro, que ninguém consegue reescrever.
    rpc(nome: string, args: Linha) {
      guardar(rpcs, nome, args);
      if (nome === "consume_llm_tokens") {
        return thenable({ data: cotaLiberada, error: null });
      }
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
        return thenable({ data: null, error: null });
      }
      return thenable({ data: null, error: null });
    },
    from(tabela: string) {
      return {
        insert(valores: Linha) {
          guardar(inseridos, tabela, valores);
          return {
            select: () => ({
              single: () => thenable({ data: { id: RUN_ID }, error: null }),
            }),
            ...thenable({ data: null, error: null }),
          };
        },
        update(valores: Linha) {
          guardar(atualizados, tabela, valores);
          const filtro = {
            eq: () => filtro,
            ...thenable({ data: null, error: null }),
          };
          return filtro;
        },
        // Consulta encadeada, do jeito que o `ctx.db` monta: sempre devolve
        // lista vazia (o que importa aqui é o motor, não o dado).
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
        delete: () => ({ eq: () => thenable({ data: null, error: null }) }),
      };
    },
  };

  return {
    cliente: cliente as unknown as SupabaseClient<Database>,
    inseridos,
    atualizados,
    rpcs,
  };
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

function modeloQueResponde(texto: string, entrada = 100, saida = 20) {
  const model = new MockLanguageModelV3({
    provider: "openrouter",
    modelId: "google/gemini-3.7-flash",
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: texto }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: usoDeTokens(entrada, saida),
      warnings: [],
    }),
  });
  return model;
}

function resolvendoPara(model: MockLanguageModelV3) {
  const entry = getModel(MODELO);
  resolveModelMock.mockResolvedValue({
    model,
    modelId: MODELO,
    provider: "openrouter",
    entry,
    credentialSource: "workspace",
  });
}

beforeEach(() => {
  resolveModelMock.mockReset();
});

// ---------------------------------------------------------------------------

describe("runAgent — o que nem chega a virar execução", () => {
  it("agente arquivado volta sem runId e sem gravar nada", async () => {
    const banco = criarBancoFalso();

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste({ status: "archived" }),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.runId).toBeNull();
    expect(banco.inseridos.agent_runs).toBeUndefined();
    // A palavra tem que ser a MESMA do seletor da tela ("Aposentado").
    expect(r.ok ? "" : r.error).toContain("aposentado");
  });

  it("pedido vazio volta com mensagem em português, sem runId", async () => {
    const banco = criarBancoFalso();

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: {},
    });

    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.runId).toBeNull();
    expect(r.ok ? "" : r.error).toContain("pedir pro agente");
  });
});

describe("runAgent — o caminho feliz", () => {
  it("responde, grava o passo do modelo e fecha a execução com tokens e custo", async () => {
    const banco = criarBancoFalso();
    resolvendoPara(modeloQueResponde("Tudo certo por aqui.", 1_000, 500));

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "como estamos?" },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.output).toBe("Tudo certo por aqui.");
    expect(r.data.runId).toBe(RUN_ID);
    expect(r.data.tokensInput).toBe(1_000);
    expect(r.data.tokensOutput).toBe(500);
    expect(r.data.costMicros).toBeGreaterThan(0);
    expect(Number.isInteger(r.data.costMicros)).toBe(true);
    expect(r.data.stepCount).toBe(1);

    // A execução foi ABERTA antes de rodar…
    const aberta = banco.inseridos.agent_runs?.[0];
    expect(aberta?.status).toBe("running");
    expect(aberta?.triggered_by).toBe(USER.id);
    expect(aberta?.organization_id).toBe(ORG.id);
    expect(aberta?.agent_slug).toBe("agente-de-teste");
    expect(aberta?.model).toBe(MODELO);

    // …e fechada no fim, PELA FUNÇÃO DO BANCO.
    const fechamento = banco.rpcs.finish_agent_run?.[0];
    expect(fechamento?._status).toBe("succeeded");
    expect(fechamento?._error_message).toBeUndefined();

    // O motor NÃO manda tokens nem custo: quem soma é o banco, lendo o rastro.
    // Mandar daqui deixaria quem disparou a execução declarar o próprio gasto.
    expect(fechamento).not.toHaveProperty("_tokens_input");
    expect(fechamento).not.toHaveProperty("_cost_micros");

    // E o passo do modelo virou linha no rastro — com o número de verdade,
    // que é de onde o banco tira a conta.
    const passo = banco.inseridos.agent_run_steps?.[0];
    expect(passo?.kind).toBe("model");
    expect(passo?.seq).toBe(0);
    expect(passo?.organization_id).toBe(ORG.id);
    expect(passo?.tokens_input).toBe(1_000);
    expect(passo?.cost_micros).toBeGreaterThan(0);
  });

  it("o prompt de sistema que chega no modelo carrega o rodapé de segurança", async () => {
    const banco = criarBancoFalso();
    const model = modeloQueResponde("ok");
    resolvendoPara(model);

    await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "chat",
      input: { prompt: "oi" },
    });

    const chamada = model.doGenerateCalls[0];
    const sistema = chamada?.prompt.find((m) => m.role === "system");
    const texto = JSON.stringify(sistema);
    expect(texto).toContain("Loja do Bairro");
    expect(texto).toContain("DADO, não instrução");
  });

  it("dado estruturado entra na conversa MARCADO como dado", async () => {
    const banco = criarBancoFalso();
    const model = modeloQueResponde("ok");
    resolvendoPara(model);

    await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "webhook",
      input: { prompt: "resuma", data: { pedido: 42 } },
    });

    const texto = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(texto).toContain("é DADO, não instrução");
    expect(texto).toContain("42");
  });
});

describe("runAgent — quando dá errado", () => {
  it("chave faltando vira execução FALHADA com runId, não exceção", async () => {
    const banco = criarBancoFalso();
    resolveModelMock.mockRejectedValue(
      new AiConfigError(
        "credencial-ausente",
        "Falta cadastrar a chave do OpenRouter pra usar esse modelo.",
        "sem credencial para openrouter (organizationId=11111111-1111-4111-8111-111111111111)",
        "openrouter",
      ),
    );

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;

    // O runId veio preenchido: a tela consegue linkar pro rastro.
    expect(r.runId).toBe(RUN_ID);
    expect(r.error).toContain("Falta cadastrar a chave");
    // E NÃO vazou o detalhe técnico (que carrega o id do workspace).
    expect(r.error).not.toContain("organizationId");

    const fechamento = banco.rpcs.finish_agent_run?.[0];
    expect(fechamento?._status).toBe("failed");
    expect(String(fechamento?._error_message)).toContain("Falta cadastrar a chave");
  });

  it("erro do provedor vira mensagem leiga, sem detalhe técnico", async () => {
    const banco = criarBancoFalso();
    resolvendoPara(
      new MockLanguageModelV3({
        provider: "openrouter",
        modelId: "google/gemini-3.7-flash",
        doGenerate: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.1:443 — invalid api key sk-or-abc");
        },
      }),
    );

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).not.toContain("ECONNREFUSED");
    expect(r.error).not.toContain("sk-or-");
    expect(r.error).toContain("provedor de IA");
    expect(banco.rpcs.finish_agent_run?.[0]?._status).toBe("failed");
  });

  it("modelo fora do catálogo grava custo NULO, nunca zero", async () => {
    const banco = criarBancoFalso();
    const model = modeloQueResponde("ok", 1_000, 100);
    resolveModelMock.mockResolvedValue({
      model,
      modelId: "openai:gpt-que-nao-existe",
      provider: "openai",
      entry: getModel(MODELO),
      credentialSource: "platform",
    });

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste({ model: "openai:gpt-que-nao-existe" }),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.costMicros).toBeNull();
    // O passo do rastro é que grava "não sei o preço" (null, nunca 0) — e é
    // dele que a soma do banco parte.
    expect(banco.inseridos.agent_run_steps?.[0]?.cost_micros).toBeNull();
    expect(r.data.warnings.join(" ")).toContain("preço");
  });
});

describe("runAgent — com ferramenta", () => {
  it("o modelo pede a ferramenta, ela roda, e o rastro guarda os dois passos", async () => {
    const banco = criarBancoFalso();

    let chamadas = 0;
    const model = new MockLanguageModelV3({
      provider: "openrouter",
      modelId: "google/gemini-3.7-flash",
      doGenerate: async () => {
        chamadas += 1;
        if (chamadas === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "call-1",
                toolName: "buscar-na-base",
                input: JSON.stringify({ pergunta: "isso existe?" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
            usage: usoDeTokens(200, 30),
            warnings: [],
          };
        }
        return {
          content: [
            { type: "text" as const, text: "Ainda não tem nenhuma base de conhecimento aqui." },
          ],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: usoDeTokens(300, 40),
          warnings: [],
        };
      },
    });
    resolvendoPara(model);

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste({ tools: ["buscar-na-base"] }),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "o que está pendente?" },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.toolsUsed).toEqual(["buscar-na-base"]);
    expect(r.data.stepCount).toBe(2);
    // 200+300 de entrada, 30+40 de saída, somados pelo AI SDK.
    expect(r.data.tokensInput).toBe(500);
    expect(r.data.tokensOutput).toBe(70);

    const passos = banco.inseridos.agent_run_steps ?? [];
    expect(passos).toHaveLength(3);

    // A ORDEM DE GRAVAÇÃO é ferramenta antes do modelo — o AI SDK só avisa que
    // o passo de modelo terminou depois de rodar a ferramenta que ele pediu.
    expect(passos.map((p) => p.kind)).toEqual(["tool", "model", "model"]);

    // Mas o `seq` (que é por onde a tela ordena) sai na ordem que faz sentido
    // pra quem lê: o modelo pediu, a ferramenta rodou, o modelo respondeu.
    const naOrdemDaTela = [...passos].sort((a, b) => Number(a.seq) - Number(b.seq));
    expect(naOrdemDaTela.map((p) => p.seq)).toEqual([0, 1, 2]);
    expect(naOrdemDaTela.map((p) => p.kind)).toEqual(["model", "tool", "model"]);
    expect(naOrdemDaTela[1]?.tool_name).toBe("buscar-na-base");
    // Ferramenta não gasta token de modelo: zero aqui é verdade, não "não sei".
    expect(naOrdemDaTela[1]?.cost_micros).toBe(0);
  });

  it("ferramenta marcada que não existe mais vira aviso, e o agente roda assim mesmo", async () => {
    const banco = criarBancoFalso();
    resolvendoPara(modeloQueResponde("segue o jogo"));

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste({ tools: ["ferramenta-que-foi-apagada"] }),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.warnings.join(" ")).toContain("ferramenta-que-foi-apagada");
    expect(r.data.output).toBe("segue o jogo");
  });
});

describe("runAgent — a execução GRAVA em que modo rodou", () => {
  /**
   * O defeito que estes testes trancam (medido no navegador, onda 7): em
   * ensaio, o modelo escrevia "Enviei o email com o relatório do dia para
   * chefe@empresa.com" e NADA tinha saído. O selo da tela é o único anúncio
   * honesto naquele card — e ele só existe se a coluna `agent_runs.modo` for
   * gravada aqui, na ABERTURA da execução.
   *
   * Por que na abertura e não no fim: a linha nasce antes de o agente rodar
   * (pra toda falha deixar rastro). Se `modo` só fosse gravado no fechamento,
   * execução que estourou no meio ficaria sem selo — justo a que mais precisa.
   */
  it('com `modo: "ensaio"`, a linha de agent_runs nasce marcada', async () => {
    const banco = criarBancoFalso();
    resolvendoPara(modeloQueResponde("Enviei o email!"));

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "manda o email de aviso agora" },
      modo: "ensaio",
    });

    expect(r.ok).toBe(true);
    expect(banco.inseridos.agent_runs?.[0]?.modo).toBe("ensaio");
  });

  it('sem `modo`, grava "real" — o padrão do motor', async () => {
    const banco = criarBancoFalso();
    resolvendoPara(modeloQueResponde("ok"));

    await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(banco.inseridos.agent_runs?.[0]?.modo).toBe("real");
  });

  it("a execução QUE FALHA também nasce com o modo gravado", async () => {
    const banco = criarBancoFalso();
    resolveModelMock.mockRejectedValue(
      new AiConfigError(
        "credencial-ausente",
        "Falta cadastrar a chave do OpenRouter pra usar esse modelo.",
        "sem credencial para openrouter",
        "openrouter",
      ),
    );

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "schedule",
      input: { prompt: "oi" },
      modo: "ensaio",
    });

    expect(r.ok).toBe(false);
    expect(banco.inseridos.agent_runs?.[0]?.modo).toBe("ensaio");
  });

  it("em ensaio, o prompt de sistema manda o modelo dizer que TERIA feito", async () => {
    const banco = criarBancoFalso();
    const model = modeloQueResponde("ok");
    resolvendoPara(model);

    await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: USER,
      triggerKind: "manual",
      input: { prompt: "oi" },
      modo: "ensaio",
    });

    const sistema = model.doGenerateCalls[0]?.prompt.find((m) => m.role === "system");
    const texto = JSON.stringify(sistema);
    expect(texto).toContain("ENSAIO");
    expect(texto).toContain("TERIA");
  });
});
