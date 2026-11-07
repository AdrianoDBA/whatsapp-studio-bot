/**
 * "Qual chave eu uso agora?" — o que `lib/ai` e `lib/email` consomem.
 *
 * A ORDEM É SEMPRE ESSA, E NÃO MUDA:
 *
 *     1. chave do workspace   (o time cadastrou a dele)
 *     2. chave da plataforma  (o dono do app cadastrou uma que vale pra todos)
 *     3. variável de ambiente (compatibilidade com quem já tinha deploy no ar)
 *
 * Os degraus 1 e 2 são decididos DENTRO do banco, pela função
 * `resolve_credential`. O degrau 3 é decidido aqui.
 *
 * ⚠️ O QUE SAI DAQUI TEM A CHAVE EM TEXTO PURO. Nunca devolva um
 * `ResolvedCredential` de uma função do servidor pra tela, nem coloque num
 * `console.log`. Ele existe pra ser entregue ao SDK do provedor e morrer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anthropicApiKey,
  emailFrom,
  googleApiKey,
  openaiApiKey,
  openrouterApiKey,
  resendApiKey,
} from "@/lib/env";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";
import { openSecret } from "./crypto";
import { getProviderInfo } from "./providers";
import type { CredentialProvider, CredentialSource, ResolvedCredential } from "./types";
import { readMetadata } from "./types";

export type { ResolvedCredential } from "./types";

/** O terceiro degrau da escada. Ver o aviso em `lib/env.ts`. */
function chaveDeAmbiente(provider: CredentialProvider): string | undefined {
  switch (provider) {
    case "openrouter":
      return openrouterApiKey();
    case "anthropic":
      return anthropicApiKey();
    case "openai":
      return openaiApiKey();
    case "google":
      return googleApiKey();
    case "resend":
      return resendApiKey();
  }
}

/**
 * Acha a chave que vale pra esse escopo e ABRE o embrulho.
 *
 * Devolve null quando não existe chave em lugar nenhum — quem traduz esse
 * "null" pra uma frase que o aluno entende é `lib/ai` (com `AiConfigError`) ou
 * o `requireApiKey()` aqui embaixo.
 *
 * ⚠️ O `supabase` É OBRIGATÓRIO (não opcional), e quem chama tem que passar.
 * Antes esta função chamava `createClient()` (o cliente de COOKIE) lá dentro.
 * Numa execução agendada não existe cookie: o cliente sairia anônimo e
 * `resolve_credential` responderia "not authenticated" — ou seja, TODA
 * automação falharia com "Não deu pra buscar a chave desse provedor agora".
 *
 * Deixar `supabase?` opcional só trocaria a falha barulhenta por uma
 * silenciosa: quem esquecesse cairia no cliente errado. Obrigatório = o `tsc`
 * aponta os dois lugares que chamam e acabou.
 *
 * ⚠️ LANÇA VaultError quando EXISTE cifra no banco mas ela não abre. Isso é
 * barulhento de propósito: se a gente caísse calado na variável de ambiente,
 * o problema "alguém trocou a ENCRYPTION_KEY e as chaves cadastradas viraram
 * lixo" apareceria pro aluno como "a IA respondeu usando a conta errada" —
 * que é impossível de diagnosticar.
 */
export async function resolveApiKey(
  provider: CredentialProvider,
  opts: { organizationId: string | null; supabase: SupabaseClient<Database> },
): Promise<ResolvedCredential | null> {
  const { data, error } = await opts.supabase.rpc("resolve_credential", {
    _organization_id: opts.organizationId ?? undefined,
    _provider: provider,
  });

  if (error) {
    logError("secrets.resolveApiKey", error);
    throw new Error("Não deu pra buscar a chave desse provedor agora. Tente de novo.");
  }

  const linha = (data ?? [])[0];

  if (linha) {
    // "workspace" ou "platform" — quem decidiu foi o banco, respeitando a
    // ordem de prioridade.
    const source: CredentialSource = linha.source === "workspace" ? "workspace" : "platform";

    // O escopo do AAD é o da LINHA, não o de quem pediu: a chave da plataforma
    // foi trancada com organizationId nulo, e é assim que ela abre — mesmo
    // quando quem está pedindo é um workspace.
    const apiKey = openSecret(
      { ciphertext: linha.ciphertext, keyVersion: linha.key_version },
      {
        organizationId: source === "workspace" ? opts.organizationId : null,
        provider,
      },
    );

    return {
      provider,
      apiKey,
      source,
      credentialId: linha.credential_id,
      keyVersion: linha.key_version,
      metadata: readMetadata(linha.metadata),
    };
  }

  const doAmbiente = chaveDeAmbiente(provider);
  if (doAmbiente) {
    return {
      provider,
      apiKey: doAmbiente,
      source: "env",
      credentialId: null,
      keyVersion: null,
      metadata: {},
    };
  }

  return null;
}

/** Igual acima, mas explica em PT-BR o que falta em vez de devolver null. */
export async function requireApiKey(
  provider: CredentialProvider,
  opts: { organizationId: string | null; supabase: SupabaseClient<Database> },
): Promise<ResolvedCredential> {
  const achada = await resolveApiKey(provider, opts);
  if (achada) return achada;

  const info = getProviderInfo(provider);
  throw new Error(
    `Falta cadastrar a chave do ${info.label}. Abra Configurações → Integrações e cole a ` +
      `chave (${info.keyHint.toLowerCase()}). Se você não tiver uma, pegue em ${info.helpUrl}.`,
  );
}

/**
 * Atalho pro envio de email: a chave do Resend mais o remetente.
 *
 * O remetente sai de `metadata.from` (foi digitado na tela junto com a chave).
 * Quando ele não foi preenchido, cai na variável EMAIL_FROM — que tem um valor
 * padrão, então essa função nunca devolve remetente vazio.
 */
export async function resolveEmailSender(opts: {
  organizationId: string | null;
  supabase: SupabaseClient<Database>;
}): Promise<{ apiKey: string; from: string } | null> {
  const cred = await resolveApiKey("resend", opts);
  if (!cred) return null;

  const daTela = cred.metadata.from?.trim();
  return { apiKey: cred.apiKey, from: daTela && daTela !== "" ? daTela : emailFrom() };
}
