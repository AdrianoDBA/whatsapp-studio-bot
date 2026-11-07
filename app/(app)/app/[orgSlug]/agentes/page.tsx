import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listAgents } from "@/lib/agents/queries";
import { hasAnyAiCredential } from "@/lib/ai";
import { requireOrgMember } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { AgentsTable } from "./agents-table";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Agentes" };

/**
 * A lista de agentes do workspace.
 *
 * Qualquer membro VÊ a lista (e consegue rodar no playground). Cadastrar
 * chave de IA é de dono/admin — quem não é simplesmente não vê o botão.
 */
export default async function AgentsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org, role } = await requireOrgMember({ orgSlug });

  const podeAdministrar = role === "owner" || role === "admin";
  const supabase = await createClient();
  const [agents, temChave] = await Promise.all([
    listAgents(org.id),
    hasAnyAiCredential(org.id, supabase),
  ]);

  const linhas = agents.map((a) => ({ ...a, toolCount: a.tools.length }));

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ agentes</span>
        <h1 className="font-semibold text-3xl tracking-tight">Agentes</h1>
        <p className="text-muted-foreground text-sm">
          Um agente é uma inteligência artificial com instruções personalizadas e ferramentas
          conectadas ao WhatsApp e aos canais de atendimento do seu negócio.
        </p>
      </div>

      {!temChave && (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm">
              Nenhuma chave de IA cadastrada ainda — os agentes não vão conseguir rodar até alguém
              cadastrar uma.
            </p>
            {podeAdministrar && (
              <Button
                render={<Link href={`/app/${orgSlug}/settings/integracoes`} />}
                nativeButton={false}
                size="sm"
                variant="outline"
              >
                Cadastrar chave
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <AgentsTable orgSlug={orgSlug} agents={linhas} />
    </div>
  );
}
