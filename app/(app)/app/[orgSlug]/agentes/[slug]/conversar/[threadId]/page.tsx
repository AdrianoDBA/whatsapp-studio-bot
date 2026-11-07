import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAgentBySlug } from "@/lib/agents/queries";
import { requireOrgMember } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { getPendingAnswer, getThread, getThreadMessages } from "@/lib/threads/queries";
import { Conversa } from "./conversa";

type Props = { params: Promise<{ orgSlug: string; slug: string; threadId: string }> };

export const metadata = { title: "Conversa" };

/**
 * Uma conversa com o agente.
 *
 * A página é SERVER: ela lê a conversa do banco e entrega pronta pro
 * componente de tela. É isso que faz a conversa continuar lá depois de um F5 —
 * e é por isso que o histórico não viaja pelo navegador a cada mensagem.
 */
export default async function ConversaPage({ params }: Props) {
  const { orgSlug, slug, threadId } = await params;
  const { user, org } = await requireOrgMember({ orgSlug });

  const agent = await getAgentBySlug(org.id, slug);
  if (!agent) notFound();

  const supabase = await createClient();

  const conversa = await getThread(supabase, org.id, threadId);
  // Conversa de outro agente na URL deste agente é endereço errado, não
  // "conversa de outro workspace" — mas pra quem está olhando dá no mesmo.
  if (!conversa || conversa.agent_id !== agent.id) notFound();

  const [mensagens, pendente] = await Promise.all([
    getThreadMessages(supabase, org.id, threadId),
    getPendingAnswer(supabase, org.id, threadId),
  ]);

  const souODono = conversa.user_id === user.id;

  return (
    <div className="max-w-3xl space-y-6">
      <Button
        render={<Link href={`/app/${orgSlug}/agentes/${agent.slug}/conversar`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Todas as conversas
      </Button>

      <div className="space-y-1.5">
        <span className="label-mono">/ conversa</span>
        <h1 className="font-semibold text-2xl tracking-tight">
          {conversa.title ?? `Conversa com ${agent.name}`}
        </h1>
      </div>

      {agent.status === "archived" && (
        <Card className="border-dashed">
          <CardContent className="p-5 text-sm">
            Esse agente está aposentado, então ele não responde mais. A conversa continua aqui pra
            leitura.
          </CardContent>
        </Card>
      )}

      <Conversa
        orgSlug={orgSlug}
        agentSlug={agent.slug}
        agentName={agent.name}
        threadId={threadId}
        titulo={conversa.title}
        mensagensIniciais={mensagens}
        podeEscrever={souODono && agent.status !== "archived"}
        souODono={souODono}
        pendente={pendente}
      />
    </div>
  );
}
