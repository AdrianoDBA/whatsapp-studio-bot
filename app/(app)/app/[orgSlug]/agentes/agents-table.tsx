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
          description="Peça pro Claude Code criar um agente. Workspace novo já nasce com ele; este aqui recebe no próximo deploy — ou rode npm run semear agora, sem esperar."
        />
      }
    />
  );
}
