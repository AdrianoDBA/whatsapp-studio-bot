"use client";

import { BotIcon } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { type AgentListItem, getAgentColumns } from "./agent-columns";

export function AgentsTable({ orgSlug, agents }: { orgSlug: string; agents: AgentListItem[] }) {
  return (
    <DataTable
      columns={getAgentColumns(orgSlug)}
      data={agents}
      searchColumn="name"
      searchPlaceholder="Buscar por nome..."
      empty={
        <EmptyState
          icon={BotIcon}
          title="Nenhum agente ainda"
          description="Nenhum agente cadastrado para este workspace no momento."
        />
      }
    />
  );
}
