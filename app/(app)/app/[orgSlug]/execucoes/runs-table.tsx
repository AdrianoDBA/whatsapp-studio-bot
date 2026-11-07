"use client";

import { ActivityIcon } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import type { RunListItem } from "@/lib/agents/runs-queries";
import { getRunColumns } from "./run-columns";

export function RunsTable({ orgSlug, runs }: { orgSlug: string; runs: RunListItem[] }) {
  return (
    <DataTable
      columns={getRunColumns(orgSlug)}
      data={runs}
      searchColumn="agentSlug"
      searchPlaceholder="Buscar por agente..."
      pageSize={20}
      empty={
        <EmptyState
          icon={ActivityIcon}
          title="Nenhuma execução por aqui"
          description="Ou nenhum agente rodou ainda, ou o filtro está apertado demais. Tente mudar o período pra 'Tudo'."
        />
      }
    />
  );
}
