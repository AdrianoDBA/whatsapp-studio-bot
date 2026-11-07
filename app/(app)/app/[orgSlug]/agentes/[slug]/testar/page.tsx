import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAgentBySlug } from "@/lib/agents/queries";
import { getModel } from "@/lib/ai/catalog";
import { tryParseModelId } from "@/lib/ai/model-id";
import { requireOrgMember } from "@/lib/auth/guards";
import { getCredentialSources } from "@/lib/secrets";
import { getProviderInfo } from "@/lib/secrets/providers";
import { createClient } from "@/lib/supabase/server";
import { Playground } from "./playground";

type Props = { params: Promise<{ orgSlug: string; slug: string }> };

export const metadata = { title: "Testar agente" };

/**
 * O playground: manda um pedido pro agente e vê, passo a passo, o que ele fez.
 *
 * Qualquer membro do workspace pode rodar. As ferramentas que exigem papel de
 * dono/admin são filtradas pelo motor na hora de montar a execução — quem não
 * tem o papel roda o agente sem elas, em vez de tomar um "acesso negado".
 */
export default async function TestarAgentePage({ params }: Props) {
  const { orgSlug, slug } = await params;
  const { org } = await requireOrgMember({ orgSlug });

  const agent = await getAgentBySlug(org.id, slug);
  if (!agent) notFound();

  // "Quem paga a conta desta execução" — calculado no servidor, porque depende
  // de qual chave o cofre vai escolher. É informativo: a pessoa merece saber
  // de quem sai o dinheiro antes de clicar.
  const payerLabel = await descobrirQuemPaga(org.id, agent.model);

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
        <span className="label-mono">/ testar {agent.slug}</span>
        <h1 className="font-semibold text-3xl tracking-tight">Testar {agent.name}</h1>
        <p className="text-muted-foreground text-sm">
          Escreva um pedido e veja o que o agente responde — e o passo a passo do que ele fez pra
          chegar lá.
        </p>
      </div>

      {agent.status === "archived" && (
        <Card className="border-dashed">
          <CardContent className="p-5 text-sm">
            Esse agente está arquivado e não está executando no momento. Reative-o alterando seu status para ativo.
          </CardContent>
        </Card>
      )}

      <Playground
        orgSlug={orgSlug}
        agentId={agent.id}
        agentName={agent.name}
        payerLabel={payerLabel}
        examples={[
          "Escreva uma mensagem curta avisando o time que a reunião de amanhã foi remarcada.",
          "Faça um resumo do que este workspace tem em andamento.",
          "Me explique, em duas frases, o que você consegue fazer.",
        ]}
      />
    </div>
  );
}

/** "a sua chave" / "a chave do dono do sistema" / … em português claro. */
async function descobrirQuemPaga(orgId: string, modelId: string): Promise<string> {
  const ficha = getModel(modelId) ?? null;
  const provedor = ficha?.provider ?? tryParseModelId(modelId)?.provider ?? null;
  if (!provedor) return "não dá pra saber: o modelo desse agente não está mais na lista";

  const origens = await getCredentialSources(orgId, await createClient());
  const info = getProviderInfo(provedor);

  switch (origens[provedor]) {
    case "workspace":
      return `a chave da ${info.label} cadastrada neste workspace — quem paga é o time`;
    case "platform":
      return `a chave da ${info.label} do dono do sistema — quem paga é ele`;
    case "env":
      return `a chave da ${info.label} que está nas variáveis do servidor`;
    default:
      return `nenhuma — falta cadastrar a chave da ${info.label} em Integrações`;
  }
}
