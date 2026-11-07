import { AlertTriangleIcon, ArrowLeftIcon, MessageSquareIcon, PlayIcon } from "lucide-react";
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

type Props = { params: Promise<{ orgSlug: string; slug: string }> };

export const metadata = { title: "Agente" };

const situacaoLabel: Record<AgentStatus, string> = {
  draft: "Rascunho",
  active: "No ar",
  archived: "Aposentado",
};

/**
 * Como este agente está montado — LEITURA, sem campo editável.
 *
 * Qualquer membro ABRE (pra ver como o agente está montado e ir pro
 * playground). Não existe mais botão de salvar nem de apagar: o agente nasce
 * de um arquivo (`lib/agents/blueprint.ts` + `lib/seed/registro.ts`) e é
 * gravado por `materializarWorkspace`. Mudar prompt, modelo, ferramentas ou
 * aposentar (`status: "archived"`) é editar aquele arquivo e materializar de
 * novo — nunca esta tela.
 */
export default async function AgentEditorPage({ params }: Props) {
  const { orgSlug, slug } = await params;
  const { org } = await requireOrgMember({ orgSlug });

  const agent = await getAgentBySlug(org.id, slug);
  if (!agent) notFound();

  const ficha = getModel(agent.model);
  const provedor = ficha ? getProviderInfo(ficha.provider) : null;

  // Só pra avisar se o modelo escolhido no arquivo não tem chave utilizável
  // hoje neste workspace — a mesma checagem que o antigo seletor fazia.
  const supabase = await createClient();
  const comChave = await listConfiguredAiProviders(org.id, supabase);
  const temChaveDoModelo = ficha ? comChave.includes(ficha.provider) : false;

  const catalogo = getToolCatalog();
  const ferramentas = agent.tools.map((id) => ({
    id,
    catalogo: catalogo.find((t) => t.id === id),
  }));

  return (
    <div className="max-w-3xl space-y-8">
      <Button
        render={<Link href={`/app/${orgSlug}/agentes`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar
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
          {/* "Conversar" vem antes de "Testar" de propósito: conversar é o que
              o aluno quer fazer com o agente dele; testar é o que ele faz UMA
              vez, pra ver o passo a passo de um pedido só. */}
          <Button
            render={<Link href={`/app/${orgSlug}/agentes/${agent.slug}/conversar`} />}
            nativeButton={false}
            size="sm"
            className="gap-1.5"
          >
            <MessageSquareIcon className="h-3.5 w-3.5" />
            Conversar
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

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ como ele funciona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8 p-6">
          <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-muted-foreground text-sm">
            Isso tudo vem do arquivo que define este agente. Pra mudar instruções, modelo ou
            ferramentas, peça pro Claude Code editar o arquivo — a mudança chega aqui no próximo
            deploy (ou rode npm run semear agora, sem esperar). Pra aposentar o agente, peça pra
            declarar <code className="font-mono text-xs">status: "archived"</code> nele.
          </p>

          <div className="space-y-1.5">
            <p className="font-medium text-sm">Instruções</p>
            <p className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
              {agent.system_prompt}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-sm">Modelo</p>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{ficha ? ficha.label : agent.model}</span>
                {provedor && <span className="label-mono text-[10px]">{provedor.label}</span>}
              </div>
              {ficha && (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  entrada {formatPricePerMTok(ficha.inputMicrosPerMillion)} · saída{" "}
                  {formatPricePerMTok(ficha.outputMicrosPerMillion)} · cabe{" "}
                  {formatTokens(ficha.contextWindow)} tokens de conversa
                </p>
              )}
              {!temChaveDoModelo && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangleIcon className="h-3 w-3 text-chart-3" />
                  Sem chave configurada pro {provedor?.label ?? "provedor"} neste workspace — o
                  agente não roda até alguém cadastrar uma.
                  <Link
                    href={`/app/${orgSlug}/settings/integracoes`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Cadastrar chave
                  </Link>
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-sm">Ferramentas</p>
            {ferramentas.length === 0 ? (
              <p className="rounded-lg border border-border/60 border-dashed p-3 text-muted-foreground text-sm">
                Nenhuma — este agente só conversa.
              </p>
            ) : (
              <div className="space-y-2">
                {ferramentas.map(({ id, catalogo: c }) => (
                  <div
                    key={id}
                    className={`rounded-lg border p-3 ${
                      c ? "border-border/60" : "border-destructive/40 bg-destructive/5"
                    }`}
                  >
                    {c ? (
                      <>
                        <p className="font-medium text-sm">{c.label}</p>
                        <p className="text-muted-foreground text-sm">{c.description}</p>
                      </>
                    ) : (
                      <p className="text-destructive text-sm">
                        <span className="font-mono text-xs">{id}</span> — essa ferramenta não existe
                        mais em código.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="font-medium text-sm">Criatividade</p>
              <p className="font-mono text-primary text-sm">
                {agent.temperature.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-sm">Passos por execução</p>
              <p className="font-mono text-primary text-sm">{agent.max_steps}</p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-sm">Tamanho máximo da resposta</p>
              <p className="font-mono text-primary text-sm">
                {formatTokens(agent.max_output_tokens)} tokens
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
