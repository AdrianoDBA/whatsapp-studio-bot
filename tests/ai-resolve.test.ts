/**
 * Testes de `resolveModel` — a junção catálogo + cofre + fábrica.
 *
 * O cofre (`@/lib/secrets`) é DUBLADO aqui: ele fala com o banco usando o
 * cookie da sessão, que não existe fora de uma requisição. O que este arquivo
 * prova é a lógica de DECISÃO — qual chave é pedida, o que acontece quando ela
 * não existe, e que a mensagem que vai pra tela é leiga.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CredentialProvider, CredentialSource } from "@/lib/secrets/types";
import type { Database } from "@/types/supabase";

// `vi.hoisted` deixa os dublês existirem ANTES dos imports serem resolvidos —
// sem isso, a fábrica do vi.mock rodaria antes das constantes existirem.
const { resolveApiKey, getCredentialSources } = vi.hoisted(() => ({
  resolveApiKey: vi.fn(),
  getCredentialSources: vi.fn(),
}));

vi.mock("@/lib/secrets", () => ({ resolveApiKey, getCredentialSources }));

import { AiConfigError, isAiConfigError, isMissingCredentialError } from "@/lib/ai/errors";
import { hasAnyAiCredential, listConfiguredAiProviders, resolveModel } from "@/lib/ai/resolve";

/** Uma chave achada pelo cofre, do jeito que `resolveApiKey` devolve. */
function chaveAchada(provider: CredentialProvider, source: CredentialSource) {
  return {
    provider,
    apiKey: "sk-de-mentira-1234",
    source,
    credentialId: source === "env" ? null : "11111111-1111-1111-1111-111111111111",
    keyVersion: source === "env" ? null : 1,
    metadata: {},
  };
}

/** O que `getCredentialSources` devolve: um valor por provedor. */
function origens(parcial: Partial<Record<CredentialProvider, CredentialSource | null>>) {
  return {
    openrouter: null,
    anthropic: null,
    openai: null,
    google: null,
    resend: null,
    ...parcial,
  };
}

/**
 * O cliente do Supabase agora é OBRIGATÓRIO em `resolveModel` — quem chama tem
 * que dizer com que identidade a chave vai ser buscada (ver
 * `lib/secrets/resolve.ts`). Aqui ele é só um marcador: o cofre inteiro está
 * dublado, então nada é chamado nele. O que importa é que ele CHEGA no cofre.
 */
const SUPABASE = { marcador: "cliente-de-mentira" } as unknown as SupabaseClient<Database>;

beforeEach(() => {
  resolveApiKey.mockReset();
  getCredentialSources.mockReset();
});

describe("resolveModel — caminho feliz", () => {
  test("devolve o modelo, a ficha do catálogo e de onde veio a chave", async () => {
    resolveApiKey.mockResolvedValue(chaveAchada("anthropic", "workspace"));

    const r = await resolveModel({
      modelId: "anthropic:claude-sonnet-5",
      organizationId: "org-1",
      supabase: SUPABASE,
    });

    expect(r.provider).toBe("anthropic");
    expect(r.modelId).toBe("anthropic:claude-sonnet-5");
    expect(r.entry.inputMicrosPerMillion).toBe(3_000_000);
    expect(r.credentialSource).toBe("workspace");
    expect(r.model).toBeTruthy();
  });

  test("pede a chave do provedor certo, com o workspace certo", async () => {
    resolveApiKey.mockResolvedValue(chaveAchada("openrouter", "platform"));

    await resolveModel({
      modelId: "openrouter:google/gemini-3.7-flash",
      organizationId: "org-42",
      supabase: SUPABASE,
    });

    expect(resolveApiKey).toHaveBeenCalledWith("openrouter", {
      organizationId: "org-42",
      supabase: SUPABASE,
    });
  });

  test("workspace nulo é repassado como nulo (busca começa na plataforma)", async () => {
    resolveApiKey.mockResolvedValue(chaveAchada("google", "platform"));

    const r = await resolveModel({
      modelId: "google:gemini-3.7-flash",
      organizationId: null,
      supabase: SUPABASE,
    });

    expect(resolveApiKey).toHaveBeenCalledWith("google", {
      organizationId: null,
      supabase: SUPABASE,
    });
    expect(r.credentialSource).toBe("platform");
  });

  test("chave vinda de variável de ambiente também funciona", async () => {
    resolveApiKey.mockResolvedValue(chaveAchada("openai", "env"));
    const r = await resolveModel({
      modelId: "openai:gpt-5.6-luna",
      organizationId: null,
      supabase: SUPABASE,
    });
    expect(r.credentialSource).toBe("env");
  });

  test("apelido com ':' dentro chega inteiro na hora de montar o modelo", async () => {
    // Não está no catálogo, então o teste prova pelo ERRO que o parse não
    // cortou no lugar errado: o detalhe técnico traz o id completo.
    resolveApiKey.mockResolvedValue(chaveAchada("openrouter", "platform"));
    try {
      await resolveModel({
        modelId: "openrouter:z-ai/glm-5.2:free",
        organizationId: null,
        supabase: SUPABASE,
      });
      throw new Error("devia ter lançado");
    } catch (err) {
      expect((err as AiConfigError).code).toBe("modelo-desconhecido");
      expect((err as AiConfigError).message).toContain("z-ai/glm-5.2:free");
    }
  });
});

