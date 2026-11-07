/**
 * O TETO DE GASTO DENTRO DO MOTOR — a porta única.
 *
 * `prepareAgentRun` é o funil obrigatório dos dois caminhos (o chat e o
 * espera-terminar) e dos quatro gatilhos. Este arquivo prova as quatro coisas
 * que o contrato da onda 6 promete e que não dá pra conferir olhando o código:
 *
 *   1. **medidor cheio, nada começa** — e nenhuma linha é aberta em
 *      `agent_runs`;
 *   2. **dinheiro antes de token** — bloqueado pelo teto, a cota de token NÃO
 *      é descontada, porque nada foi gasto;
 *   3. **a frase muda por gatilho** — quem lê o chat é uma pessoa, quem lê o
 *      agendamento é o registro da automação, e quem lê o webhook é um
 *      programa;
 *   4. **a linha de parada por custo** para o laço com o custo que está em
 *      MEMÓRIA, sem consultar o banco.
 *
 * O modelo é o `MockLanguageModelV3` do próprio AI SDK e o banco é um dublê.
 * Nenhuma chamada de rede acontece.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV3 } from "ai/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunRecorder } from "@/lib/agents/recorder";
import type { AgentRecord } from "@/lib/agents/types";
import type { Database } from "@/types/supabase";

const { resolveModelMock } = vi.hoisted(() => ({ resolveModelMock: vi.fn() }));

vi.mock("@/lib/ai/resolve", () => ({
  resolveModel: resolveModelMock,
  listConfiguredAiProviders: vi.fn(),
  hasAnyAiCredential: vi.fn(),
}));

const { montarParadas, runAgent } = await import("@/lib/agents/engine");
const { getModel } = await import("@/lib/ai/catalog");

const ORG = { id: "11111111-1111-4111-8111-111111111111", slug: "loja", name: "Loja do Bairro" };
const DONO = { id: "99999999-9999-4999-8999-999999999999", role: "owner" as const };
const MEMBRO = { id: "88888888-8888-4888-8888-888888888888", role: "member" as const };
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const MODELO = "openrouter:google/gemini-3.7-flash";

/** 21/08/2026 — pra frase dizer "1º de setembro" sempre. */
const AGORA = new Date("2026-08-21T17:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AGORA);
});

