"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Agent } from "@/lib/agents/queries";
import type { AgentStatus } from "@/lib/agents/types";
import { getModel } from "@/lib/ai/catalog";
import { formatDateTime } from "@/lib/format";

/** Uma linha da lista: o agente mais quantas ferramentas ele tem marcadas. */
export type AgentListItem = Agent & { toolCount: number };

const situacaoLabel: Record<AgentStatus, string> = {
  draft: "Rascunho",
  active: "No ar",
  archived: "Aposentado",
};

const situacaoStyle: Record<AgentStatus, string> = {
  draft: "border-border text-muted-foreground",
  active: "border-primary/40 bg-primary/10 text-primary",
  archived: "border-border/60 text-muted-foreground opacity-70",
};

export function getAgentColumns(orgSlug: string): ColumnDef<AgentListItem>[] {
  return [
    {
      accessorKey: "name",
      header: "Agente",
      cell: ({ row }) => (
        <Link
          href={`/app/${orgSlug}/agentes/${row.original.slug}`}
          className="group flex flex-col gap-0.5"
        >
          <span className="flex items-center gap-1.5 font-medium text-sm group-hover:text-primary">
            <span className="truncate">{row.original.name}</span>
            <ArrowUpRightIcon className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
          </span>
          {row.original.description && (
            <span className="truncate text-muted-foreground text-xs">
              {row.original.description}
            </span>
          )}
        </Link>
      ),
    },
    {
      accessorKey: "status",
      header: "Situação",
      cell: ({ row }) => (
        <Badge variant="outline" className={situacaoStyle[row.original.status]}>
          {situacaoLabel[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: "model",
      header: "Modelo",
      cell: ({ row }) => {
        // O catálogo é código: se o modelo saiu da lista numa versão nova do
        // template, mostra o identificador cru em vez de sumir com a coluna.
        const ficha = getModel(row.original.model);
        return (
          <span className="text-xs">
            {ficha ? ficha.label : <span className="font-mono">{row.original.model}</span>}
          </span>
        );
      },
    },
    {
      accessorKey: "toolCount",
      header: "Ferramentas",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {row.original.toolCount === 0 ? "nenhuma" : row.original.toolCount}
        </span>
      ),
    },
    {
      accessorKey: "updated_at",
      header: "Atualizado",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {formatDateTime(row.original.updated_at)}
        </span>
      ),
    },
  ];
}