describe("resolveModel — o que ele recusa, e como explica", () => {
  test("identificador torto nem chega a pedir chave", async () => {
    await expect(
      resolveModel({ modelId: "claude-sonnet-5", organizationId: null, supabase: SUPABASE }),
    ).rejects.toThrow(AiConfigError);
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  test("provedor que o app não conhece nem chega a pedir chave", async () => {
    await expect(
      resolveModel({ modelId: "cohere:command-r", organizationId: null, supabase: SUPABASE }),
    ).rejects.toThrow(AiConfigError);
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  // Regra do contrato: identificador fora do catálogo é RECUSADO, sem exceção.
  // Aceitar desligaria o cálculo de custo em silêncio.
  test("modelo bem formado mas fora do catálogo é recusado", async () => {
    resolveApiKey.mockResolvedValue(chaveAchada("anthropic", "platform"));
    try {
      await resolveModel({
        modelId: "anthropic:claude-inventado-9",
        organizationId: null,
        supabase: SUPABASE,
      });
      throw new Error("devia ter lançado");
    } catch (err) {
      const e = err as AiConfigError;
      expect(e.code).toBe("modelo-desconhecido");
      expect(e.provider).toBe("anthropic");
      expect(e.mensagemLeiga).toContain("escolha outro modelo");
    }
  });

  test("sem chave nenhuma: erro de credencial, com o caminho da tela na mensagem", async () => {
    resolveApiKey.mockResolvedValue(null);
    try {
      await resolveModel({
        modelId: "anthropic:claude-sonnet-5",
        organizationId: "org-1",
        supabase: SUPABASE,
      });
      throw new Error("devia ter lançado");
    } catch (err) {
      const e = err as AiConfigError;
      expect(isAiConfigError(e)).toBe(true);
      expect(isMissingCredentialError(e)).toBe(true);
      expect(e.provider).toBe("anthropic");
      // Fala o nome do provedor, onde clicar e onde pegar a chave.
      expect(e.mensagemLeiga).toContain("Anthropic");
      expect(e.mensagemLeiga).toContain("Integrações");
      expect(e.mensagemLeiga).toContain("https://console.anthropic.com");
    }
  });

  test("a mensagem da tela não vaza o id do workspace; a técnica vaza", async () => {
    resolveApiKey.mockResolvedValue(null);
    try {
      await resolveModel({
        modelId: "google:gemini-3.7-flash",
        organizationId: "org-secreta",
        supabase: SUPABASE,
      });
      throw new Error("devia ter lançado");
    } catch (err) {
      const e = err as AiConfigError;
      expect(e.mensagemLeiga).not.toContain("org-secreta");
      expect(e.message).toContain("org-secreta");
    }
  });

  test("isMissingCredentialError separa 'falta chave' de 'modelo errado'", async () => {
    resolveApiKey.mockResolvedValue(chaveAchada("openai", "env"));
    try {
      await resolveModel({
        modelId: "openai:gpt-inventado",
        organizationId: null,
        supabase: SUPABASE,
      });
      throw new Error("devia ter lançado");
    } catch (err) {
      expect(isAiConfigError(err)).toBe(true);
      expect(isMissingCredentialError(err)).toBe(false);
    }
  });

  test("erro que não é de configuração passa batido pelos dois detectores", () => {
    expect(isAiConfigError(new Error("caiu a internet"))).toBe(false);
    expect(isMissingCredentialError(new Error("caiu a internet"))).toBe(false);
    expect(isMissingCredentialError(undefined)).toBe(false);
  });
});

describe("listConfiguredAiProviders / hasAnyAiCredential", () => {
  test("lista só quem tem chave, sempre na mesma ordem", async () => {
    getCredentialSources.mockResolvedValue(
      origens({ google: "workspace", openrouter: "platform" }),
    );
    expect(await listConfiguredAiProviders("org-1", SUPABASE)).toEqual(["openrouter", "google"]);
  });

  test("a ordem não depende da ordem que o cofre respondeu", async () => {
    getCredentialSources.mockResolvedValue(
      origens({ anthropic: "env", openai: "workspace", openrouter: "workspace" }),
    );
    expect(await listConfiguredAiProviders(null, SUPABASE)).toEqual([
      "openrouter",
      "anthropic",
      "openai",
    ]);
  });

  // O resend é envio de email, não IA — não pode aparecer no seletor de modelo.
  test("o Resend nunca entra na lista, mesmo com chave cadastrada", async () => {
    getCredentialSources.mockResolvedValue(origens({ resend: "platform" }));
    expect(await listConfiguredAiProviders("org-1", SUPABASE)).toEqual([]);
  });

  test("chave só de variável de ambiente conta como configurada", async () => {
    getCredentialSources.mockResolvedValue(origens({ anthropic: "env" }));
    expect(await listConfiguredAiProviders(null, SUPABASE)).toEqual(["anthropic"]);
    expect(await hasAnyAiCredential(null, SUPABASE)).toBe(true);
  });

  test("sem nenhuma chave de IA, hasAnyAiCredential é false", async () => {
    getCredentialSources.mockResolvedValue(origens({ resend: "platform" }));
    expect(await hasAnyAiCredential("org-1", SUPABASE)).toBe(false);
  });

  test("repassa o workspace pro cofre sem mexer", async () => {
    getCredentialSources.mockResolvedValue(origens({}));
    await listConfiguredAiProviders("org-7", SUPABASE);
    expect(getCredentialSources).toHaveBeenCalledWith("org-7", SUPABASE);
    await listConfiguredAiProviders(null, SUPABASE);
    expect(getCredentialSources).toHaveBeenCalledWith(null, SUPABASE);
  });
});
