import { requireOrgRole } from "@/lib/auth/guards";
import {
  getCredentialSources,
  isVaultReady,
  listAiProviders,
  listCredentials,
} from "@/lib/secrets";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceCredentials } from "./workspace-credentials";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Integrações" };

/**
 * A tela onde o time decide QUEM PAGA A CONTA da IA neste workspace: o dono do
 * sistema (chave da plataforma) ou o próprio time (chave própria).
 *
 * Só dono e admin do workspace entram — é uma decisão de dinheiro.
 *
 * O Resend (envio de email) NÃO aparece aqui de propósito: email é coisa do
 * app inteiro, não de um workspace. Ele fica só na tela da plataforma.
 */
export default async function IntegracoesPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  const supabase = await createClient();

  const [doWorkspace, origens, daPlataforma] = await Promise.all([
    listCredentials({ kind: "workspace", organizationId: org.id }),
    // Uma chamada só responde, pros cinco provedores, de onde a chave sairia
    // hoje NESTE workspace. Ela enxerga a chave da plataforma sem nunca abrir
    // o embrulho dela.
    getCredentialSources(org.id, supabase),
    // A MESMA pergunta, mas do ponto de vista da plataforma. Precisa das duas:
    // quando o workspace tem chave própria, a primeira responde "workspace" e
    // não dá pra saber se existe uma da plataforma atrás. Sem esta segunda, o
    // botão "usar a chave da plataforma" apareceria desligado sem motivo.
    getCredentialSources(null, supabase),
  ]);

  const porProvedor = new Map(doWorkspace.map((c) => [c.provider, c]));

  const providers = listAiProviders().map((info) => {
    const salva = porProvedor.get(info.id);
    return {
      id: info.id,
      label: info.label,
      description: info.description,
      helpUrl: info.helpUrl,
      keyHint: info.keyHint,
      saved: salva ? { masked: salva.masked, updatedAt: salva.updatedAt } : null,
      // "platform" quer dizer "o dono do sistema cadastrou na tela dele".
      // "env" (chave em variável de ambiente) NÃO conta como chave da
      // plataforma: ela não foi cadastrada por ninguém aqui dentro.
      platformHasKey: daPlataforma[info.id] === "platform",
      activeSource: origens[info.id],
    };
  });

  return (
    <WorkspaceCredentials
      orgSlug={orgSlug}
      encryptionReady={isVaultReady()}
      providers={providers}
    />
  );
}
