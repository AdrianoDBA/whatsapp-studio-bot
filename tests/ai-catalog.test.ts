import { describe, expect, test } from "vitest";
import {
  DEFAULT_MODEL_ID,
  getModel,
  isKnownModelId,
  listModels,
  listModelsByProvider,
  MODEL_CATALOG,
  pickDefaultModelId,
} from "@/lib/ai/catalog";
import { parseModelId } from "@/lib/ai/model-id";
import { AI_PROVIDERS, type AiProviderName } from "@/lib/ai/types";

/** O mesmo critério de "mais barato" que ordena o arquivo. */
function precoSomado(m: { inputMicrosPerMillion: number; outputMicrosPerMillion: number }) {
  return m.inputMicrosPerMillion + m.outputMicrosPerMillion;
}

describe("MODEL_CATALOG — integridade de cada linha", () => {
  test("tem os 15 modelos conferidos no contrato", () => {
    expect(MODEL_CATALOG).toHaveLength(15);
  });

  test("nenhum id repetido", () => {
    const ids = MODEL_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("o id é EXATAMENTE `provedor:apelido` — e o parse volta pra ele", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.id).toBe(`${m.provider}:${m.providerModelId}`);
      const parsed = parseModelId(m.id);
      expect(parsed.provider).toBe(m.provider);
      expect(parsed.providerModelId).toBe(m.providerModelId);
    }
  });

  test("todo provedor usado está em AI_PROVIDERS", () => {
    for (const m of MODEL_CATALOG) {
      expect(AI_PROVIDERS).toContain(m.provider);
    }
  });

  // Dinheiro é INTEIRO. Um float que entrasse aqui contaminaria o cálculo
  // inteiro de cost.ts e o bigint de agent_runs.cost_micros.
  test("todo preço é inteiro e positivo", () => {
    for (const m of MODEL_CATALOG) {
      expect(Number.isInteger(m.inputMicrosPerMillion)).toBe(true);
      expect(Number.isInteger(m.outputMicrosPerMillion)).toBe(true);
      expect(m.inputMicrosPerMillion).toBeGreaterThan(0);
      expect(m.outputMicrosPerMillion).toBeGreaterThan(0);
    }
  });

  test("saída nunca é mais barata que entrada (nenhum preço trocado de lugar)", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.outputMicrosPerMillion).toBeGreaterThanOrEqual(m.inputMicrosPerMillion);
    }
  });

  test("limites de tamanho são inteiros positivos e coerentes", () => {
    for (const m of MODEL_CATALOG) {
      expect(Number.isInteger(m.contextWindow)).toBe(true);
      expect(Number.isInteger(m.maxOutputTokens)).toBe(true);
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.maxOutputTokens).toBeGreaterThan(0);
      expect(m.maxOutputTokens).toBeLessThanOrEqual(m.contextWindow);
    }
  });

  test("todo modelo tem rótulo, descrição em PT-BR e data de conferência", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.label.length).toBeGreaterThan(2);
      expect(m.description.length).toBeGreaterThan(20);
      // A data aparece na tela ("preço conferido em ..."), então tem que ser
      // uma data de verdade no formato ISO curto.
      expect(m.pricedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(m.pricedAt))).toBe(false);
    }
  });

  // De propósito NÃO existe teste que quebre quando pricedAt fica velho — ver
  // o comentário no topo de catalog.ts e o conflito C22 do contrato.

  test("a faixa cara, quando existe, é mais cara que o preço normal", () => {
    for (const m of MODEL_CATALOG) {
      if (!m.longContextPricing) continue;
      expect(m.longContextPricing.thresholdTokens).toBeGreaterThan(0);
      expect(m.longContextPricing.inputMicrosPerMillion).toBeGreaterThan(m.inputMicrosPerMillion);
      expect(m.longContextPricing.outputMicrosPerMillion).toBeGreaterThan(m.outputMicrosPerMillion);
      // Faixa de preço sem explicação na tela é armadilha pro leigo.
      expect(m.pricingNote).toBeTruthy();
    }
  });

  test("o Gemini Pro em prévia é o único com faixa cara, com o dobro acima de 200k", () => {
    const comFaixa = MODEL_CATALOG.filter((m) => m.longContextPricing);
    expect(comFaixa.map((m) => m.id)).toEqual(["google:gemini-3.1-pro-preview"]);
    expect(comFaixa[0]?.longContextPricing).toEqual({
      thresholdTokens: 200_000,
      inputMicrosPerMillion: 4_000_000,
      outputMicrosPerMillion: 18_000_000,
    });
  });

  test("os avisos de preço combinados no contrato estão nos modelos certos", () => {
    const comAviso = MODEL_CATALOG.filter((m) => m.pricingNote).map((m) => m.id);
    expect(comAviso.sort()).toEqual(
      [
        "anthropic:claude-sonnet-5",
        "google:gemini-3.1-pro-preview",
        "google:gemini-3.7-flash",
        "openrouter:google/gemini-3.7-flash",
      ].sort(),
    );
  });
});