afterAll(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Dublê de banco: guarda o que foi gravado e responde o teto que o teste pediu
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

/** Uma linha de `org_ai_budget_status`, com os padrões de "sem teto nenhum". */
function linhaDeTeto(patch: Linha = {}): Linha {
  return {
    month: "2026-08-01",
    day: "2026-08-21",
    monthly_budget_micros: null,
    daily_budget_micros: null,
    platform_cap_micros: null,
    effective_monthly_micros: null,
    max_run_cost_micros: null,
    hard_stop: true,
    alert_at_percent: 80,
    month_spent_micros: 0,
    day_spent_micros: 0,
    month_agent_micros: 0,
    month_embedding_micros: 0,
    unpriced_runs: 0,
    unpriced_documents: 0,
    percent_used: null,
    over_budget: false,
    blocked: false,
    blocked_by: null,
    ...patch,
  };
}

function criarBancoFalso({
  teto = linhaDeTeto(),
  tetoFalhou = false,
}: {
  teto?: Linha | null;
  tetoFalhou?: boolean;
} = {}) {
  const inseridos: Record<string, Linha[]> = {};
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
    rpc(nome: string, args: Linha) {
      guardar(rpcs, nome, args);
      if (nome === "org_ai_budget_status") {
        if (tetoFalhou) {
          return thenable({ data: null, error: { message: "o banco piscou" } });
        }
        return thenable({ data: teto === null ? [] : [teto], error: null });
      }
      if (nome === "consume_llm_tokens") return thenable({ data: true, error: null });
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

  return { cliente: cliente as unknown as SupabaseClient<Database>, inseridos, rpcs };
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
    created_by: DONO.id,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...patch,
  };
}

function modeloQueResponde(texto: string) {
  return new MockLanguageModelV3({
    provider: "openrouter",
    modelId: "google/gemini-3.7-flash",
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: texto }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 20, text: 20, reasoning: 0 },
      },
      warnings: [],
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

beforeEach(() => {
  resolveModelMock.mockReset();
});

// ---------------------------------------------------------------------------
// 1 e 2 — medidor cheio: nada começa, e nenhum token é descontado
// ---------------------------------------------------------------------------

const TETO_DO_MES_CHEIO = linhaDeTeto({
  monthly_budget_micros: 20_000_000,
  effective_monthly_micros: 20_000_000,
  month_spent_micros: 20_000_000,
  percent_used: 100,
  over_budget: true,
  blocked: true,
  blocked_by: "mes",
});

describe("teto cheio — o que NÃO acontece", () => {
  it("não abre execução, não desconta token e não chama o provedor", async () => {
    const banco = criarBancoFalso({ teto: TETO_DO_MES_CHEIO });
    const model = modeloQueResponde("não deveria chegar aqui");
    resolvendoPara(model);

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: DONO,
      triggerKind: "manual",
      input: { prompt: "faz um resumo" },
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;

    // Nenhuma linha aberta: `runId` nulo é o combinado pra "nem começou".
    expect(r.runId).toBeNull();
    expect(banco.inseridos.agent_runs).toBeUndefined();
    expect(banco.inseridos.agent_run_steps).toBeUndefined();

    // ⚠️ DINHEIRO ANTES DE TOKEN: barrado pelo teto, nada de token é
    // descontado — porque nada foi gasto. Se esta linha cair, a pessoa perde
    // cota do dia por uma execução que nem rodou.
    expect(banco.rpcs.consume_llm_tokens).toBeUndefined();

    // E o provedor nunca foi chamado.
    expect(model.doGenerateCalls).toHaveLength(0);

    // A leitura do teto foi feita com o workspace certo.
    expect(banco.rpcs.org_ai_budget_status?.[0]?._organization_id).toBe(ORG.id);
  });

  it("a execução também não é fechada (não existe execução pra fechar)", async () => {
    const banco = criarBancoFalso({ teto: TETO_DO_MES_CHEIO });
    resolvendoPara(modeloQueResponde("oi"));

    await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: DONO,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(banco.rpcs.finish_agent_run).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3 — a frase muda por gatilho
// ---------------------------------------------------------------------------

describe("teto cheio — a frase muda por gatilho", () => {
  async function rodarCom(
    triggerKind: "chat" | "manual" | "schedule" | "webhook",
    user: typeof DONO | typeof MEMBRO,
    teto: Linha = TETO_DO_MES_CHEIO,
  ) {
    const banco = criarBancoFalso({ teto });
    resolvendoPara(modeloQueResponde("oi"));
    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user,
      triggerKind,
      input: { prompt: "oi" },
    });
    return r.ok ? "" : r.error;
  }

  it("botão e chat, pra quem administra: manda aumentar o teto", async () => {
    const frase = await rodarCom("manual", DONO);
    expect(frase).toContain("Os agentes deste workspace estão parados");
    expect(frase).toContain("(US$ 20,00 de US$ 20,00)");
    expect(frase).toContain("1º de setembro");
    expect(frase).toContain("Configurações → Limites de IA");
  });

  it("chat, pra quem NÃO administra: manda pedir", async () => {
    const frase = await rodarCom("chat", MEMBRO);
    expect(frase).toContain("peça pra quem administra o workspace");
    // Sem número: quem não pode mudar o teto não precisa do valor dele.
    expect(frase).not.toContain("US$");
  });

  it("agendamento: a rodada foi PULADA e a automação continua ligada", async () => {
    // Numa execução das 3h da manhã não existe "você" pra aumentar o teto — e
    // a frase precisa dizer que não tem nada pra religar.
    const frase = await rodarCom("schedule", DONO);
    expect(frase).toContain("A rodada de hoje foi pulada");
    expect(frase).toContain("continua ligada");
    expect(frase).not.toContain("você pode aumentar agora");
  });

  it("webhook: fala com um programa, sem caminho de menu", async () => {
    const frase = await rodarCom("webhook", DONO);
    expect(frase).toContain("As chamadas voltam a ser aceitas em 1º de setembro");
    expect(frase).not.toContain("Configurações");
  });

  it("freio do dia: a frase fala de amanhã, não da virada do mês", async () => {
    const frase = await rodarCom(
      "manual",
      DONO,
      linhaDeTeto({
        daily_budget_micros: 5_000_000,
        day_spent_micros: 5_000_000,
        monthly_budget_micros: 100_000_000,
        effective_monthly_micros: 100_000_000,
        month_spent_micros: 30_000_000,
        over_budget: true,
        blocked: true,
        blocked_by: "dia",
      }),
    );
    expect(frase).toContain("parados até amanhã");
    expect(frase).toContain("(US$ 5,00)");
    expect(frase).toContain("meia-noite (horário de Brasília)");
  });

  it("teto da plataforma: corta mesmo com o corte do workspace DESLIGADO", async () => {
    // Quem decide isso é o banco (`hard_stop` não vale pro teto da
    // plataforma); o motor só precisa não inventar exceção nenhuma.
    const frase = await rodarCom(
      "manual",
      DONO,
      linhaDeTeto({
        hard_stop: false,
        platform_cap_micros: 50_000_000,
        monthly_budget_micros: 200_000_000,
        effective_monthly_micros: 50_000_000,
        month_spent_micros: 50_000_000,
        over_budget: true,
        blocked: true,
        blocked_by: "plataforma",
      }),
    );
    expect(frase).toContain("quem cuida do sistema definiu pra este workspace (US$ 50,00)");
    expect(frase).toContain("fale com quem administra o sistema");
  });
});

// ---------------------------------------------------------------------------
// Quando o teto NÃO corta
// ---------------------------------------------------------------------------

describe("teto com folga — o motor segue o caminho normal", () => {
  it("passou do aviso mas não do teto: roda, e o token é descontado", async () => {
    const banco = criarBancoFalso({
      teto: linhaDeTeto({
        monthly_budget_micros: 20_000_000,
        effective_monthly_micros: 20_000_000,
        month_spent_micros: 16_400_000,
        percent_used: 82,
      }),
    });
    resolvendoPara(modeloQueResponde("Tudo certo por aqui."));

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: DONO,
      triggerKind: "manual",
      input: { prompt: "como estamos?" },
    });

    expect(r.ok).toBe(true);
    expect(banco.rpcs.consume_llm_tokens).toHaveLength(1);
    expect(banco.inseridos.agent_runs).toHaveLength(1);
    expect(banco.rpcs.finish_agent_run?.[0]?._status).toBe("succeeded");
  });

  it("passou do teto com o corte DESLIGADO: continua rodando (só avisa)", async () => {
    const banco = criarBancoFalso({
      teto: linhaDeTeto({
        hard_stop: false,
        monthly_budget_micros: 20_000_000,
        effective_monthly_micros: 20_000_000,
        month_spent_micros: 23_100_000,
        percent_used: 115,
        over_budget: true,
        // `blocked` continua falso: é o banco que decide isso, e com o corte
        // desligado ele NÃO bloqueia.
        blocked: false,
        blocked_by: null,
      }),
    });
    resolvendoPara(modeloQueResponde("ok"));

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: DONO,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(r.ok).toBe(true);
  });

  it("workspace sem linha de limite nenhuma: roda, como sempre rodou", async () => {
    const banco = criarBancoFalso({ teto: null });
    resolvendoPara(modeloQueResponde("ok"));

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: DONO,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(r.ok).toBe(true);
    expect(banco.inseridos.agent_runs).toHaveLength(1);
  });

  it("não deu pra LER o medidor: deixa passar, e não cobra token duas vezes", async () => {
    // Escolha consciente: parar todos os agentes de todos os workspaces porque
    // uma leitura falhou seria muito pior que uma execução a mais atravessando
    // a linha. Quem soma o gasto é o banco, ao fechar, e isso continua valendo.
    const banco = criarBancoFalso({ tetoFalhou: true });
    resolvendoPara(modeloQueResponde("ok"));

    const r = await runAgent({
      supabase: banco.cliente,
      agent: agenteDeTeste(),
      organization: ORG,
      user: DONO,
      triggerKind: "manual",
      input: { prompt: "oi" },
    });

    expect(r.ok).toBe(true);
    expect(banco.rpcs.consume_llm_tokens).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4 — a linha de parada por custo (o "momento B")
// ---------------------------------------------------------------------------

function recorderComCusto(custo: number | null): RunRecorder {
  return {
    runId: RUN_ID,
    markModelStepStart() {},
    async recordModelStep() {},
    async recordToolStep() {},
    // Nenhum teste deste arquivo grava passo de ação — stub só pro tipo
    // `RunRecorder` (onda 7).
    async recordAcaoStep() {},
    custoAcumuladoMicros: () => custo,
  };
}

/** O que o AI SDK entrega pra uma condição de parada. */
const SEM_PASSOS = { steps: [] };

describe("teto POR EXECUÇÃO — a parada que roda em memória", () => {
  it("sem teto por execução, só o número de passos limita", () => {
    const paradas = montarParadas({
      maxSteps: 5,
      maxRunCostMicros: null,
      recorder: recorderComCusto(999_999_999),
    });
    expect(paradas).toHaveLength(1);
  });

  it("com teto por execução, entra uma segunda parada", () => {
    const paradas = montarParadas({
      maxSteps: 5,
      maxRunCostMicros: 100_000,
      recorder: recorderComCusto(0),
    });
    expect(paradas).toHaveLength(2);
  });

  it("abaixo do teto o laço continua; ao alcançar, ele para", async () => {
    const barato = montarParadas({
      maxSteps: 20,
      maxRunCostMicros: 100_000,
      recorder: recorderComCusto(99_999),
    });
    expect(await barato[1]?.(SEM_PASSOS)).toBe(false);

    const noLimite = montarParadas({
      maxSteps: 20,
      maxRunCostMicros: 100_000,
      recorder: recorderComCusto(100_000),
    });
    expect(await noLimite[1]?.(SEM_PASSOS)).toBe(true);

    const passou = montarParadas({
      maxSteps: 20,
      maxRunCostMicros: 100_000,
      recorder: recorderComCusto(250_000),
    });
    expect(await passou[1]?.(SEM_PASSOS)).toBe(true);
  });

  it("custo desconhecido NÃO para o laço — parar por número que não existe seria chute", () => {
    const semPreco = montarParadas({
      maxSteps: 20,
      maxRunCostMicros: 100_000,
      recorder: recorderComCusto(null),
    });
    expect(semPreco[1]?.(SEM_PASSOS)).toBe(false);
  });

  it("a parada NÃO vai ao banco: ela só pergunta pro gravador", async () => {
    // Se um dia isso virar uma consulta, um agente de 20 passos passa a fazer
    // 20 idas a mais ao banco por execução — e o teto que existe pra economizar
    // dinheiro passa a custar tempo.
    let perguntas = 0;
    const recorder: RunRecorder = {
      ...recorderComCusto(0),
      custoAcumuladoMicros: () => {
        perguntas += 1;
        return 10;
      },
    };
    const paradas = montarParadas({ maxSteps: 3, maxRunCostMicros: 100, recorder });
    await paradas[1]?.(SEM_PASSOS);
    await paradas[1]?.(SEM_PASSOS);
    expect(perguntas).toBe(2);
  });
});
