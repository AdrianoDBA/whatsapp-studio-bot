/**
 * A criptografia do cofre: AES-256-GCM + HKDF-SHA256.
 *
 * Este arquivo é PURO: não fala com o banco, não é "use server", não lê
 * cookie. Só embrulha e desembrulha texto. Por isso ele é testável de verdade
 * (ver `tests/secrets-crypto.test.ts`).
 *
 * COMO O EMBRULHO FUNCIONA, EM PORTUGUÊS
 * --------------------------------------
 * 1. A chave mestra (a variável ENCRYPTION_KEY) NUNCA é usada direto. Ela
 *    passa por uma "moagem" (HKDF-SHA256) que sempre devolve 32 bytes, não
 *    importa o tamanho do que você colou no painel.
 * 2. Cada chave guardada leva um `iv` sorteado na hora — 12 bytes aleatórios.
 *    É por isso que guardar a MESMA chave duas vezes gera dois embrulhos
 *    completamente diferentes. Se não fosse assim, dava pra descobrir que dois
 *    workspaces usam a mesma chave só olhando o banco.
 * 3. O AES-GCM gera também uma "etiqueta de lacre" (tag) de 16 bytes. Se
 *    alguém mexer num único caractere do embrulho, a etiqueta não bate e o
 *    desembrulho FALHA — não devolve lixo, falha. É essa garantia que faz o
 *    cofre valer alguma coisa.
 * 4. O escopo (workspace ou plataforma) e o provedor vão junto como "dado
 *    autenticado" (AAD). Eles não são secretos, mas ficam AMARRADOS ao
 *    embrulho: copiar a cifra da plataforma pra dentro da linha de um
 *    workspace não abre.
 *
 * FORMATO GRAVADO: base64 de  iv(12 bytes) || tag(16 bytes) || dados
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { encryptionKeyIsEphemeral, encryptionKeyOrNull } from "@/lib/env";
import type { CredentialProvider, VaultStatus } from "./types";
import { VaultError } from "./types";

/** Versão da derivação em uso hoje. Vai gravada em credentials.key_version. */
export const CURRENT_KEY_VERSION = 1;

/**
 * Dado autenticado junto com a cifra (AAD). Amarra a cifra ao escopo e ao
 * provedor: uma cifra copiada pra outra linha simplesmente não abre.
 * organizationId null = credencial da plataforma.
 */
export type SecretAad = {
  organizationId: string | null;
  provider: CredentialProvider;
};

/** base64 de iv(12) || tag(16) || dados. */
export type SealedSecret = { ciphertext: string; keyVersion: number };

const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Abaixo disso a chave mestra não protege nada — 32 bytes = 256 bits. */
const MIN_KEY_MATERIAL_BYTES = 32;
/** Sal fixo da derivação. Trocar isso invalida TODAS as chaves guardadas. */
const HKDF_SALT = "credentials-v1";
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Transforma o texto que veio do painel em bytes. `null` = não serve.
 *
 * SÓ aceita o que o container gera: 32 bytes sorteados, escritos em base64.
 *
 * POR QUE NÃO ACEITA FRASE SECRETA
 * Antes aceitava, e aí "a senha do meu aplicativo 2026!!" (32 caracteres)
 * passava na conferência de tamanho. Só que frase escrita por gente tem pouca
 * variedade real, e a derivação aqui é HKDF de uma passada — feita pra moer
 * segredo sorteado, não pra resistir a alguém testando palavras. Com uma frase
 * dessas, quem levasse uma cópia do banco quebraria o cofre inteiro no
 * computador dele, testando dicionário.
 *
 * Frase secreta exigiria uma derivação lenta de propósito (scrypt/argon2), com
 * outros problemas. Como o container JÁ entrega uma chave pronta, o caminho
 * simples é aceitar só ela.
 */
function keyMaterial(raw: string): Buffer | null {
  const limpo = raw.trim();
  if (!BASE64_RE.test(limpo)) return null;
  const decodificado = Buffer.from(limpo, "base64");
  if (decodificado.length < MIN_KEY_MATERIAL_BYTES) return null;
  return decodificado;
}

/**
 * Moe a chave mestra até virar exatamente 32 bytes (HKDF-SHA256).
 *
 * A versão entra na receita: no dia em que a criptografia mudar, a versão 2
 * gera uma chave derivada DIFERENTE, e os embrulhos antigos continuam abrindo
 * com a versão 1 que está gravada na linha do banco.
 */
function deriveKey(material: Buffer, keyVersion: number): Buffer {
  return Buffer.from(hkdfSync("sha256", material, HKDF_SALT, `credentials-key-v${keyVersion}`, 32));
}

/** O escopo + provedor viram bytes pra entrar como dado autenticado. */
function aadBytes(aad: SecretAad): Buffer {
  return Buffer.from(`${aad.organizationId ?? "platform"}|${aad.provider}`, "utf8");
}

