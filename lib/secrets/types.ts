/**
 * Tipos e erros do cofre de chaves.
 *
 * ESTE ARQUIVO É A CASA DOS TIPOS DO COFRE. Os outros arquivos da pasta
 * reexportam daqui — ninguém redeclara. Já aconteceu de o mesmo tipo existir em
 * dois lugares com formatos diferentes, e o código que importava do lugar
 * errado quebrava só em produção.
 */
import type { Database, Json } from "@/types/supabase";

/** "openrouter" | "anthropic" | "openai" | "google" | "resend" */
export type CredentialProvider = Database["public"]["Enums"]["credential_provider"];

/**
 * De onde a chave saiu. ESTA É A ÚNICA DEFINIÇÃO NO PROJETO —
 * `lib/ai` reexporta daqui, não redeclara.
 *
 * - "workspace" = cadastrada pelo dono/admin daquele time
 * - "platform"  = cadastrada pelo dono da plataforma, vale pra todo mundo
 * - "env"       = variável de ambiente (compatibilidade com quem já tem
 *                 deploy no ar antes do cofre existir)
 */
export type CredentialSource = "workspace" | "platform" | "env";

/** Em qual dos dois níveis a gente está mexendo. */
export type CredentialScope = { kind: "platform" } | { kind: "workspace"; organizationId: string };

/**
 * Estado da chave mestra do cofre (a variável ENCRYPTION_KEY).
 *
 * - "ok"        = dá pra guardar e abrir chave
 * - "missing"   = não existe, ou é curta demais pra proteger alguma coisa
 * - "ephemeral" = o container gerou uma temporária no boot e imprimiu no log;
 *                 ela some no próximo reinício, então o cofre se recusa a usar
 */
export type VaultStatus = "ok" | "missing" | "ephemeral" | "invalida";

export type VaultErrorCode =
  /** ENCRYPTION_KEY não existe */
  | "vault_missing_key"
  /** o container gerou uma temporária; falta colar no painel */
  | "vault_ephemeral_key"
  /** existe, mas não é uma chave sorteada de 32 bytes em base64 */
  | "vault_bad_key"
  /** o que está no banco não tem o formato esperado */
  | "vault_corrupt_payload"
  /** não abre: a chave mestra mudou depois de salvar (ou mexeram na cifra) */
  | "vault_wrong_key";

/**
 * Erro do cofre.
 *
 * `message` é TÉCNICO e só serve pro logError(). O texto que a pessoa lê sai
 * de `vaultErrorMessage(err.code)`. Separar os dois deixa a regra 6 do
 * CLAUDE.md (nunca devolver mensagem técnica pra tela) difícil de violar por
 * descuido.
 */
export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, detalheTecnico?: string) {
    super(detalheTecnico ?? code);
    this.name = "VaultError";
    this.code = code;
  }
}

export function isVaultError(err: unknown): err is VaultError {
  return err instanceof VaultError;
}

/** true quando o problema é "falta configurar a chave mestra", não "deu ruim". */
export function isVaultKeyMissing(err: unknown): boolean {
  if (!isVaultError(err)) return false;
  return (
    err.code === "vault_missing_key" ||
    err.code === "vault_ephemeral_key" ||
    err.code === "vault_bad_key"
  );
}

const MENSAGENS: Record<VaultErrorCode, string> = {
  vault_missing_key:
    "A chave de segurança do sistema ainda não foi configurada. Abra o registro (log) do app: " +
    "ele já imprimiu uma chave pronta pra você colar no painel, no campo ENCRYPTION_KEY. " +
    "Depois de colar, clique em Deploy e tente de novo.",
  vault_ephemeral_key:
    "O app subiu com uma chave de segurança temporária, que some quando ele reinicia. " +
    "Copie a chave que apareceu no registro (log) do app e cole no painel, no campo " +
    "ENCRYPTION_KEY. Depois clique em Deploy e tente de novo.",
  vault_bad_key:
    "A chave de segurança do sistema (ENCRYPTION_KEY) é curta demais pra proteger suas chaves. " +
    "Gere uma nova com pelo menos 32 caracteres, cole no painel e clique em Deploy.",
  vault_corrupt_payload:
    "A chave que estava guardada aqui está com o conteúdo estragado e não dá pra abrir. " +
    "Cadastre a chave desse provedor de novo.",
  vault_wrong_key:
    "A chave guardada aqui foi trancada com outra ENCRYPTION_KEY e não abre mais. " +
    "Isso acontece quando alguém troca a ENCRYPTION_KEY do painel. " +
    "Cadastre a chave desse provedor de novo.",
};

/** Mensagem em PT-BR coloquial, pronta pra jogar num ActionResult. */
export function vaultErrorMessage(code: VaultErrorCode): string {
  return MENSAGENS[code];
}

// -----------------------------------------------------------------------------
// Tipos que os outros arquivos da pasta reexportam
// -----------------------------------------------------------------------------

/** Descrição de um provedor pra tela. Ver `providers.ts`. */
export type CredentialProviderInfo = {
  id: CredentialProvider;
  /** "OpenRouter" */
  label: string;
  /** PT-BR leigo: o que essa chave faz. */
  description: string;
  /** Página onde o aluno pega a chave. */
  helpUrl: string;
  /** "Começa com sk-or-" */
  keyHint: string;
  /**
   * O começo da chave, pra CONFERIR o que foi colado — não é enfeite.
   *
   * A tela sempre disse "Começa com sk-or-", mas nada checava: dava pra colar
   * `chave-errada-123` no campo do OpenRouter e receber o selo verde
   * "cadastrada". O erro só aparecia muito depois, na primeira conversa, com
   * uma mensagem do provedor que não ajuda ninguém.
   */
  keyPrefix: string;
  /** true só pro resend — o cartão ganha o campo "Remetente dos emails". */
  hasSenderField: boolean;
  /** false pro resend: a tela do workspace só mostra provedor de IA. */
  isAiProvider: boolean;
};

/**
 * O que a TELA recebe. Repare no que não existe aqui: nenhum campo com a chave
 * inteira. `masked` já vem pronto do servidor. Ver `queries.ts`.
 */
export type CredentialSummary = {
  id: string;
  scope: "workspace" | "platform";
  organizationId: string | null;
  provider: CredentialProvider;
  label: string;
  /** Já mascarado NO SERVIDOR. Ex.: "sk-ant-…4f2a". */
  masked: string;
  keyVersion: number;
  /** Config não-secreta. Hoje só { from } do Resend. */
  metadata: Record<string, string>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * O que quem vai USAR a chave recebe. Só existe na memória do servidor —
 * NUNCA devolva isso de uma função do servidor pra tela. Ver `resolve.ts`.
 */
export type ResolvedCredential = {
  provider: CredentialProvider;
  /** já decifrada */
  apiKey: string;
  source: CredentialSource;
  /** null quando veio de variável de ambiente */
  credentialId: string | null;
  keyVersion: number | null;
  metadata: Record<string, string>;
};

/**
 * A coluna `metadata` do banco é jsonb — pro TypeScript, qualquer coisa.
 * Aqui ela vira um objeto de texto pra texto, jogando fora o que não for
 * texto. É o único formato que o app usa (hoje: `{ from }` do Resend), e
 * assim nenhum consumidor precisa lidar com `any` nem com surpresa.
 *
 * Não é exportado pelo `index.ts` de propósito: é detalhe de dentro da pasta.
 */
export function readMetadata(value: Json | null | undefined): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) return {};

  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(value)) {
    if (typeof valor === "string") saida[chave] = valor;
  }
  return saida;
}
