import { describe, expect, test } from "vitest";
import { type AiConfigError, isAiConfigError } from "@/lib/ai/errors";
import { formatModelId, modelIdSchema, parseModelId, tryParseModelId } from "@/lib/ai/model-id";

describe("parseModelId — quebra 'provedor:modelo'", () => {
  test.each([
    ["anthropic:claude-sonnet-5", "anthropic", "claude-sonnet-5"],
    ["openai:gpt-5.6-luna", "openai", "gpt-5.6-luna"],
    ["google:gemini-3.7-flash", "google", "gemini-3.7-flash"],
    ["openrouter:google/gemini-3.7-flash", "openrouter", "google/gemini-3.7-flash"],
  ])("%s → %s + %s", (id, provider, providerModelId) => {
    expect(parseModelId(id)).toEqual({ provider, providerModelId, id });
  });

  // ESTE É O TESTE QUE JUSTIFICA O indexOf(":") EM VEZ DE split(":").
  // Esses dois apelidos existem de verdade no OpenRouter (conferido em
  // 20/08/2026). Com split(":") o pedaço depois do segundo ':' sumiria e o
  // agente passaria a rodar num modelo DIFERENTE, sem avisar ninguém.
  test.each([
    ["openrouter:z-ai/glm-5.2:free", "z-ai/glm-5.2:free"],
    ["openrouter:anthropic/claude-opus-5:batch", "anthropic/claude-opus-5:batch"],
  ])("%s guarda os ':' de dentro do apelido", (id, providerModelId) => {
    const r = parseModelId(id);
    expect(r.provider).toBe("openrouter");
    expect(r.providerModelId).toBe(providerModelId);
    // E a volta tem que devolver exatamente o texto original.
    expect(formatModelId(r.provider, r.providerModelId)).toBe(id);
  });

  test("espaço em volta não atrapalha (copiar e colar costuma trazer)", () => {
    expect(parseModelId("  anthropic:claude-sonnet-5  ").id).toBe("anthropic:claude-sonnet-5");
  });
});

describe("parseModelId — o que ele recusa", () => {
  test.each([
    ["texto sem ':'", "claude-sonnet-5"],
    ["vazio", ""],
    ["só espaço", "   "],
    ["sem provedor", ":claude-sonnet-5"],
    ["sem modelo", "anthropic:"],
    ["só o separador", ":"],
  ])("%s → id-invalido", (_nome, entrada) => {
    try {
      parseModelId(entrada);
      throw new Error("devia ter lançado");
    } catch (err) {
      expect(isAiConfigError(err)).toBe(true);
      expect((err as AiConfigError).code).toBe("id-invalido");
    }
  });

  test.each([
    ["cohere:command-r"],
    ["mistral:large"],
    ["OpenAI:gpt-5.6-luna"],
  ])("%s → provedor-desconhecido", (entrada) => {
    try {
      parseModelId(entrada);
      throw new Error("devia ter lançado");
    } catch (err) {
      expect(isAiConfigError(err)).toBe(true);
      expect((err as AiConfigError).code).toBe("provedor-desconhecido");
    }
  });

  test("a mensagem que vai pra tela não vaza detalhe técnico", () => {
    try {
      parseModelId("cohere:command-r");
      throw new Error("devia ter lançado");
    } catch (err) {
      const e = err as AiConfigError;
      // O texto leigo fala do que fazer; o técnico fala de AI_PROVIDERS.
      expect(e.mensagemLeiga).toContain("Escolha um modelo da lista");
      expect(e.mensagemLeiga).not.toContain("AI_PROVIDERS");
      expect(e.message).toContain("AI_PROVIDERS");
      expect(e.provider).toBeNull();
    }
  });
});

describe("tryParseModelId — a versão que não lança", () => {
  test("devolve null em vez de explodir", () => {
    expect(tryParseModelId("cohere:command-r")).toBeNull();
    expect(tryParseModelId("sem-dois-pontos")).toBeNull();
  });

  test("devolve o mesmo que o parseModelId quando dá certo", () => {
    expect(tryParseModelId("google:gemini-3.7-flash")).toEqual(
      parseModelId("google:gemini-3.7-flash"),
    );
  });
});

describe("modelIdSchema — a checagem de FORMATO usada pelos formulários", () => {
  test.each([
    "anthropic:claude-sonnet-5",
    "openrouter:z-ai/glm-5.2:free",
    "google:gemini-3.7-flash",
  ])("aceita %s", (id) => {
    expect(modelIdSchema.safeParse(id).success).toBe(true);
  });

  test.each([
    "",
    "claude-sonnet-5",
    "cohere:command-r",
    "anthropic:",
    "anthropic: com espaco",
  ])("recusa %s", (id) => {
    expect(modelIdSchema.safeParse(id).success).toBe(false);
  });

  test("recusa nome de modelo absurdamente longo", () => {
    expect(modelIdSchema.safeParse(`openai:${"g".repeat(500)}`).success).toBe(false);
  });
});
