/**
 * Leituras do cofre — o que a TELA pode ver.
 *
 * ⚠️ REGRA DA PASTA, VALE PRA SEMPRE: NUNCA use `select("*")` na tabela
 * `credentials`. A permissão de leitura foi dada coluna a coluna, e a coluna
 * `ciphertext` ficou de fora de propósito. `select("*")` pede TODAS as colunas
 * e o banco responde "permission denied for column ciphertext" (código 42501).
 * Isso não é bug: é a rede de segurança que impede alguém de, sem querer,
 * mandar o embrulho da chave pra tela.
 *
 * Consequência prática: COLUNA NOVA em `credentials` nasce invisível. Pra ela
 * aparecer, é preciso (1) acrescentar o nome dela no `grant select (...)` da
 * migration e (2) acrescentar na constante COLUNAS aqui embaixo.
 *
 * Nada que sai daqui carrega segredo: a chave aparece só mascarada, e o
 * mascaramento acontece NESTE processo, no servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anthropicApiKey,
  googleApiKey,
  openaiApiKey,
  openrouterApiKey,
  resendApiKey,
} from "@/lib/env";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";
import { maskCredential } from "./mask";
import { CREDENTIAL_PROVIDERS } from "./providers";
import type {
  CredentialProvider,
  CredentialScope,
  CredentialSource,
  CredentialSummary,
} from "./types";
import { readMetadata } from "./types";

export type { CredentialSummary } from "./types";

/** Lista explícita de colunas. Ver o aviso do topo antes de mexer. */
const COLUNAS =
  "id, organization_id, provider, label, key_version, key_prefix, last4, metadata, created_by, created_at, updated_at";

/** Exatamente as colunas de COLUNAS — o resto da linha nem chega aqui. */
type LinhaCredencial = Pick<
  Database["public"]["Tables"]["credentials"]["Row"],
  | "id"
  | "organization_id"
  | "provider"
  | "label"
  | "key_version"
  | "key_prefix"
  | "last4"
  | "metadata"
  | "created_by"
  | "created_at"
  | "updated_at"
>;

function paraResumo(linha: LinhaCredencial): CredentialSummary {
  return {
    id: linha.id,
    scope: linha.organization_id === null ? "platform" : "workspace",
    organizationId: linha.organization_id,
    provider: linha.provider,
    label: linha.label,
    // Mascarado NO SERVIDOR, a partir de dois pedaços não-secretos que já
    // estavam guardados. Não precisa (e não pode) abrir o embrulho pra isso.
    masked: maskCredential({ prefix: linha.key_prefix, last4: linha.last4 }),
    keyVersion: linha.key_version,
    metadata: readMetadata(linha.metadata),
    createdBy: linha.created_by,
    createdAt: linha.created_at,
    updatedAt: linha.updated_at,
  };
}

/** Todas as chaves cadastradas nesse escopo, já mascaradas. */
export async function listCredentials(scope: CredentialScope): Promise<CredentialSummary[]> {
  const supabase = await createClient();
  const consulta = supabase.from("credentials").select(COLUNAS);

  const { data, error } =
    scope.kind === "platform"
      ? await consulta.is("organization_id", null).order("provider")
      : await consulta.eq("organization_id", scope.organizationId).order("provider");

  if (error) {
    logError("secrets.listCredentials", error);
    throw new Error("Não deu pra carregar as chaves agora. Atualize a página.");
  }

  return (data ?? []).map(paraResumo);
}

/** A chave daquele provedor naquele escopo (mascarada), ou null. */
export async function getCredential(
  scope: CredentialScope,
  provider: CredentialProvider,
): Promise<CredentialSummary | null> {
  const supabase = await createClient();
  const consulta = supabase.from("credentials").select(COLUNAS).eq("provider", provider);

  const { data, error } =
    scope.kind === "platform"
      ? await consulta.is("organization_id", null).maybeSingle()
      : await consulta.eq("organization_id", scope.organizationId).maybeSingle();

  if (error) {
    logError("secrets.getCredential", error);
    throw new Error("Não deu pra carregar a chave agora. Atualize a página.");
  }

  return data ? paraResumo(data) : null;
}

/** Quais provedores têm chave em variável de ambiente (o último recurso). */
function chavesDeAmbiente(): Record<CredentialProvider, boolean> {
  return {
    openrouter: Boolean(openrouterApiKey()),
    anthropic: Boolean(anthropicApiKey()),
    openai: Boolean(openaiApiKey()),
    google: Boolean(googleApiKey()),
    resend: Boolean(resendApiKey()),
  };
}

/**
 * Diz, por provedor, DE ONDE a chave sairia hoje — sem devolver segredo
 * nenhum e sem abrir embrulho nenhum.
 *
 * `organizationId` null = ponto de vista da plataforma.
 * `null` no valor = não tem chave em lugar nenhum pra esse provedor.
 *
 * ⚠️ O `supabase` é OBRIGATÓRIO (não opcional). Ver a justificativa completa em
 * `lib/secrets/resolve.ts`: numa execução agendada não existe cookie, e um
 * `createClient()` escondido aqui dentro sairia anônimo.
 *
 * UMA chamada cobre os cinco provedores de uma vez (a tela tem cinco cartões;
 * cinco consultas separadas seria desperdício).
 *
 * Funciona pro dono/admin de workspace mesmo sem ele poder LER a chave da
 * plataforma: por baixo usa a função `credential_status` do banco, que roda
 * com os poderes do dono e responde só "de onde viria", nunca "qual é".
 */
export async function getCredentialSources(
  organizationId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<Record<CredentialProvider, CredentialSource | null>> {
  const ambiente = chavesDeAmbiente();

  // Começa pelo último degrau da escada (variável de ambiente). O banco
  // sobrescreve em seguida, porque workspace e plataforma ganham dele.
  const saida: Record<CredentialProvider, CredentialSource | null> = {
    openrouter: null,
    anthropic: null,
    openai: null,
    google: null,
    resend: null,
  };
  for (const p of CREDENTIAL_PROVIDERS) {
    if (ambiente[p.id]) saida[p.id] = "env";
  }

  const { data, error } = await supabase.rpc("credential_status", {
    _organization_id: organizationId ?? undefined,
  });

  if (error) {
    logError("secrets.getCredentialSources", error);
    throw new Error("Não deu pra ver o estado das chaves agora. Atualize a página.");
  }

  for (const linha of data ?? []) {
    saida[linha.provider] = linha.source === "workspace" ? "workspace" : "platform";
  }

  return saida;
}
