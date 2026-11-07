import { describe, expect, test } from "vitest";
import { MODEL_CATALOG } from "@/lib/ai/catalog";
import { calcCostMicros, calcCostMicrosById, extractProviderCostMicros } from "@/lib/ai/cost";
import type { ModelCatalogEntry } from "@/lib/ai/types";

/** US$ 3,00 de entrada e US$ 15,00 de saída por 1M de tokens. */
const PRECO = {
  inputMicrosPerMillion: 3_000_000,
  outputMicrosPerMillion: 15_000_000,
} satisfies Pick<ModelCatalogEntry, "inputMicrosPerMillion" | "outputMicrosPerMillion">;

/** O modelo do catálogo com faixa cara acima de 200 mil tokens de entrada. */
const GEMINI_PRO = "google:gemini-3.1-pro-preview";

describe("calcCostMicros — a conta básica", () => {
  test("1000 de entrada e 500 de saída dão US$ 0,0105", () => {
    const c = calcCostMicros({ entry: PRECO, tokens: { input: 1000, output: 500 } });
    expect(c.inputMicros).toBe(3_000); // 1000 × US$3 / 1M
    expect(c.outputMicros).toBe(7_500); // 500 × US$15 / 1M
    expect(c.totalMicros).toBe(10_500); // US$ 0,0105
    expect(c.exact).toBe(true);
    expect(c.longContextApplied).toBe(false);
  });

  test("execução de 1M de tokens de entrada custa exatamente o preço de tabela", () => {
    const c = calcCostMicros({ entry: PRECO, tokens: { input: 1_000_000, output: 0 } });
    expect(c.inputMicros).toBe(3_000_000);
  });

  test("zero token custa zero (e zero aqui é zero MESMO, não 'não sei')", () => {
    const c = calcCostMicros({ entry: PRECO, tokens: { input: 0, output: 0 } });
    expect(c.totalMicros).toBe(0);
    expect(c.exact).toBe(true);
  });

  test("o total é sempre a soma das duas pontas", () => {
    for (const m of MODEL_CATALOG) {
      const c = calcCostMicros({ entry: m, tokens: { input: 12_345, output: 6_789 } });
      expect(c.totalMicros).toBe(c.inputMicros + c.outputMicros);
    }
  });
});

describe("calcCostMicros — inteiro e arredondado PRA CIMA", () => {
  // A regra: a estimativa nunca pode sair MENOR que a conta que vai chegar.
  test("fração de micro-dólar vira 1, não 0", () => {
    // 1 token × US$ 0,20 / 1M = 0,2 micro-dólar.
    const c = calcCostMicros({
      entry: { inputMicrosPerMillion: 200_000, outputMicrosPerMillion: 1_200_000 },
      tokens: { input: 1, output: 0 },
    });
    expect(c.inputMicros).toBe(1);
  });

  test("o mais barato do catálogo também nunca arredonda pra baixo", () => {
    // DeepSeek: 13 tokens × 75_600 / 1M = 0,98 micro-dólar.
    const c = calcCostMicros({
      entry: { inputMicrosPerMillion: 75_600, outputMicrosPerMillion: 151_200 },
      tokens: { input: 13, output: 0 },
    });
    expect(c.inputMicros).toBe(1);
  });

  test("todo resultado é inteiro, pra qualquer modelo e qualquer contagem", () => {
    const contagens = [1, 7, 13, 999, 1_001, 123_457, 1_000_000];
    for (const m of MODEL_CATALOG) {
      for (const n of contagens) {
        const c = calcCostMicros({ entry: m, tokens: { input: n, output: n } });
        expect(Number.isInteger(c.inputMicros)).toBe(true);
        expect(Number.isInteger(c.outputMicros)).toBe(true);
        expect(Number.isInteger(c.totalMicros)).toBe(true);
      }
    }
  });

  test("nunca cobra a menos do que a conta exata", () => {
    for (const m of MODEL_CATALOG) {
      const c = calcCostMicros({ entry: m, tokens: { input: 3_333, output: 777 } });
      expect(c.inputMicros).toBeGreaterThanOrEqual((3_333 * m.inputMicrosPerMillion) / 1_000_000);
      expect(c.outputMicros).toBeGreaterThanOrEqual((777 * m.outputMicrosPerMillion) / 1_000_000);
    }
  });
});

describe("calcCostMicros — quando o provedor não contou os tokens", () => {
  test("entrada indefinida marca exact: false e conta como piso", () => {
    const c = calcCostMicros({ entry: PRECO, tokens: { input: undefined, output: 500 } });
    expect(c.exact).toBe(false);
    expect(c.inputMicros).toBe(0);
    expect(c.outputMicros).toBe(7_500);
  });

  test("saída indefinida também marca exact: false", () => {
    expect(calcCostMicros({ entry: PRECO, tokens: { input: 10, output: undefined } }).exact).toBe(
      false,
    );
  });

  test("as duas indefinidas dão zero, mas com exact: false (não é 'custou zero')", () => {
    const c = calcCostMicros({ entry: PRECO, tokens: { input: undefined, output: undefined } });
    expect(c.totalMicros).toBe(0);
    expect(c.exact).toBe(false);
  });

  test("contagem negativa ou quebrada não vira custo negativo", () => {
    const c = calcCostMicros({ entry: PRECO, tokens: { input: -50, output: 10.9 } });
    expect(c.inputMicros).toBe(0);
    expect(c.outputMicros).toBe(150); // 10 tokens, o 0,9 é descartado
    expect(c.totalMicros).toBeGreaterThanOrEqual(0);
  });

  test("NaN é tratado como 'não veio', não como zero exato", () => {
    expect(calcCostMicros({ entry: PRECO, tokens: { input: Number.NaN, output: 1 } }).exact).toBe(
      false,
    );
  });
});

