/**
 * A porta de entrada do cofre.
 *
 * Outras pastas (`lib/ai`, `lib/email`, as telas de configuração) importam
 * daqui: `import { resolveApiKey } from "@/lib/secrets"`. Assim a gente
 * consegue mexer por dentro sem sair caçando import por todo o projeto.
 *
 * ⚠️ ESTE ARQUIVO PUXA CÓDIGO DE SERVIDOR (queries, vault e resolve falam com
 * o banco usando o cookie da sessão). Não importe ele de um componente com
 * "use client" — o build quebra. Numa tela, importe só o que é puro:
 * `@/lib/secrets/providers`, `@/lib/secrets/mask`.
 *
 * `sealSecret` e `openSecret` NÃO são exportados aqui de propósito: quem cifra
 * é o cofre. Se alguma tela precisar embrulhar alguma coisa sozinha, é sinal
 * de que a regra de negócio está no lugar errado.
 */

export { assertVaultReady, CURRENT_KEY_VERSION, isVaultReady, vaultStatus } from "./crypto";
export type { SecretFingerprint } from "./mask";
export { fingerprintSecret, maskCredential } from "./mask";
export { CREDENTIAL_PROVIDERS, getProviderInfo, listAiProviders } from "./providers";
export { getCredential, getCredentialSources, listCredentials } from "./queries";
export { requireApiKey, resolveApiKey, resolveEmailSender } from "./resolve";
export type {
  CredentialProvider,
  CredentialProviderInfo,
  CredentialScope,
  CredentialSource,
  CredentialSummary,
  ResolvedCredential,
  VaultErrorCode,
  VaultStatus,
} from "./types";
export { isVaultError, isVaultKeyMissing, VaultError, vaultErrorMessage } from "./types";
export type { SaveCredentialParams } from "./vault";
export { deleteCredential, saveCredential } from "./vault";
