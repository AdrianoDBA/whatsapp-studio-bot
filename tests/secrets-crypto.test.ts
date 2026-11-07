import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  assertVaultReady,
  CURRENT_KEY_VERSION,
  isVaultReady,
  openSecret,
  type SealedSecret,
  type SecretAad,
  sealSecret,
  vaultStatus,
} from "@/lib/secrets/crypto";
import {
  isVaultError,
  isVaultKeyMissing,
  VaultError,
  vaultErrorMessage,
} from "@/lib/secrets/types";

// Uma chave mestra de teste com 32 bytes de material, em base64 — o mesmo
// formato que o container gera e imprime no log.
const CHAVE_MESTRA = Buffer.alloc(32, 7).toString("base64");
const OUTRA_CHAVE_MESTRA = Buffer.alloc(32, 9).toString("base64");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const AAD_WORKSPACE: SecretAad = { organizationId: ORG_A, provider: "anthropic" };
const AAD_PLATAFORMA: SecretAad = { organizationId: null, provider: "anthropic" };

const SEGREDO = "sk-ant-api03-Wq7fH2pLmN4vX8cR1tYbZ6dK0jS3aG5uE9iO2nQ4f2a";

function definirChaveMestra(valor: string | undefined): void {
  if (valor === undefined) {
    delete process.env.ENCRYPTION_KEY;
    return;
  }
  process.env.ENCRYPTION_KEY = valor;
}

beforeEach(() => {
  definirChaveMestra(CHAVE_MESTRA);
  delete process.env.ENCRYPTION_KEY_EPHEMERAL;
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_EPHEMERAL;
});

// -----------------------------------------------------------------------------
// Ida e volta
// -----------------------------------------------------------------------------
describe("sealSecret / openSecret — ida e volta", () => {
  test("o que entra é exatamente o que sai", () => {
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    expect(openSecret(embrulho, AAD_WORKSPACE)).toBe(SEGREDO);
  });

  test("grava a versão da receita em uso", () => {
    expect(sealSecret(SEGREDO, AAD_WORKSPACE).keyVersion).toBe(CURRENT_KEY_VERSION);
  });

  test("a chave da plataforma (escopo nulo) também vai e volta", () => {
    const embrulho = sealSecret(SEGREDO, AAD_PLATAFORMA);
    expect(openSecret(embrulho, AAD_PLATAFORMA)).toBe(SEGREDO);
  });

  test("aguenta acento e emoji sem estragar o texto", () => {
    const texto = "chave-com-acentuação-e-🔐-no-meio";
    const embrulho = sealSecret(texto, AAD_WORKSPACE);
    expect(openSecret(embrulho, AAD_WORKSPACE)).toBe(texto);
  });

  test("o embrulho não contém o segredo em texto puro", () => {
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    const bytes = Buffer.from(embrulho.ciphertext, "base64").toString("utf8");
    expect(embrulho.ciphertext).not.toContain(SEGREDO);
    expect(bytes).not.toContain(SEGREDO);
    expect(bytes).not.toContain("sk-ant-");
  });

  test("o embrulho tem pelo menos o iv (12) + o lacre (16)", () => {
    const bruto = Buffer.from(sealSecret("x", AAD_WORKSPACE).ciphertext, "base64");
    expect(bruto.length).toBeGreaterThanOrEqual(12 + 16 + 1);
  });
});

// -----------------------------------------------------------------------------
// O iv é sorteado a cada gravação
// -----------------------------------------------------------------------------
describe("iv aleatório", () => {
  test("a MESMA entrada gera embrulhos DIFERENTES", () => {
    const um = sealSecret(SEGREDO, AAD_WORKSPACE);
    const dois = sealSecret(SEGREDO, AAD_WORKSPACE);

    expect(um.ciphertext).not.toBe(dois.ciphertext);
    // ...e os dois continuam abrindo no mesmo segredo.
    expect(openSecret(um, AAD_WORKSPACE)).toBe(SEGREDO);
    expect(openSecret(dois, AAD_WORKSPACE)).toBe(SEGREDO);
  });

  test("20 gravações seguidas dão 20 embrulhos distintos", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 20; i++) {
      vistos.add(sealSecret(SEGREDO, AAD_WORKSPACE).ciphertext);
    }
    expect(vistos.size).toBe(20);
  });

  test("os 12 primeiros bytes (o iv) mudam entre duas gravações", () => {
    const ivDe = (s: SealedSecret) => Buffer.from(s.ciphertext, "base64").subarray(0, 12);
    expect(ivDe(sealSecret(SEGREDO, AAD_WORKSPACE))).not.toEqual(
      ivDe(sealSecret(SEGREDO, AAD_WORKSPACE)),
    );
  });
});

