/**
 * Guardar e apagar chave no cofre.
 *
 * Roda no servidor, mas NÃO é "use server": quem expõe isso pra tela são as
 * funções do servidor de `lib/secrets/actions.ts`, e é lá que mora o guard de
 * permissão. Este arquivo só sabe embrulhar e conversar com o banco.
 *
 * A CHAVE EM TEXTO PURO SÓ EXISTE DENTRO DESTE ARQUIVO, em memória, por alguns
 * milissegundos. Ela é embrulhada antes de qualquer coisa ir pro banco — a
 * função `save_credential` do Postgres nunca vê o valor original.
 */
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { sealSecret } from "./crypto";
import { fingerprintSecret, maskCredential } from "./mask";
import type { CredentialProvider, CredentialScope } from "./types";
import { VaultError } from "./types";

export type SaveCredentialParams = {
  scope: CredentialScope;
  provider: CredentialProvider;
  /** rótulo humano ("Chave do time de vendas"). NÃO é o remetente do Resend. */
  label: string;
  /** a chave em si; só existe na memória do servidor */
  secret: string;
  /** config NÃO secreta do provedor. Resend: { from: "Meu App <noreply@…>" } */
  metadata?: Record<string, string>;
};

/** `null` aqui quer dizer "é a chave da plataforma". */
function orgIdDoEscopo(scope: CredentialScope): string | null {
  return scope.kind === "workspace" ? scope.organizationId : null;
}

/**
 * Embrulha a chave e manda pro banco pela função `save_credential`.
 *
 * Já existe chave desse provedor nesse escopo? O banco substitui. Não existe?
 * Cria. Devolve o id e a versão mascarada, pra tela poder mostrar
 * "sk-ant-…4f2a" sem nunca ter recebido a chave inteira.
 */
export async function saveCredential(
  p: SaveCredentialParams,
): Promise<{ id: string; masked: string }> {
  const segredo = p.secret.trim();
  if (segredo === "") {
    throw new VaultError("vault_corrupt_payload", "secret is empty");
  }

  const organizationId = orgIdDoEscopo(p.scope);
  // Embrulha ANTES de falar com o banco. Se a chave mestra não estiver
  // configurada, isso joga VaultError aqui e nada é gravado.
  const sealed = sealSecret(segredo, { organizationId, provider: p.provider });
  const fp = fingerprintSecret(segredo);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_credential", {
    _provider: p.provider,
    _ciphertext: sealed.ciphertext,
    _key_version: sealed.keyVersion,
    _key_prefix: fp.prefix,
    _last4: fp.last4,
    _label: p.label,
    _metadata: p.metadata ?? {},
    _organization_id: organizationId ?? undefined,
  });

  if (error) {
    logError("secrets.saveCredential", error);
    throw new Error("Não deu pra guardar a chave agora. Tente de novo.");
  }
  if (!data) {
    logError("secrets.saveCredential", { message: "save_credential returned no id" });
    throw new Error("Não deu pra guardar a chave agora. Tente de novo.");
  }

  return { id: data, masked: maskCredential(fp) };
}

/**
 * Apaga a chave daquele escopo.
 *
 * ⚠️ Pro workspace, apagar É "voltar a usar a chave da plataforma": não existe
 * um terceiro estado. Quem chama tem que ter confirmado com a pessoa antes,
 * porque o segredo some de verdade.
 *
 * Quem pode apagar é decidido pela regra de segurança do banco (a policy
 * "managers delete credentials"), não por um `if` aqui.
 */
export async function deleteCredential(
  scope: CredentialScope,
  provider: CredentialProvider,
): Promise<void> {
  const organizationId = orgIdDoEscopo(scope);
  const supabase = await createClient();

  const filtro = supabase.from("credentials").delete().eq("provider", provider);
  const { error } =
    organizationId === null
      ? await filtro.is("organization_id", null)
      : await filtro.eq("organization_id", organizationId);

  if (error) {
    logError("secrets.deleteCredential", error);
    throw new Error("Não deu pra apagar a chave agora. Tente de novo.");
  }
}
