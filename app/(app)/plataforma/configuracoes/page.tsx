import { requirePlatformAdmin } from "@/lib/auth/guards";
import { isDevelopment } from "@/lib/env";
import { listPlatformAdmins } from "@/lib/platform/queries";
import { CREDENTIAL_PROVIDERS, listCredentials, vaultStatus } from "@/lib/secrets";
import { PlatformCredentials } from "./platform-credentials";

export const metadata = { title: "Configurações da plataforma" };

/**
 * A tela onde o dono do sistema cadastra as chaves que valem pra TODOS os
 * workspaces.
 *
 * O guard aparece aqui de novo mesmo já estando no layout: página é endereço
 * público, e é barato demais conferir duas vezes.
 *
 * ⚠️ Nada de segredo passa por aqui. `listCredentials` já devolve a chave
 * mascarada — a versão inteira nem é lida do banco (a permissão de leitura da
 * coluna do embrulho não foi dada pro app).
 */
export default async function PlatformSettingsPage() {
  await requirePlatformAdmin();

  const [admins, cadastradas] = await Promise.all([
    listPlatformAdmins(),
    listCredentials({ kind: "platform" }),
  ]);

  const porProvedor = new Map(cadastradas.map((c) => [c.provider, c]));

  const providers = CREDENTIAL_PROVIDERS.map((info) => {
    const salva = porProvedor.get(info.id);
    return {
      id: info.id,
      label: info.label,
      description: info.description,
      helpUrl: info.helpUrl,
      keyHint: info.keyHint,
      hasSenderField: info.hasSenderField,
      saved: salva
        ? {
            masked: salva.masked,
            label: salva.label,
            from: salva.metadata.from ?? null,
            updatedAt: salva.updatedAt,
          }
        : null,
    };
  });

  return (
    <PlatformCredentials
      vaultStatus={vaultStatus()}
      local={isDevelopment()}
      admins={admins}
      providers={providers}
    />
  );
}