// -----------------------------------------------------------------------------
// A garantia do GCM: mexeu, não abre
// -----------------------------------------------------------------------------
/** Vira um bit de um byte específico do embrulho e devolve o embrulho estragado. */
function adulterar(embrulho: SealedSecret, posicao: number): SealedSecret {
  const bruto = Buffer.from(embrulho.ciphertext, "base64");
  const alvo = posicao < 0 ? bruto.length + posicao : posicao;
  const byte = bruto[alvo];
  if (byte === undefined) throw new Error(`posição ${posicao} fora do embrulho`);
  bruto[alvo] = byte ^ 0x01;
  return { ...embrulho, ciphertext: bruto.toString("base64") };
}

describe("adulteração — a garantia do AES-GCM", () => {
  test("mexer nos DADOS faz a decifragem falhar (não devolve lixo, falha)", () => {
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    const estragado = adulterar(embrulho, -1);

    expect(estragado.ciphertext).not.toBe(embrulho.ciphertext);
    expect(() => openSecret(estragado, AAD_WORKSPACE)).toThrow(VaultError);
    try {
      openSecret(estragado, AAD_WORKSPACE);
      throw new Error("deveria ter falhado");
    } catch (err) {
      expect(isVaultError(err)).toBe(true);
      expect((err as VaultError).code).toBe("vault_wrong_key");
    }
  });

  test("mexer no IV faz a decifragem falhar", () => {
    const estragado = adulterar(sealSecret(SEGREDO, AAD_WORKSPACE), 0);
    expect(() => openSecret(estragado, AAD_WORKSPACE)).toThrow(VaultError);
  });

  test("mexer no LACRE (tag) faz a decifragem falhar", () => {
    const estragado = adulterar(sealSecret(SEGREDO, AAD_WORKSPACE), 12);
    expect(() => openSecret(estragado, AAD_WORKSPACE)).toThrow(VaultError);
  });

  test("cada byte do embrulho é protegido — nenhuma posição passa batido", () => {
    const embrulho = sealSecret("uma-chave-de-teste", AAD_WORKSPACE);
    const tamanho = Buffer.from(embrulho.ciphertext, "base64").length;

    for (let i = 0; i < tamanho; i++) {
      expect(() => openSecret(adulterar(embrulho, i), AAD_WORKSPACE)).toThrow(VaultError);
    }
  });

  test("embrulho cortado no meio não abre", () => {
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    const bruto = Buffer.from(embrulho.ciphertext, "base64");
    const cortado: SealedSecret = {
      ...embrulho,
      ciphertext: bruto.subarray(0, bruto.length - 3).toString("base64"),
    };
    expect(() => openSecret(cortado, AAD_WORKSPACE)).toThrow(VaultError);
  });
});

// -----------------------------------------------------------------------------
// O escopo e o provedor ficam amarrados ao embrulho (AAD)
// -----------------------------------------------------------------------------
describe("AAD — cifra copiada pra outra linha não abre", () => {
  test("cifra de um workspace não abre no ponto de vista de OUTRO workspace", () => {
    const embrulho = sealSecret(SEGREDO, { organizationId: ORG_A, provider: "anthropic" });
    expect(() => openSecret(embrulho, { organizationId: ORG_B, provider: "anthropic" })).toThrow(
      VaultError,
    );
  });

  test("cifra da plataforma não abre como se fosse de workspace", () => {
    const embrulho = sealSecret(SEGREDO, AAD_PLATAFORMA);
    expect(() => openSecret(embrulho, AAD_WORKSPACE)).toThrow(VaultError);
  });

  test("cifra de workspace não abre como se fosse da plataforma", () => {
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    expect(() => openSecret(embrulho, AAD_PLATAFORMA)).toThrow(VaultError);
  });

  test("trocar o provedor no mesmo escopo também não abre", () => {
    const embrulho = sealSecret(SEGREDO, { organizationId: ORG_A, provider: "anthropic" });
    expect(() => openSecret(embrulho, { organizationId: ORG_A, provider: "openai" })).toThrow(
      VaultError,
    );
  });
});