/**
 * Estado da chave mestra. Lê ENCRYPTION_KEY TODA VEZ (sem guardar em memória):
 * o aluno pode colar a chave no painel e reiniciar, e a resposta tem que mudar.
 *
 * Repare que chave curta demais também responde "missing": pra tela, "não dá
 * pra usar" é uma coisa só. Quem precisa do motivo exato usa
 * `assertVaultReady()`, que joga o erro com o código certo.
 */
export function vaultStatus(): VaultStatus {
  const raw = encryptionKeyOrNull();
  if (!raw) return "missing";
  if (keyMaterial(raw) === null) return "invalida";
  if (encryptionKeyIsEphemeral()) return "ephemeral";
  return "ok";
}

/** Atalho pra tela: true só quando vaultStatus() === "ok". */
export function isVaultReady(): boolean {
  return vaultStatus() === "ok";
}

/** Lança VaultError quando vaultStatus() !== "ok". */
export function assertVaultReady(): void {
  const raw = encryptionKeyOrNull();
  if (!raw) {
    throw new VaultError("vault_missing_key", "ENCRYPTION_KEY is not set");
  }
  if (keyMaterial(raw) === null) {
    throw new VaultError(
      "vault_bad_key",
      `ENCRYPTION_KEY must be ${MIN_KEY_MATERIAL_BYTES} random bytes in base64`,
    );
  }
  if (encryptionKeyIsEphemeral()) {
    throw new VaultError("vault_ephemeral_key", "ENCRYPTION_KEY was generated at container boot");
  }
}

/** A chave mestra já moída, ou VaultError explicando o que falta configurar. */
function requireDerivedKey(keyVersion: number): Buffer {
  assertVaultReady();
  const raw = encryptionKeyOrNull();
  if (!raw) {
    // Inalcançável: assertVaultReady() já teria jogado. Está aqui pro
    // TypeScript não precisar de "as string" (regra 18 do CLAUDE.md).
    throw new VaultError("vault_missing_key", "ENCRYPTION_KEY disappeared mid-call");
  }
  const material = keyMaterial(raw);
  if (material === null) {
    // Inalcançável: assertVaultReady() já teria jogado.
    throw new VaultError("vault_bad_key", "ENCRYPTION_KEY is not a valid base64 key");
  }
  return deriveKey(material, keyVersion);
}

/** Embrulha um segredo. O resultado é o que vai pra coluna `ciphertext`. */
export function sealSecret(plaintext: string, aad: SecretAad): SealedSecret {
  const key = requireDerivedKey(CURRENT_KEY_VERSION);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadBytes(aad));
  const dados = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, dados]).toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Desembrulha. Falha barulhenta de propósito:
 *
 * - formato estragado         → VaultError("vault_corrupt_payload")
 * - versão que não conhecemos → VaultError("vault_corrupt_payload")
 * - lacre não bate            → VaultError("vault_wrong_key")
 *
 * O último caso cobre as duas situações que, por fora, são indistinguíveis: a
 * ENCRYPTION_KEY foi trocada, OU alguém mexeu no conteúdo gravado. O AES-GCM
 * não sabe diferenciar — e é exatamente por isso que ele serve: nos dois casos
 * a resposta é "não abre", nunca "abre com o valor errado".
 */
export function openSecret(sealed: SealedSecret, aad: SecretAad): string {
  if (sealed.keyVersion !== CURRENT_KEY_VERSION) {
    throw new VaultError(
      "vault_corrupt_payload",
      `unknown key_version ${sealed.keyVersion} (this build understands ${CURRENT_KEY_VERSION})`,
    );
  }

  const limpo = sealed.ciphertext.trim();
  if (limpo === "" || !BASE64_RE.test(limpo)) {
    throw new VaultError("vault_corrupt_payload", "ciphertext is not base64");
  }

  const bruto = Buffer.from(limpo, "base64");
  if (bruto.length < IV_BYTES + TAG_BYTES) {
    throw new VaultError(
      "vault_corrupt_payload",
      `ciphertext has ${bruto.length} bytes, needs at least ${IV_BYTES + TAG_BYTES}`,
    );
  }

  const key = requireDerivedKey(sealed.keyVersion);
  const iv = bruto.subarray(0, IV_BYTES);
  const tag = bruto.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const dados = bruto.subarray(IV_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(aadBytes(aad));
    return Buffer.concat([decipher.update(dados), decipher.final()]).toString("utf8");
  } catch {
    // Não repassamos o erro do node:crypto: ele não acrescenta nada, e o que
    // interessa (o lacre não bateu) já está dito no código do VaultError.
    throw new VaultError(
      "vault_wrong_key",
      "AES-GCM authentication failed (wrong master key, wrong scope/provider, or tampered payload)",
    );
  }
}
