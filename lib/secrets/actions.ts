"use server";

/**
 * As quatro funções do servidor das telas de chave.
 *
 * SÃO QUATRO, E NÃO DUAS COM UM CAMPO "escopo".
 * O guard de permissão é diferente por escopo: chave da plataforma é do dono
 * do sistema, chave de workspace é de quem manda naquele time. Uma função só,
 * escolhendo o guard num `if`, é exatamente a forma que erra o guard. Quatro
 * funções = quatro guards escritos na cara, impossível de trocar por engano.
 *
 * ⚠️ TODA FUNÇÃO AQUI CHAMA O GUARD DENTRO DELA MESMA.
 * Função marcada com "use server" é um endereço público da internet: dá pra
 * chamar sem passar pela tela. Confiar em "a página só mostra o botão pra
 * quem pode" não protege nada.
 *
 * ⚠️ A CHAVE NUNCA VOLTA PRA TELA.
 * O que sai daqui é `masked` ("sk-ant-…4f2a"), montado no servidor a partir de
 * dois pedaços não-secretos. A chave inteira só existe na memória do servidor,
 * por alguns milissegundos, dentro de `lib/secrets/vault.ts`.
 */
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { assertPlatformAdmin, requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { getProviderInfo } from "./providers";
import {
  type RemoveOrgCredentialInput,
  type RemovePlatformCredentialInput,
  removeOrgCredentialSchema,
  removePlatformCredentialSchema,
  type SaveOrgCredentialInput,
  type SavePlatformCredentialInput,
  saveOrgCredentialSchema,
  savePlatformCredentialSchema,
} from "./schemas";
import { isVaultError, vaultErrorMessage } from "./types";
import { deleteCredential, saveCredential } from "./vault";

/** Quem não é dono da plataforma vê sempre este texto, nunca um detalhe. */
const SO_O_DONO = "Só o dono do sistema pode mexer nas chaves da plataforma.";

/**
 * Traduz qualquer coisa que deu errado numa frase que o aluno consegue agir.
 *
 * Repare no que NÃO acontece aqui: `error.message` do Postgres nunca chega na
 * tela. Ele vai pro registro (log) do servidor pelo `logError`, e a pessoa
 * recebe uma frase que diz o que fazer.
 */
function traduzirFalha(escopo: string, err: unknown): string {
  logError(escopo, err);

  // Todo erro do cofre já tem uma frase pronta em PT-BR, escrita pra pessoa
  // saber o que fazer — inclusive "falta configurar a chave mestra"
  // (`isVaultKeyMissing`), que é o caso mais comum na primeira instalação.
  if (isVaultError(err)) return vaultErrorMessage(err.code);

  return "Não deu pra salvar a chave agora. Tente de novo.";
}

// -----------------------------------------------------------------------------
// Plataforma
// -----------------------------------------------------------------------------

/** Guarda (ou substitui) a chave que vale pra TODOS os workspaces. */
export async function savePlatformCredentialAction(
  input: SavePlatformCredentialInput,
): Promise<ActionResult<{ masked: string }>> {
  const parsed = savePlatformCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Confira os dados e tente de novo.",
    };
  }

  if (!(await assertPlatformAdmin())) return { ok: false, error: SO_O_DONO };

  const info = getProviderInfo(parsed.data.provider);
  const remetente = parsed.data.from?.trim() ?? "";

  try {
    const { masked } = await saveCredential({
      scope: { kind: "platform" },
      provider: parsed.data.provider,
      label: parsed.data.label?.trim() || info.label,
      secret: parsed.data.secret,
      // O remetente é config NÃO secreta: mora em `metadata`, não no rótulo.
      metadata: info.hasSenderField && remetente !== "" ? { from: remetente } : {},
    });

    revalidatePath("/plataforma/configuracoes");
    return { ok: true, data: { masked } };
  } catch (err) {
    return { ok: false, error: traduzirFalha("secrets.savePlatformCredential", err) };
  }
}

/** Apaga a chave da plataforma daquele provedor. */
export async function removePlatformCredentialAction(
  input: RemovePlatformCredentialInput,
): Promise<ActionResult> {
  const parsed = removePlatformCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os dados e tente de novo." };
  }

  if (!(await assertPlatformAdmin())) return { ok: false, error: SO_O_DONO };

  try {
    await deleteCredential({ kind: "platform" }, parsed.data.provider);
    revalidatePath("/plataforma/configuracoes");
    return { ok: true };
  } catch (err) {
    logError("secrets.removePlatformCredential", err);
    return { ok: false, error: "Não deu pra apagar a chave agora. Tente de novo." };
  }
}

// -----------------------------------------------------------------------------
// Workspace
// -----------------------------------------------------------------------------

/** Guarda (ou substitui) a chave PRÓPRIA daquele workspace. */
export async function saveOrgCredentialAction(
  input: SaveOrgCredentialInput,
): Promise<ActionResult<{ masked: string }>> {
  const parsed = saveOrgCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Confira os dados e tente de novo.",
    };
  }

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const info = getProviderInfo(parsed.data.provider);

  // Workspace só cadastra provedor de IA. O envio de email é do sistema
  // inteiro (é ele que manda os emails do app: convite e resultado de
  // automação — ver lib/email/smtp-do-supabase.ts), então quem
  // configura é o dono da plataforma.
  //
  // Sem esta linha, um dono de workspace conseguia gravar uma credencial de
  // email chamando a função direto — ela é um endereço público da internet,
  // não só um botão da tela. A linha ficava invisível em toda tela e passava a
  // ser usada nos convites daquele time.
  if (!info.isAiProvider) {
    return {
      ok: false,
      error: "Esse tipo de chave é configurado por quem cuida do sistema, não por workspace.",
    };
  }

  try {
    const { masked } = await saveCredential({
      scope: { kind: "workspace", organizationId: org.id },
      provider: parsed.data.provider,
      label: info.label,
      secret: parsed.data.secret,
    });

    revalidatePath(`/app/${parsed.data.orgSlug}/settings/integracoes`);
    return { ok: true, data: { masked } };
  } catch (err) {
    return { ok: false, error: traduzirFalha("secrets.saveOrgCredential", err) };
  }
}

/**
 * Apaga a chave própria do workspace.
 *
 * ⚠️ Apagar a chave do workspace É "voltar a usar a chave da plataforma": não
 * existe um terceiro estado. Quem chama tem que ter perguntado antes, porque o
 * segredo some de verdade e pra voltar é preciso colar ele de novo.
 */
export async function removeOrgCredentialAction(
  input: RemoveOrgCredentialInput,
): Promise<ActionResult> {
  const parsed = removeOrgCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os dados e tente de novo." };
  }

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  try {
    await deleteCredential({ kind: "workspace", organizationId: org.id }, parsed.data.provider);
    revalidatePath(`/app/${parsed.data.orgSlug}/settings/integracoes`);
    return { ok: true };
  } catch (err) {
    logError("secrets.removeOrgCredential", err);
    return { ok: false, error: "Não deu pra apagar a chave agora. Tente de novo." };
  }
}
