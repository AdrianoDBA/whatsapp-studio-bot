import { AlertTriangleIcon, ArrowLeftIcon, MessageSquareIcon, PlayIcon, WrenchIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentBySlug } from "@/lib/agents/queries";
import { getToolCatalog } from "@/lib/agents/tools";
import type { AgentStatus } from "@/lib/agents/types";
import { listConfiguredAiProviders } from "@/lib/ai";
import { getModel } from "@/lib/ai/catalog";
import { requireOrgMember } from "@/lib/auth/guards";
import { formatPricePerMTok, formatTokens } from "@/lib/format";
import { getProviderInfo } from "@/lib/secrets/providers";
import { createClient } from "@/lib/supabase/server";
import { SecretaryCustomizer } from "./secretary-customizer";

type Props = { params: Promise<{ orgSlug: string; slug: string }> };

export const metadata = { title: "Agente de Atendimento" };

const situacaoLabel: Record<AgentStatus, string> = {
  draft: "Rascunho",
  active: "No ar",
  archived: "Aposentado",
};

export default async function AgentEditorPage({ params }: Props) {
  const { orgSlug, slug } = await params;
  const { org, role } = await requireOrgMember({ orgSlug });

  const agent = await getAgentBySlug(org.id, slug);
  if (!agent) notFound();

  const ficha = getModel(agent.model);
  const provedor = ficha ? getProviderInfo(ficha.provider) : null;

  const supabase = await createClient();
  const comChave = await listConfiguredAiProviders(org.id, supabase);
  const temChaveDoModelo = ficha ? comChave.includes(ficha.provider) : false;

  const catalogo = getToolCatalog();
  const ferramentas = agent.tools.map((id) => ({
    id,
    catalogo: catalogo.find((t) => t.id === id),
  }));

  const podeEditar = role === "owner" || role === "admin";

  return (
    <div className="max-w-4xl space-y-8 pb-12">
      <Button
        render={<Link href={`/app/${orgSlug}/agentes`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar para Agentes
      </Button>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <span className="label-mono">/ agente {agent.slug}</span>
          <h1 className="font-semibold text-3xl tracking-tight">{agent.name}</h1>
          {agent.description && (
            <p className="text-muted-foreground text-sm">{agent.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              agent.status === "archived"
                ? "border-border/60 text-muted-foreground opacity-70"
                : agent.status === "draft"
                  ? "border-border text-muted-foreground"
                  : "border-primary/40 bg-primary/10 text-primary"
            }
          >
            {situacaoLabel[agent.status]}
          </Badge>
          <Button
            render={<Link href={`/app/${orgSlug}/agentes/${agent.slug}/conversar`} />}
            nativeButton={false}
            size="sm"
            className="gap-1.5"
          >
            <MessageSquareIcon className="h-3.5 w-3.5" />
            Conversar no Painel
          </Button>
          <Button
            render={<Link href={`/app/${orgSlug}/agentes/${agent.slug}/testar`} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <PlayIcon className="h-3.5 w-3.5" />
            Testar
          </Button>
        </div>
      </div>

      {/* Editor e Personalizador Visual do Atendimento */}
      <SecretaryCustomizer
        orgSlug={orgSlug}
        orgName={org.name}
        agentId={agent.id}
        initialPrompt={agent.system_prompt}
        initialConfig={(agent.config as any) ?? null}
        podeEditar={podeEditar}
      />

      {/* Ficha Técnica, Ferramentas e Infraestrutura */}
      <Card className="overflow-hidden border-border/80">
        <CardHeader className="border-b border-border/60 bg-muted/20 py-3">
          <div className="flex items-center gap-2">
            <WrenchIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <CardTitle className="label-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Infraestrutura & Ferramentas Conectadas
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="space-y-1.5">
            <p className="font-medium text-xs">Modelo de Linguagem (IA)</p>
            <div className="rounded-lg border border-border/60 p-3 bg-muted/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{ficha ? ficha.label : agent.model}</span>
                {provedor && <span className="label-mono text-[10px]">{provedor.label}</span>}
              </div>
              {ficha && (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  Entrada {formatPricePerMTok(ficha.inputMicrosPerMillion)} · Saída{" "}
                  {formatPricePerMTok(ficha.outputMicrosPerMillion)} · Janela de contexto{" "}
                  {formatTokens(ficha.contextWindow)} tokens
                </p>
              )}
              {!temChaveDoModelo && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangleIcon className="h-3 w-3 text-chart-3" />
                  Sem chave configurada para o provedor neste workspace — o agente não rodará até alguém cadastrar uma.
                  <Link
                    href={`/app/${orgSlug}/settings/integracoes`}
                    className="text-primary underline-offset-2 hover:underline ml-1"
                  >
                    Cadastrar chave agora
                  </Link>
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-xs">Ferramentas Nativas Habilitadas ({ferramentas.length})</p>
            {ferramentas.length === 0 ? (
              <p className="rounded-lg border border-border/60 border-dashed p-3 text-muted-foreground text-xs">
                Nenhuma — este agente só conversa sem ferramentas adicionais.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ferramentas.map(({ id, catalogo: c }) => (
                  <div
                    key={id}
                    className={`rounded-lg border p-3 ${
                      c ? "border-border/60 bg-muted/10" : "border-destructive/40 bg-destructive/5"
                    }`}
                  >
                    {c ? (
                      <>
                        <p className="font-medium text-xs text-foreground">{c.label}</p>
                        <p className="mt-0.5 text-muted-foreground text-[11px] leading-snug">
                          {c.description}
                        </p>
                      </>
                    ) : (
                      <p className="text-destructive text-xs">
                        <span className="font-mono text-xs">{id}</span> — ferramenta descontinuada.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 border-t border-border/40 pt-4">
            <div className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground">Criatividade (Temperatura)</p>
              <p className="font-mono text-primary text-sm font-semibold">
                {agent.temperature.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground">Passos por execução</p>
              <p className="font-mono text-primary text-sm font-semibold">{agent.max_steps}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground">Teto de resposta</p>
              <p className="font-mono text-primary text-sm font-semibold">
                {formatTokens(agent.max_output_tokens)} tokens
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
