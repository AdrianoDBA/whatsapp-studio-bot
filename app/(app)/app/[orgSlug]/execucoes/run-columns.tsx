"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { SeloDeEnsaio } from "@/components/app/selo-de-ensaio";
import { Badge } from "@/components/ui/badge";
import { RUN_STATUS_LABEL, RUN_STATUS_STYLE, RUN_TRIGGER_LABEL } from "@/lib/agents/run-labels";
import type { RunListItem } from "@/lib/agents/runs-queries";
import { formatDateTime, formatDuration, formatUsdFromMicros } from "@/lib/format";

export function getRunColumns(orgSlug: string): ColumnDef<RunListItem>[] {
  return [
    {
      accessorKey: "agentSlug",
      header: "Agente",
      cell: ({ row }) => (
        <Link
          href={`/app/${orgSlug}/execucoes/${row.original.id}`}
          className="group flex flex-col gap-0.5"
        >
          <span className="flex items-center gap-1.5 font-medium text-sm group-hover:text-primary">
            {/* O nome do agente some quando ele é apagado; o apelido fica
                congelado na linha da execução e continua servindo. */}
            <span className="truncate">{row.original.agentName ?? row.original.agentSlug}</span>
            <ArrowUpRightIcon className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
          </span>
          {row.original.agentName === null && (
            <span className="text-muted-foreground text-xs">(agente apagado)</span>
          )}
        </Link>
      ),
    },
    {
      accessorKey: "status",
      header: "Resultado",
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={RUN_STATUS_STYLE[row.original.status]}>
            {RUN_STATUS_LABEL[row.original.status]}
          </Badge>
          {/* A lista é o primeiro "bater o olho": sem o selo aqui, uma execução
              de ensaio e uma de verdade são a mesma linha "deu certo" — e
              ensaio é o PADRÃO de agendamento e webhook (regra 10-L), ou seja,
              a maioria das linhas desta tabela. */}
          {row.original.modo === "ensaio" && <SeloDeEnsaio />}
        </div>
      ),
    },
    {
      accessorKey: "triggeredByName",
      header: "Quem rodou",
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.triggeredByName ?? RUN_TRIGGER_LABEL[row.original.triggerKind]}
        </span>
      ),
    },
    {
      accessorKey: "durationMs",
      header: "Duração",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {formatDuration(row.original.durationMs)}
        </span>
      ),
    },
    {
      accessorKey: "costMicros",
      header: "Custo",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {formatUsdFromMicros(row.original.costMicros)}
        </span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Quando",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
  ];
}
