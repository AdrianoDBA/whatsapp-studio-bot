import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RespostaFormatada } from "@/components/ai/resposta-formatada";
import { RunTrace } from "@/components/app/run-trace";
import { AvisoDeEnsaio, SeloDeEnsaio } from "@/components/app/selo-de-ensaio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RUN_STATUS_LABEL, RUN_STATUS_STYLE } from "@/lib/agents/run-labels";
import { getRunDetail } from "@/lib/agents/runs-queries";
import { getModel } from "@/lib/ai/catalog";
import { requireOrgMember } from "@/lib/auth/guards";
import { formatDateTime, formatDuration, formatTokens, formatUsdFromMicros } from "@/lib/format";

type Props = { params: Promise<{ orgSlug: string; id: string }> };

export const metadata = { title: "Execução" };

/**
 * O detalhe de UMA execução: o que foi pedido, o que saiu, quanto custou e o
 * passo a passo do que o agente fez pra chegar lá.
 *
 * O rastro vem do banco já ordenado por número do passo (`seq`) — a ordem em
 * que as linhas foram gravadas é diferente da ordem em que as coisas
 * aconteceram.
 */
export default async function RunDetailPage({ params }: Props) {
  const { orgSlug, id } = await params;
  const { org } = await requireOrgMember({ orgSlug });

  const run = await getRunDetail(org.id, id);
  if (!run) notFound();

  const ficha = run.model ? getModel(run.model) : null;
  // ⚠️ Vem de `agent_runs.modo`, gravado na ABERTURA da execução. Ler daqui é
  // o que faz o selo continuar certo mesmo depois de alguém virar a chave do
  // agendamento pra "real" — execução que já passou não muda de modo.
  const foiEnsaio = run.modo === "ensaio";

  return (
    <div className="max-w-3xl space-y-8">
      <Button
        render={<Link href={`/app/${orgSlug}/execucoes`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar
      </Button>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <span className="label-mono">/ execução #{run.id.slice(0, 8)}</span>
          <h1 className="font-semibold text-3xl tracking-tight">
            {run.agentName ?? run.agentSlug}
          </h1>
          <p className="text-muted-foreground text-sm">
            {run.triggeredByName ? `Rodada por ${run.triggeredByName}` : "Rodada pelo sistema"} em{" "}
            {formatDateTime(run.createdAt)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {foiEnsaio && <SeloDeEnsaio />}
          <Badge variant="outline" className={RUN_STATUS_STYLE[run.status]}>
            {RUN_STATUS_LABEL[run.status]}
          </Badge>
        </div>
      </div>

      {/* Logo abaixo do cabeçalho, ANTES de qualquer número ou resposta: o
          texto que o agente escreveu mais embaixo pode dizer "Enviei o email"
          (foi medido), e quem lê de cima pra baixo precisa saber disso antes
          de chegar lá. */}
      {foiEnsaio && <AvisoDeEnsaio />}

      {run.agentId && (
        <Button
          render={<Link href={`/app/${orgSlug}/agentes/${run.agentSlug}`} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          Abrir o agente
        </Button>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ números</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <Numero titulo="Duração" valor={formatDuration(run.durationMs)} />
          <Numero titulo="Custo" valor={formatUsdFromMicros(run.costMicros)} />
          <Numero titulo="Tokens de entrada" valor={formatTokens(run.tokensInput)} />
          <Numero titulo="Tokens de saída" valor={formatTokens(run.tokensOutput)} />
        </CardContent>
        <div className="border-border/60 border-t px-5 py-3 text-muted-foreground text-xs">
          Modelo:{" "}
          <span className="text-foreground">
            {ficha ? ficha.label : (run.model ?? "não registrado")}
          </span>
        </div>
      </Card>

      {run.errorMessage && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-5 text-destructive text-sm">{run.errorMessage}</CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ o que foi pedido</CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2.5 text-xs">
            {jsonLegivel(run.input)}
          </pre>
        </CardContent>
      </Card>

      {run.output && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/60 bg-card/40 py-3">
            <CardTitle className="label-mono text-[10px]">/ o que o agente respondeu</CardTitle>
          </CardHeader>
          <CardContent className="p-5 text-sm">
            <RespostaFormatada texto={run.output} />
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ passo a passo</CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <RunTrace steps={run.steps} failed={run.status === "failed"} />
        </CardContent>
      </Card>
    </div>
  );
}

function Numero({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="space-y-1">
      <p className="label-mono text-[10px]">{titulo}</p>
      <p className="font-mono text-sm">{valor}</p>
    </div>
  );
}

/** O jsonb do banco vira texto legível. Nunca lança: a tela não pode sumir. */
function jsonLegivel(valor: unknown): string {
  if (typeof valor === "string") return valor;
  try {
    return JSON.stringify(valor, null, 2) ?? "(vazio)";
  } catch {
    return "(não deu pra mostrar esse conteúdo)";
  }
}