// -----------------------------------------------------------------------------
// Chave mestra trocada
// -----------------------------------------------------------------------------
describe("chave mestra trocada", () => {
  test("o que foi guardado com uma ENCRYPTION_KEY não abre com outra", () => {
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    definirChaveMestra(OUTRA_CHAVE_MESTRA);

    try {
      openSecret(embrulho, AAD_WORKSPACE);
      throw new Error("deveria ter falhado");
    } catch (err) {
      expect(isVaultError(err)).toBe(true);
      expect((err as VaultError).code).toBe("vault_wrong_key");
    }
  });

  test("espaço em volta da chave mestra não conta (o painel cola com espaço)", () => {
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    definirChaveMestra(`  ${CHAVE_MESTRA}  `);
    expect(openSecret(embrulho, AAD_WORKSPACE)).toBe(SEGREDO);
  });
});

// -----------------------------------------------------------------------------
// Conteúdo estragado no banco
// -----------------------------------------------------------------------------
describe("embrulho com formato inválido", () => {
  test.each([
    ["texto que não é base64", "não é base64 de jeito nenhum!!"],
    ["texto vazio", ""],
    ["curto demais pra ter iv + lacre", Buffer.alloc(20, 1).toString("base64")],
  ])("%s → vault_corrupt_payload", (_nome, ciphertext) => {
    try {
      openSecret({ ciphertext, keyVersion: CURRENT_KEY_VERSION }, AAD_WORKSPACE);
      throw new Error("deveria ter falhado");
    } catch (err) {
      expect(isVaultError(err)).toBe(true);
      expect((err as VaultError).code).toBe("vault_corrupt_payload");
    }
  });

  test("versão de receita que este build não conhece → vault_corrupt_payload", () => {
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    try {
      openSecret({ ...embrulho, keyVersion: 99 }, AAD_WORKSPACE);
      throw new Error("deveria ter falhado");
    } catch (err) {
      expect(isVaultError(err)).toBe(true);
      expect((err as VaultError).code).toBe("vault_corrupt_payload");
    }
  });
});

