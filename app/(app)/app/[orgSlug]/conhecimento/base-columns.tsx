"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getEmbeddingModelEntry } from "@/lib/ai/embeddings";
import { formatDateTime } from "@/lib/format";
import type { KnowledgeBaseListItem } from "@/lib/knowledge/types";

/**
 * As colunas da lista de bases.
 *
 * ⚠️ IMPORTA `@/lib/ai/embeddings` DIRETO, nunca o barril `@/lib/ai`. O barril
 * puxa o resolvedor de modelo, que fala com o banco e com o cofre — e isso
 * quebra o build do lado do navegador. (É a regra 3 do
 * `app/(app)/app/[orgSlug]/CLAUDE.md`.)
 */
export function getBaseColumns(orgSlug: string): ColumnDef<KnowledgeBaseListItem>[] {
  return [
    {
      accessorKey: "name",
      header: "Base",
      cell: ({ row }) => (
        <Link
          href={`/app/${orgSlug}/conhecimento/${row.original.slug}`}
          className="group flex flex-col gap-0.5"
        >
          <span className="flex items-center gap-1.5 font-medium text-sm group-hover:text-primary">
            <span className="truncate">{row.original.name}</span>
            {/* Aposentada continua na lista, com selo: o que foi indexado não
                sumiu, e esconder a linha faria parecer que sumiu. */}
            {row.original.status === "archived" && (
              <Badge
                variant="outline"
                className="border-border/60 text-[10px] text-muted-foreground opacity-70"
              >
                Aposentada
              </Badge>
            )}
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
      accessorKey: "documentos",
      header: "Documentos",
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs">{row.original.documentos}</span>
          {row.original.documentosProcessando > 0 && (
            <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
              {row.original.documentosProcessando} lendo
            </Badge>
          )}
          {row.original.documentosFalhos > 0 && (
            <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
              {row.original.documentosFalhos} com erro
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "pedacos",
      header: "Trechos indexados",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {row.original.pedacos === 0 ? "nenhum" : row.original.pedacos}
        </span>
      ),
    },
    {
      accessorKey: "embeddingModel",
      header: "Como lê",
      cell: ({ row }) => {
        // O catálogo é código: se o modelo saiu da lista numa versão nova do
        // template, mostra o identificador cru em vez de sumir com a coluna.
        const ficha = getEmbeddingModelEntry(row.original.embeddingModel);
        return (
          <span className="text-xs">
            {ficha ? ficha.label : <span className="font-mono">{row.original.embeddingModel}</span>}
          </span>
        );
      },
    },
    {
      accessorKey: "updatedAt",
      header: "Atualizada",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {formatDateTime(row.original.updatedAt)}
        </span>
      ),
    },
  ];
}
