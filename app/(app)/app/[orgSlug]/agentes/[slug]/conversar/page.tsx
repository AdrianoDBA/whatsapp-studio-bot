import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAgentBySlug } from "@/lib/agents/queries";
import { requireOrgMember } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { listThreads } from "@/lib/threads/queries";
import { ConversasList } from "./conversas-list";

type Props = { params: Promise<{ orgSlug: string; slug: string }> };

export const metadata = { title: "Conversar com o agente" };

/**
 * A lista de conversas com um agente.
 *
 * Qualquer membro do workspace entra e LÊ qualquer conversa daqui — e a tela
 * diz isso com todas as letras, porque é o tipo de coisa que um leigo não
 * espera. Escrever, só na conversa que a própria pessoa começou.
 */
export default async function ConversarPage({ params }: Props) {
  const { orgSlug, slug } = await params;
  const { user, org } = await requireOrgMember({ orgSlug });

  const agent = await getAgentBySlug(org.id, slug);
  if (!agent) notFound();

  const supabase = await createClient();
  const conversas = await listThreads(supabase, org.id, {
    agentId: agent.id,
    userId: user.id,
  });

  // A lista acima já vem filtrada pela pessoa; a do workspace inteiro é uma
  // segunda consulta, mostrada num bloco separado pra deixar claro de quem é
  // cada conversa.
  const doWorkspace = (await listThreads(supabase, org.id, { agentId: agent.id })).map((c) => ({
    ...c,
    isMine: c.userId === user.id,
  }));

  return (
    <div className="max-w-3xl space-y-8">
      <Button
        render={<Link href={`/app/${orgSlug}/agentes/${agent.slug}`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar pro agente
      </Button>

      <div className="space-y-1.5">
        <span className="label-mono">/ conversar {agent.slug}</span>
        <h1 className="font-semibold text-3xl tracking-tight">Conversar com {agent.name}</h1>
        <p className="text-muted-foreground text-sm">
          Aqui a conversa continua de onde parou — ela fica guardada e sobrevive a recarregar a
          página.
        </p>
      </div>

      {agent.status === "archived" && (
        <Card className="border-dashed">
          <CardContent className="p-5 text-sm">
            Esse agente está aposentado, então ele não conversa. Pra reativar, peça pro Claude Code
            declarar <code className="font-mono text-xs">status: "active"</code> nele — a mudança
            chega no próximo deploy, ou rode{" "}
            <code className="font-mono text-xs">npm run semear</code> agora, sem esperar.
          </CardContent>
        </Card>
      )}

      <ConversasList
        orgSlug={orgSlug}
        agentSlug={agent.slug}
        agentName={agent.name}
        podeConversar={agent.status !== "archived"}
        minhas={conversas}
        doWorkspace={doWorkspace}
      />
    </div>
  );
}
