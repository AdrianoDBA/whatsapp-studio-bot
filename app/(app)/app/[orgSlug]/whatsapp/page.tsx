import type { Metadata } from "next";
import { requireOrgMember } from "@/lib/auth/guards";
import { getWhatsAppInstance } from "@/lib/whatsapp/queries";
import { WhatsAppClient } from "./whatsapp-client";

export const metadata: Metadata = {
  title: "WhatsApp & Celular | AtendeAI",
  description: "Conecte e associe o celular da sua empresa ao Agente de Atendimento",
};

type Props = {
  params: Promise<{ orgSlug: string }>;
};

export default async function WhatsAppPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org } = await requireOrgMember({ orgSlug });
  const instance = await getWhatsAppInstance(org.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">WhatsApp & Celular</h1>
        <p className="text-muted-foreground text-sm">
          Gerencie a integração do seu WhatsApp ao agente inteligente de atendimento.
        </p>
      </div>

      <WhatsAppClient orgSlug={orgSlug} initialInstance={instance} />
    </div>
  );
}
