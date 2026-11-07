/**
 * O SELO DE ENSAIO — a única coisa honesta na tela quando o modelo mente.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------------------------------------------------------
 * Medido no navegador, na verificação da onda 7: com o ensaio LIGADO (o padrão
 * do playground), o aluno pede "manda o email de aviso agora" e o card de
 * resposta escreve "Enviei o email com o relatório do dia para
 * chefe@empresa.com". Nada saiu. A ferramenta devolveu certinho
 * `{"aviso":"Isto foi um ENSAIO…","ensaio":true}` — o modelo ignorou. E numa
 * outra rodada ele disse "em modo de ensaio", ou seja: é INTERMITENTE, que é
 * pior, porque o aluno não tem como saber quando confiar no que lê.
 *
 * A instrução no prompt de sistema é reforço, não garantia (o mesmo tipo de
 * aviso já vinha dentro do resultado da ferramenta, e foi ignorado). Quem
 * garante é a coluna `agent_runs.modo` chegando na tela sem passar pelo
 * modelo. Estes testes trancam o caminho inteiro dessa coluna até o texto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunTrace } from "@/components/app/run-trace";
import type { RunTraceStep } from "@/lib/agents/runs-queries";

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// 1. O rótulo do passo segue o `simulado`
// ---------------------------------------------------------------------------
// O defeito irmão: o rastro escrevia "Passo 1 · **mandou** um email" e, dois
// centímetros abaixo, "✋ Ensaio — eu **teria** mandado". Duas frases se
// contradizendo na mesma tela; quem lê o título do passo e não o avisinho sai
// achando que o email saiu.

function passoDeEmail(patch: Partial<RunTraceStep> = {}): RunTraceStep {
  return {
    seq: 1,
    kind: "tool",
    toolName: "acao:email",
    input: { para: ["chefe@empresa.com"] },
    output: { detalhe: "eu teria mandado um email para chefe@empresa.com" },
    errorMessage: null,
    durationMs: 12,
    costMicros: 0,
    tokensInput: null,
    tokensOutput: null,
    simulado: false,
    detalhe: "eu teria mandado um email para chefe@empresa.com",
    ...patch,
  };
}

/** O que a pessoa enxerga na tela, sem nenhuma etiqueta de HTML. */
function visivel(steps: RunTraceStep[]): string {
  return renderToStaticMarkup(RunTrace({ steps }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("o rótulo do passo de ação", () => {
  it("em ensaio, escreve o verbo no CONDICIONAL: 'teria mandado'", () => {
    const texto = visivel([passoDeEmail({ simulado: true })]);
    expect(texto).toContain("teria mandado um email");
    // E não pode sobrar a forma no passado em lugar nenhum da linha.
    expect(texto).not.toContain("· mandou um email");
  });

  it("de verdade, continua no passado: 'mandou'", () => {
    const texto = visivel([passoDeEmail({ simulado: false })]);
    expect(texto).toContain("mandou um email");
    expect(texto).not.toContain("teria mandado");
  });

  it("erro ganha do ensaio: ação que nem no ensaio passou é 'tentou'", () => {
    // Uma ação que FALHOU (endereço barrado, destinatário inválido) não
    // "teria mandado" coisa nenhuma — nem simulando ela deu certo.
    const texto = visivel([
      passoDeEmail({ simulado: true, errorMessage: "O endereço não foi aceito." }),
    ]);
    expect(texto).toContain("· tentou mandar um email");
    // O aviso "✋ Ensaio" logo abaixo continua lá, com o detalhe da ação — o
    // que não pode é o RÓTULO do passo virar "teria mandado".
    expect(texto).not.toContain("· teria mandado");
  });

  it("ação que a tela ainda não conhece também vira frase em português", () => {
    const texto = visivel([passoDeEmail({ toolName: "acao:sms", simulado: true, detalhe: null })]);
    expect(texto).toContain("teria rodado uma ação (sms)");
  });
});

// ---------------------------------------------------------------------------
// 2. A leitura da execução traz o modo — e execução ANTIGA não quebra
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

/**
 * Um dublê do PostgREST que só sabe o que estas duas consultas usam.
 *
 * `getRunDetail` faz `.select().eq().eq().maybeSingle()` em `agent_runs` e
 * `.select().eq().eq().order()` em `agent_run_steps`; `listRuns` faz
 * `.select().eq().order().limit()` e espera o resultado direto.
 */
function criarSupabaseFalso(porTabela: Record<string, Linha[]>) {
  function consulta(tabela: string) {
    const linhas = porTabela[tabela] ?? [];
    const encadeada = {
      eq: () => encadeada,
      gte: () => encadeada,
      order: () => encadeada,
      limit: () => encadeada,
      maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
      // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
      then: (onOk: (v: { data: Linha[]; error: null }) => unknown) =>
        Promise.resolve(onOk({ data: linhas, error: null })),
    };
    return encadeada;
  }

  return {
    from: (tabela: string) => ({ select: () => consulta(tabela) }),
  } as unknown as SupabaseClient;
}

function comExecucao(linha: Linha) {
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () =>
      criarSupabaseFalso({
        agent_runs: [
          {
            id: RUN,
            agent_id: null,
            agent_slug: "avisador",
            trigger_kind: "manual",
            status: "succeeded",
            started_at: "2026-08-21T10:00:00Z",
            finished_at: "2026-08-21T10:00:02Z",
            cost_micros: 1200,
            created_at: "2026-08-21T10:00:00Z",
            input: {},
            output: "Enviei o email com o relatório do dia para chefe@empresa.com",
            error_message: null,
            tokens_input: 100,
            tokens_output: 20,
            model: "openrouter:google/gemini-3.7-flash",
            agent: null,
            profile: null,
            ...linha,
          },
        ],
        agent_run_steps: [],
      }),
  }));
}

