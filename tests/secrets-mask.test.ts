import { describe, expect, test } from "vitest";
import { fingerprintSecret, maskCredential } from "@/lib/secrets/mask";
import { CREDENTIAL_PROVIDERS, getProviderInfo, listAiProviders } from "@/lib/secrets/providers";

// Chaves de mentira, com o mesmo FORMATO das de verdade.
const OPENROUTER = "sk-or-v1-9f3c8ab2d4e6071f5a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2c0d1";
const ANTHROPIC = "sk-ant-api03-Wq7fH2pLmN4vX8cR1tYbZ6dK0jS3aG5uE9iO2nQ4f2a";
const OPENAI = "sk-proj-7bK2mQ9wZ1xC4vB8nM3jH6gF5dS0aP7oI9uY2tR4eW1qL8kJc0d1";
const GOOGLE = "AIzaSyD9kL2mN4pQ6rS8tU0vW1xY3zA5bC7dE9Qk2";
const RESEND = "re_8HdKq2Mn_5RtY7uI9oP1aS3dF6gH8jK0lZ7b1e";

describe("fingerprintSecret — o 'sobrenome' da chave", () => {
  test.each([
    ["OpenRouter", OPENROUTER, "sk-or-"],
    ["Anthropic", ANTHROPIC, "sk-ant-"],
    ["OpenAI (projeto)", OPENAI, "sk-proj-"],
    ["Resend", RESEND, "re_"],
  ])("%s → prefixo %s", (_nome, chave, esperado) => {
    expect(fingerprintSecret(chave).prefix).toBe(esperado);
  });

  test("chave sem separador nenhum (Google) devolve prefixo VAZIO", () => {
    // Se devolvesse os 8 primeiros caracteres, estaria vazando miolo do segredo.
    expect(fingerprintSecret(GOOGLE).prefix).toBe("");
  });

  test("pega os 4 últimos caracteres", () => {
    expect(fingerprintSecret(ANTHROPIC).last4).toBe("4f2a");
    expect(fingerprintSecret(GOOGLE).last4).toBe("9Qk2");
    expect(fingerprintSecret(RESEND).last4).toBe("7b1e");
  });

  test("separador fora dos 8 primeiros caracteres é ignorado", () => {
    // O primeiro "-" está na posição 12: fora da janela, então não vira prefixo.
    expect(fingerprintSecret("abcdefghijkl-mnop-qrst").prefix).toBe("");
  });

  test("espaço em volta não conta (copiar e colar costuma trazer)", () => {
    expect(fingerprintSecret(`  ${ANTHROPIC}  `)).toEqual(fingerprintSecret(ANTHROPIC));
  });

  test("texto vazio não quebra", () => {
    expect(fingerprintSecret("")).toEqual({ prefix: "", last4: "" });
    expect(fingerprintSecret("   ")).toEqual({ prefix: "", last4: "" });
  });

  test("o prefixo nunca inclui o miolo do segredo", () => {
    for (const chave of [OPENROUTER, ANTHROPIC, OPENAI, GOOGLE, RESEND]) {
      const { prefix } = fingerprintSecret(chave);
      expect(prefix.length).toBeLessThanOrEqual(8);
      // Prefixo, quando existe, sempre termina no separador.
      if (prefix !== "") expect(["-", "_"]).toContain(prefix.slice(-1));
    }
  });
});

describe("maskCredential — o que a tela mostra", () => {
  test("junta sobrenome + reticências + 4 últimos", () => {
    expect(maskCredential(fingerprintSecret(ANTHROPIC))).toBe("sk-ant-…4f2a");
    expect(maskCredential(fingerprintSecret(OPENROUTER))).toBe("sk-or-…c0d1");
    expect(maskCredential(fingerprintSecret(RESEND))).toBe("re_…7b1e");
  });

  test("sem sobrenome, mostra só as reticências e os 4 últimos", () => {
    expect(maskCredential(fingerprintSecret(GOOGLE))).toBe("…9Qk2");
  });

  test("o texto mascarado NUNCA contém a chave inteira", () => {
    for (const chave of [OPENROUTER, ANTHROPIC, OPENAI, GOOGLE, RESEND]) {
      const mascarado = maskCredential(fingerprintSecret(chave));
      expect(mascarado).not.toContain(chave);
      // e é bem mais curto que o original
      expect(mascarado.length).toBeLessThan(chave.length);
    }
  });

  test("o miolo da chave não aparece em lugar nenhum do texto mascarado", () => {
    for (const chave of [OPENROUTER, ANTHROPIC, OPENAI, GOOGLE, RESEND]) {
      const { prefix } = fingerprintSecret(chave);
      const miolo = chave.slice(prefix.length, -4);
      const mascarado = maskCredential(fingerprintSecret(chave));

      expect(miolo.length).toBeGreaterThan(8);
      // Nenhum pedaço de 6 caracteres do miolo pode estar no texto da tela.
      for (let i = 0; i + 6 <= miolo.length; i++) {
        expect(mascarado).not.toContain(miolo.slice(i, i + 6));
      }
    }
  });

  test("fingerprint vazio não vira texto vazio (a tela sempre mostra algo)", () => {
    expect(maskCredential({ prefix: "", last4: "" })).toBe("…");
  });
});

describe("catálogo de provedores", () => {
  test("tem exatamente os cinco provedores que o banco aceita", () => {
    expect(CREDENTIAL_PROVIDERS.map((p) => p.id)).toEqual([
      "openrouter",
      "anthropic",
      "openai",
      "google",
      "resend",
    ]);
  });

  test("só o Resend tem campo de remetente, e só ele não é provedor de IA", () => {
    expect(CREDENTIAL_PROVIDERS.filter((p) => p.hasSenderField).map((p) => p.id)).toEqual([
      "resend",
    ]);
    expect(listAiProviders().map((p) => p.id)).toEqual([
      "openrouter",
      "anthropic",
      "openai",
      "google",
    ]);
  });

  test("todo provedor tem texto de ajuda preenchido e link https", () => {
    for (const p of CREDENTIAL_PROVIDERS) {
      expect(p.label.length).toBeGreaterThan(2);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.keyHint.length).toBeGreaterThan(5);
      expect(p.helpUrl.startsWith("https://")).toBe(true);
    }
  });

  test("getProviderInfo acha pelo id", () => {
    expect(getProviderInfo("openrouter").label).toBe("OpenRouter");
    expect(getProviderInfo("resend").hasSenderField).toBe(true);
  });

  test("a dica de formato bate com o prefixo real da chave", () => {
    const casos = [
      ["openrouter", OPENROUTER],
      ["anthropic", ANTHROPIC],
      ["resend", RESEND],
    ] as const;

    for (const [id, chave] of casos) {
      const dica = getProviderInfo(id).keyHint.replace("Começa com ", "");
      expect(chave.startsWith(dica)).toBe(true);
    }
  });
});
