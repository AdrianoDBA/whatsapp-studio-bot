"use client";

import { FileTextIcon } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import type { DocumentListItem } from "@/lib/knowledge/types";
import { getDocumentColumns } from "./document-columns";

export function DocumentsTable({
  orgSlug,
  baseSlug,
  documentos,
  podeAdministrar,
}: {
  orgSlug: string;
  baseSlug: string;
  documentos: DocumentListItem[];
  podeAdministrar: boolean;
}) {
  return (
    <DataTable
      columns={getDocumentColumns(orgSlug, baseSlug, podeAdministrar)}
      data={documentos}
      searchColumn="title"
      searchPlaceholder="Buscar por título..."
      empty={
        <EmptyState
          icon={FileTextIcon}
          title="Nenhum documento nesta base"
          description={
            podeAdministrar
              ? "Envie um arquivo ou cole um texto aqui em cima. Enquanto a base estiver vazia, o agente não tem o que consultar."
              : "Peça pra quem administra este workspace subir os documentos desta base."
          }
        />
      }
    />
  );
}