/** Recarrega o módulo pra cada caso: o mock do cliente é feito na hora. */
async function lerExecucao(linha: Linha) {
  vi.resetModules();
  comExecucao(linha);
  const { getRunDetail } = await import("@/lib/agents/runs-queries");
  return getRunDetail(ORG, RUN);
}

describe("a leitura da execução traz o modo", () => {
  it("execução gravada em ensaio chega na tela como 'ensaio'", async () => {
    const run = await lerExecucao({ modo: "ensaio" });
    expect(run?.modo).toBe("ensaio");
  });

  it("execução ANTIGA (sem o valor) não quebra a leitura — vira 'real'", async () => {
    // ⚠️ A DECISÃO, escrita: execução gravada antes da coluna existir vira
    // "real", que é o SILÊNCIO (nenhuma tela desenha selo pra "real"). O
    // contrário — chamar de ensaio o que não se sabe — seria carimbar "nada
    // saiu pra fora" numa execução que PODE ter mandado email de verdade: a
    // mesma mentira que esta onda existe pra matar, só virada do avesso.
    const run = await lerExecucao({ modo: undefined });
    expect(run?.modo).toBe("real");
  });

  it("valor torto no banco também cai em 'real', sem lançar", async () => {
    const run = await lerExecucao({ modo: "Ensaio " });
    expect(run?.modo).toBe("real");
  });

  it("a lista de execuções também traz o modo", async () => {
    vi.resetModules();
    comExecucao({ modo: "ensaio" });
    const { listRuns } = await import("@/lib/agents/runs-queries");
    const linhas = await listRuns(ORG, {});
    expect(linhas[0]?.modo).toBe("ensaio");
  });
});

// ---------------------------------------------------------------------------
// 3. O prompt de sistema (reforço, não garantia)
// ---------------------------------------------------------------------------

describe("o prompt de sistema em modo ensaio", () => {
  const base = {
    agent: { name: "Avisador", system_prompt: "Você avisa o time." },
    organizationName: "Loja do Bairro",
    toolLabels: ["Mandar email"],
    now: new Date("2026-08-21T12:00:00Z"),
  };

  it("manda o modelo dizer que TERIA feito, não que fez", async () => {
    const { buildSystemPrompt } = await import("@/lib/agents/prompt");
    const p = buildSystemPrompt({ ...base, modo: "ensaio" });
    expect(p).toContain("ENSAIO");
    expect(p).toContain("TERIA");
    expect(p).toContain("NUNCA escreva que você fez");
  });

  it("em modo real, o rodapé sai exatamente como sempre foi", async () => {
    const { buildSystemPrompt } = await import("@/lib/agents/prompt");
    expect(buildSystemPrompt({ ...base, modo: "real" })).toBe(buildSystemPrompt(base));
  });
});
