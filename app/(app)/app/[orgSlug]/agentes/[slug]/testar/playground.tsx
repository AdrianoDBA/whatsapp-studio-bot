"use client";

import { PlayIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RespostaFormatada } from "@/components/ai/resposta-formatada";
import { RunTrace } from "@/components/app/run-trace";
import { AvisoDeEnsaio, SeloDeEnsaio } from "@/components/app/selo-de-ensaio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { runAgentAction } from "@/lib/agents/actions";
import type { RunDetail } from "@/lib/agents/runs-queries";
import { formatDuration, formatTokens, formatUsdFromMicros } from "@/lib/format";

/**
 * O playground.
 *
 * ⚠️ FALHA DO AGENTE NÃO É ERRO DE FORMULÁRIO.
 * A função do servidor devolve `{ ok: true }` mesmo quando o agente quebrou —
 * com a execução dentro, pra esta tela mostrar o rastro do que aconteceu. Só
 * quando a execução NEM COMEÇOU (texto vazio, sem permissão, limite de uso) é
 * que vem `{ ok: false }` e vira um aviso vermelho.
 */
export function Playground({
  orgSlug,
  agentId,
  agentName,
  payerLabel,
  examples,
}: {
  orgSlug: string;
  agentId: string;
  agentName: string;
  /** Informativo: "essa execução vai usar: a sua chave". */
  payerLabel: string;
  /** Exemplos clicáveis pra quem não sabe o que digitar. */
  examples: string[];
}) {
  const [mensagem, setMensagem] = useState("");
  // ⚠️ COMEÇA LIGADO. É estado da TELA — não é gravado em lugar nenhum, então
  // recarregar a página volta pro padrão seguro. Ver a frase do contrato logo
  // abaixo, no card "Ensaio".
  const [ensaio, setEnsaio] = useState(true);
  const [rodando, startRun] = useTransition();
  const [execucao, setExecucao] = useState<RunDetail | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  function rodar(texto: string) {
    if (texto.trim() === "" || rodando) return;

    startRun(async () => {
      const resultado = await runAgentAction({
        orgSlug,
        agentId,
        message: texto,
        // A ÚNICA coisa que decide se a ferramenta age de verdade: o motor lê
        // isto e monta o `ctx.acao` em ensaio ou real. Ver `RunAgentParams.modo`.
        modo: ensaio ? "ensaio" : "real",
      });
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      if (resultado.data) {
        setExecucao(resultado.data.run);
        setAvisos(resultado.data.warnings);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-primary/25 bg-primary/[0.04] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium text-sm">Ensaio {ensaio ? "— ligado" : "— desligado"}</p>
            <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
              {/* ⚠️ NÃO CITE "chamar sistema de fora" AQUI. `ctx.acao.http`
                  existe no motor, mas NENHUMA ferramenta registrada usa ele
                  hoje — a única que age é `mandar-email`. Prometer na tela uma
                  capacidade que o agente não tem é o mesmo defeito do resto
                  desta onda, só na direção contrária. */}
              {ensaio
                ? 'Nada sai daqui pra fora: o email aparece como "eu teria mandado", em vez de ' +
                  "ser enviado. O agente pode dizer que enviou — não enviou."
                : "A ferramenta de mandar email vai mandar de verdade nesta execução."}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rodando}
            onClick={() => setEnsaio((v) => !v)}
          >
            {ensaio ? "Desligar ensaio" : "Ligar ensaio"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/40 p-3 text-sm">
        <WalletIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Essa execução vai usar</span>
        <span className="font-medium">{payerLabel}</span>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ o que você quer pedir</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-5">
          {/* min-h-* porque o textarea usa `field-sizing-content` e o `rows`
              acaba ignorado nos navegadores que suportam isso. */}
          <Textarea
            rows={4}
            className="min-h-28"
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            disabled={rodando}
            placeholder={`Escreva um pedido pro ${agentName}...`}
            aria-label="Pedido pro agente"
          />

          {examples.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={rodando}
                  onClick={() => setMensagem(ex)}
                  className="rounded-full border border-border/60 px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={rodando || mensagem.trim() === ""}
              onClick={() => rodar(mensagem)}
            >
              <PlayIcon className="h-3.5 w-3.5" />
              {rodando ? "Rodando..." : "Rodar agente"}
            </Button>
            <p className="text-muted-foreground text-xs">
              Agente com muitos passos pode demorar. Se der erro de conexão, olhe em{" "}
              <Link
                href={`/app/${orgSlug}/execucoes`}
                className="text-primary underline-offset-2 hover:underline"
              >
                Execuções
              </Link>{" "}
              — ele provavelmente terminou.
            </p>
          </div>
        </CardContent>
      </Card>

      {avisos.length > 0 && (
        <div className="space-y-1 rounded-lg border border-chart-3/40 bg-chart-3/5 p-4">
          <p className="font-medium text-sm">Coisas que aconteceram nesta execução</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-sm">
            {avisos.map((aviso) => (
              <li key={aviso}>{aviso}</li>
            ))}
          </ul>
        </div>
      )}

      {execucao && <Resultado orgSlug={orgSlug} run={execucao} />}
    </div>
  );
}

function Resultado({ orgSlug, run }: { orgSlug: string; run: RunDetail }) {
  const deuErro = run.status === "failed" || run.status === "cancelled";
  // ⚠️ VEM DO BANCO (`agent_runs.modo`), não do estado `ensaio` desta tela. A
  // diferença importa: o botão de ensaio pode ter sido virado DEPOIS de rodar,
  // e aí o selo passaria a mentir sobre uma execução que já aconteceu — que é
  // exatamente o defeito que ele existe pra consertar.
  const foiEnsaio = run.modo === "ensaio";

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ resposta</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {foiEnsaio && <SeloDeEnsaio />}
            <Badge
              variant="outline"
              className={
                deuErro
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-primary/40 bg-primary/10 text-primary"
              }
            >
              {deuErro ? "deu errado" : "deu certo"}
            </Badge>
            <Link
              href={`/app/${orgSlug}/execucoes/${run.id}`}
              className="text-primary text-xs underline-offset-2 hover:underline"
            >
              abrir no histórico
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {/* ANTES da resposta, de propósito: é aqui que o modelo mente
              ("Enviei o email com o relatório do dia para chefe@empresa.com",
              medido no navegador), e um aviso embaixo do texto chega depois de
              o aluno já ter acreditado. */}
          {foiEnsaio && (
            <AvisoDeEnsaio comoRodarDeVerdade="Pra valer mesmo, desligue o ensaio lá em cima e rode de novo." />
          )}

          {run.errorMessage && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
              {run.errorMessage}
            </p>
          )}

          {run.output && (
            <div className="text-sm">
              <RespostaFormatada texto={run.output} />
            </div>
          )}

          <p className="font-mono text-[11px] text-muted-foreground">
            levou {formatDuration(run.durationMs)} · custou {formatUsdFromMicros(run.costMicros)} ·
            tokens de entrada {formatTokens(run.tokensInput)} · de saída{" "}
            {formatTokens(run.tokensOutput)}
          </p>
        </CardContent>
      </Card>

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
