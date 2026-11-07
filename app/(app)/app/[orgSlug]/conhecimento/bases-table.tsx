"use client";

import { LibraryIcon } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import type { KnowledgeBaseListItem } from "@/lib/knowledge/types";
import { getBaseColumns } from "./base-columns";

export function BasesTable({
  orgSlug,
  bases,
}: {
  orgSlug: string;
  bases: KnowledgeBaseListItem[];
}) {
  return (
    <DataTable
      columns={getBaseColumns(orgSlug)}
      data={bases}
      searchColumn="name"
      searchPlaceholder="Buscar por nome..."
      empty={
        <EmptyState
          icon={LibraryIcon}
          title="Nenhuma base ainda"
          description="Peça pro Claude Code declarar uma base de conhecimento. Workspace novo já nasce com ela; este aqui recebe no próximo deploy — ou rode npm run semear agora, sem esperar."
        />
      }
    />
  );
}