// -----------------------------------------------------------------------------
// Estado da chave mestra
// -----------------------------------------------------------------------------
describe("vaultStatus / assertVaultReady", () => {
  test("com chave boa: ok", () => {
    expect(vaultStatus()).toBe("ok");
    expect(isVaultReady()).toBe(true);
    expect(() => assertVaultReady()).not.toThrow();
  });

  test("sem ENCRYPTION_KEY: missing, e guardar chave falha com vault_missing_key", () => {
    definirChaveMestra(undefined);

    expect(vaultStatus()).toBe("missing");
    expect(isVaultReady()).toBe(false);
    try {
      sealSecret(SEGREDO, AAD_WORKSPACE);
      throw new Error("deveria ter falhado");
    } catch (err) {
      expect(isVaultError(err)).toBe(true);
      expect((err as VaultError).code).toBe("vault_missing_key");
      expect(isVaultKeyMissing(err)).toBe(true);
    }
  });

  test("chave curta demais: invalida pra tela, vault_bad_key pro código", () => {
    definirChaveMestra("chave-curta");

    // "invalida" e não "missing": existe alguma coisa configurada, só que não
    // serve. A tela precisa dessa diferença pra dizer o que fazer.
    expect(vaultStatus()).toBe("invalida");
    try {
      assertVaultReady();
      throw new Error("deveria ter falhado");
    } catch (err) {
      expect(isVaultError(err)).toBe(true);
      expect((err as VaultError).code).toBe("vault_bad_key");
      expect(isVaultKeyMissing(err)).toBe(true);
    }
  });

  test("frase secreta escrita por gente é RECUSADA, por mais longa que seja", () => {
    // Antes isso era aceito: 32+ caracteres passava na conferência de tamanho.
    // Só que frase de gente tem pouca variedade real, e a derivação aqui é
    // HKDF de uma passada — feita pra moer segredo sorteado, não pra resistir
    // a quem testa dicionário com uma cópia do banco na mão.
    definirChaveMestra("uma frase secreta bem comprida que passa de trinta e dois bytes");

    expect(vaultStatus()).toBe("invalida");
    expect(isVaultReady()).toBe(false);
    expect(() => sealSecret(SEGREDO, AAD_WORKSPACE)).toThrow();
  });

  test("chave sorteada de 32 bytes em base64 (a que o app gera) serve", () => {
    definirChaveMestra(randomBytes(32).toString("base64"));

    expect(vaultStatus()).toBe("ok");
    const embrulho = sealSecret(SEGREDO, AAD_WORKSPACE);
    expect(openSecret(embrulho, AAD_WORKSPACE)).toBe(SEGREDO);
  });

  test("chave temporária do container: ephemeral, e o cofre se recusa a guardar", () => {
    process.env.ENCRYPTION_KEY_EPHEMERAL = "1";

    expect(vaultStatus()).toBe("ephemeral");
    expect(isVaultReady()).toBe(false);
    try {
      sealSecret(SEGREDO, AAD_WORKSPACE);
      throw new Error("deveria ter falhado");
    } catch (err) {
      expect(isVaultError(err)).toBe(true);
      expect((err as VaultError).code).toBe("vault_ephemeral_key");
      expect(isVaultKeyMissing(err)).toBe(true);
    }
  });

  test("ENCRYPTION_KEY_EPHEMERAL=0 não marca como temporária", () => {
    process.env.ENCRYPTION_KEY_EPHEMERAL = "0";
    expect(vaultStatus()).toBe("ok");
  });

  test("a chave mestra é relida a cada chamada (o painel pode mudar)", () => {
    expect(vaultStatus()).toBe("ok");
    definirChaveMestra(undefined);
    expect(vaultStatus()).toBe("missing");
    definirChaveMestra(CHAVE_MESTRA);
    expect(vaultStatus()).toBe("ok");
  });
});

// -----------------------------------------------------------------------------
// Mensagens que a pessoa lê
// -----------------------------------------------------------------------------
describe("VaultError", () => {
  test("a mensagem técnica não é a mensagem da tela", () => {
    const err = new VaultError("vault_wrong_key", "AES-GCM authentication failed");
    expect(err.message).toBe("AES-GCM authentication failed");
    expect(err.message).not.toBe(vaultErrorMessage(err.code));
    expect(err.name).toBe("VaultError");
  });

  test.each([
    "vault_missing_key",
    "vault_ephemeral_key",
    "vault_bad_key",
    "vault_corrupt_payload",
    "vault_wrong_key",
  ] as const)("%s tem mensagem em português, sem jargão de banco", (code) => {
    const msg = vaultErrorMessage(code);
    expect(msg.length).toBeGreaterThan(20);
    expect(msg).not.toMatch(/AES|GCM|HKDF|base64|postgres|PGRST|42501/i);
  });

  test("isVaultKeyMissing separa 'falta configurar' de 'deu ruim'", () => {
    expect(isVaultKeyMissing(new VaultError("vault_missing_key"))).toBe(true);
    expect(isVaultKeyMissing(new VaultError("vault_ephemeral_key"))).toBe(true);
    expect(isVaultKeyMissing(new VaultError("vault_bad_key"))).toBe(true);
    expect(isVaultKeyMissing(new VaultError("vault_wrong_key"))).toBe(false);
    expect(isVaultKeyMissing(new VaultError("vault_corrupt_payload"))).toBe(false);
    expect(isVaultKeyMissing(new Error("outro erro qualquer"))).toBe(false);
    expect(isVaultKeyMissing(null)).toBe(false);
  });
});