describe("calcCostMicros — a faixa cara do prompt gigante", () => {
  const COM_FAIXA = {
    inputMicrosPerMillion: 2_000_000,
    outputMicrosPerMillion: 12_000_000,
    longContextPricing: {
      thresholdTokens: 200_000,
      inputMicrosPerMillion: 4_000_000,
      outputMicrosPerMillion: 18_000_000,
    },
  };

  test("exatamente no limite ainda é preço normal", () => {
    const c = calcCostMicros({ entry: COM_FAIXA, tokens: { input: 200_000, output: 1_000 } });
    expect(c.longContextApplied).toBe(false);
    expect(c.inputMicros).toBe(400_000); // 200k × US$2 / 1M
    expect(c.outputMicros).toBe(12_000); // 1k × US$12 / 1M
  });

  test("um token acima do limite já vira preço de faixa", () => {
    const c = calcCostMicros({ entry: COM_FAIXA, tokens: { input: 200_001, output: 1_000 } });
    expect(c.longContextApplied).toBe(true);
    expect(c.inputMicros).toBe(800_004); // 200.001 × US$4 / 1M
  });

  // Isso é o que os provedores realmente cobram: a faixa vale pra execução
  // inteira, não só pros tokens que passaram do limite.
  test("a faixa encarece TAMBÉM a saída, não só a entrada", () => {
    const c = calcCostMicros({ entry: COM_FAIXA, tokens: { input: 300_000, output: 1_000 } });
    expect(c.outputMicros).toBe(18_000); // 1k × US$18 / 1M, não US$12
  });

  test("modelo sem faixa nunca marca longContextApplied, nem com prompt gigante", () => {
    const c = calcCostMicros({ entry: PRECO, tokens: { input: 900_000, output: 10 } });
    expect(c.longContextApplied).toBe(false);
  });

  test("quem não contou a entrada não cai na faixa por acidente", () => {
    const c = calcCostMicros({ entry: COM_FAIXA, tokens: { input: undefined, output: 1_000 } });
    expect(c.longContextApplied).toBe(false);
  });
});

describe("calcCostMicrosById — partindo do identificador do modelo", () => {
  test("modelo do catálogo dá o mesmo resultado do cálculo direto", () => {
    const tokens = { input: 5_000, output: 1_200 };
    const porId = calcCostMicrosById("anthropic:claude-sonnet-5", tokens);
    const entry = MODEL_CATALOG.find((m) => m.id === "anthropic:claude-sonnet-5");
    expect(entry).toBeDefined();
    expect(porId).toEqual(calcCostMicros({ entry: entry as ModelCatalogEntry, tokens }));
  });

  test("o Gemini Pro em prévia respeita a faixa também por id", () => {
    const c = calcCostMicrosById(GEMINI_PRO, { input: 250_000, output: 0 });
    expect(c?.longContextApplied).toBe(true);
    expect(c?.inputMicros).toBe(1_000_000); // 250k × US$4 / 1M
  });

  // NULL, NÃO ZERO. Modelo fora do catálogo grava cost_micros = null no banco,
  // e a tela lê isso como "preço desconhecido". Gravar 0 mostraria
  // "US$ 0,0000" pra uma execução que custou dinheiro de verdade.
  test("modelo fora do catálogo devolve null (nunca 0)", () => {
    expect(calcCostMicrosById("anthropic:modelo-inventado", { input: 10, output: 10 })).toBeNull();
    expect(calcCostMicrosById("", { input: 10, output: 10 })).toBeNull();
    expect(calcCostMicrosById("texto-solto", { input: 10, output: 10 })).toBeNull();
  });
});

describe("extractProviderCostMicros — o custo real que o OpenRouter informa", () => {
  test("crédito no topo do objeto vira micro-dólar", () => {
    expect(extractProviderCostMicros({ cost: 0.0123 })).toBe(12_300);
    expect(extractProviderCostMicros({ cost: 1 })).toBe(1_000_000);
    expect(extractProviderCostMicros({ cost: 0 })).toBe(0);
  });

  test("crédito dentro de `raw` também é achado", () => {
    expect(extractProviderCostMicros({ inputTokens: 10, raw: { cost: 0.5 } })).toBe(500_000);
  });

  test("o valor do topo ganha do de dentro do `raw`", () => {
    expect(extractProviderCostMicros({ cost: 0.07, raw: { cost: 999 } })).toBe(70_000);
  });

  test("crédito que veio como texto também vale", () => {
    expect(extractProviderCostMicros({ cost: "0.0123" })).toBe(12_300);
  });

  test("sempre arredonda pra cima e devolve inteiro", () => {
    const micros = extractProviderCostMicros({ cost: 0.0001234 });
    expect(micros).toBe(124);
    expect(Number.isInteger(micros)).toBe(true);
  });

  // Best-effort de verdade: essa função é chamada dentro do caminho de gravar
  // a execução. Se ela lançasse, o rastro do agente sumiria por causa de um
  // campo estranho na resposta do provedor.
  test.each([
    ["indefinido", undefined],
    ["nulo", null],
    ["número solto", 42],
    ["texto solto", "0.5"],
    ["array", [{ cost: 1 }]],
    ["sem o campo cost", { inputTokens: 10, outputTokens: 5 }],
    ["cost não numérico", { cost: "grátis" }],
    ["cost negativo", { cost: -1 }],
    ["cost infinito", { cost: Number.POSITIVE_INFINITY }],
    ["cost NaN", { cost: Number.NaN }],
    ["cost nulo", { cost: null }],
    ["raw que não é objeto", { raw: "nada" }],
  ])("%s devolve null sem lançar", (_nome, entrada) => {
    expect(extractProviderCostMicros(entrada)).toBeNull();
  });
});
