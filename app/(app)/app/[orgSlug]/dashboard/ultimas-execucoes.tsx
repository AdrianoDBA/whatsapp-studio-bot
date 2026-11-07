import { ActivityIcon, ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { SeloDeEnsaio } from "@/components/app/selo-de-ensaio";
import { Badge } from "@/components/ui/badge";
import { RUN_STATUS_LABEL, RUN_STATUS_STYLE, RUN_TRIGGER_LABEL } from "@/lib/agents/run-labels";
import type { RunListItem } from "@/lib/agents/runs-queries";
import { formatRelativeTime, formatUsdFromMicros } from "@/lib/format";

/**
 * "O QUE ACONTECEU AGORA HÁ POUCO" — as últimas execuções, em lista curta.
 *
 * ⚠️ COMPONENTE DE SERVIDOR, e isso importa: `formatRelativeTime` escreve "há
 * 4 min", que muda com o relógio. Num componente de navegador o servidor
 * escreveria um texto e o navegador outro poucos segundos depois, e o React
 * reclamaria. Aqui o texto vira HTML uma vez e fica.
 *
 * A tabela cheia (com filtro, ordenação e página) continua em Execuções — esta
 * lista existe pra responder "rodou?" sem sair do Início.
 */
export function UltimasExecucoes({ runs, orgSlug }: { runs: RunListItem[]; orgSlug: string }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="Nada rodou ainda"
        description="Quando você conversar com um agente ou uma automação disparar, aparece aqui."
      />
    );
  }

  return (
    <ul className="divide-y divide-border/50">
      {runs.map((run) => (
        <li key={run.id}>
          <Link
            href={`/app/${orgSlug}/execucoes/${run.id}`}
            className="group flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3 transition-colors hover:bg-card/60"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Badge variant="outline" className={`shrink-0 ${RUN_STATUS_STYLE[run.status]}`}>
                {RUN_STATUS_LABEL[run.status]}
              </Badge>
              {/* O Início é a tela em que o aluno cai ao entrar — sem o selo
                  aqui, uma execução de ensaio e uma real saem como a mesma
                  linha "Deu certo". Mesma disciplina de `run-columns.tsx`. */}
              {run.modo === "ensaio" && <SeloDeEnsaio className="shrink-0" />}
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-sm">
                {/* O nome do agente some quando ele é apagado; o apelido fica
                    congelado na linha da execução e continua servindo. */}
                <span className="truncate">{run.agentName ?? run.agentSlug}</span>
                <ArrowUpRightIcon className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-3 text-muted-foreground text-xs">
              <span>{run.triggeredByName ?? RUN_TRIGGER_LABEL[run.triggerKind]}</span>
              <span aria-hidden="true">·</span>
              <span>{formatRelativeTime(run.createdAt)}</span>
              <span aria-hidden="true">·</span>
              {/* 4 casas aqui de propósito: é o custo de UMA execução, a mesma
                  escala da tela de Execuções. */}
              <span className="tabular-nums">{formatUsdFromMicros(run.costMicros)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