describe("MODEL_CATALOG — a ordem que a tela mostra", () => {
  test("recomendados vêm todos antes dos outros", () => {
    const posicoes = MODEL_CATALOG.map((m) => m.recommended);
    const primeiroNaoRecomendado = posicoes.indexOf(false);
    expect(primeiroNaoRecomendado).toBeGreaterThan(0);
    expect(posicoes.slice(primeiroNaoRecomendado)).not.toContain(true);
  });

  test("dentro de cada bloco, do mais barato pro mais caro", () => {
    for (const bloco of [true, false]) {
      const doBloco = MODEL_CATALOG.filter((m) => m.recommended === bloco);
      const precos = doBloco.map(precoSomado);
      const ordenados = [...precos].sort((a, b) => a - b);
      expect(precos).toEqual(ordenados);
    }
  });
});

describe("getModel / isKnownModelId", () => {
  test("acha todo id do catálogo", () => {
    for (const m of MODEL_CATALOG) {
      expect(getModel(m.id)).toBe(m);
      expect(isKnownModelId(m.id)).toBe(true);
    }
  });

  test("id fora do catálogo devolve null — e NÃO lança", () => {
    expect(getModel("anthropic:modelo-que-nao-existe")).toBeNull();
    expect(getModel("")).toBeNull();
    expect(isKnownModelId("cohere:command-r")).toBe(false);
  });

  test("o mesmo modelo por dois caminhos são DUAS linhas (a conta é diferente)", () => {
    const direto = getModel("anthropic:claude-sonnet-5");
    const viaOpenRouter = getModel("openrouter:anthropic/claude-sonnet-5");
    expect(direto).not.toBeNull();
    expect(viaOpenRouter).not.toBeNull();
    expect(direto?.inputMicrosPerMillion).not.toBe(viaOpenRouter?.inputMicrosPerMillion);
  });
});

describe("listModels / listModelsByProvider", () => {
  test("listModels devolve o catálogo inteiro, na ordem", () => {
    expect(listModels()).toEqual(MODEL_CATALOG);
  });

  test("somando os quatro provedores dá o catálogo inteiro", () => {
    const total = AI_PROVIDERS.reduce((soma, p) => soma + listModelsByProvider(p).length, 0);
    expect(total).toBe(MODEL_CATALOG.length);
  });

  test("todo provedor tem pelo menos um modelo (senão a tela dele fica vazia)", () => {
    for (const p of AI_PROVIDERS) {
      expect(listModelsByProvider(p).length).toBeGreaterThan(0);
    }
  });
});

describe("DEFAULT_MODEL_ID e pickDefaultModelId", () => {
  test("o padrão de todo agente novo existe no catálogo e é recomendado", () => {
    const entry = getModel(DEFAULT_MODEL_ID);
    expect(entry).not.toBeNull();
    expect(entry?.recommended).toBe(true);
    expect(DEFAULT_MODEL_ID).toBe("openrouter:google/gemini-3.7-flash");
  });

  test.each([
    [["openrouter", "anthropic", "openai", "google"], "openrouter:google/gemini-3.7-flash"],
    [["anthropic", "google", "openai"], "google:gemini-3.7-flash"],
    [["anthropic", "openai"], "openai:gpt-5.6-luna"],
    [["anthropic"], "anthropic:claude-haiku-4-5"],
  ])("com %j escolhe %s", (provedores, esperado) => {
    expect(pickDefaultModelId(provedores as AiProviderName[])).toBe(esperado);
  });

  test("a ordem em que os provedores chegam não muda a escolha", () => {
    expect(pickDefaultModelId(["anthropic", "openrouter"])).toBe(
      pickDefaultModelId(["openrouter", "anthropic"]),
    );
  });

  test("sem nenhum provedor com chave devolve null (a tela pede pra cadastrar)", () => {
    expect(pickDefaultModelId([])).toBeNull();
  });

  test("tudo que ele escolhe está no catálogo", () => {
    for (const p of AI_PROVIDERS) {
      const escolhido = pickDefaultModelId([p]);
      expect(escolhido).not.toBeNull();
      expect(getModel(escolhido as string)).not.toBeNull();
    }
  });
});
