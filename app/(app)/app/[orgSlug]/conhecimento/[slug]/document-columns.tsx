"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRightIcon, DownloadIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatUsdFromMicros } from "@/lib/format";
import {
  deleteDocumentAction,
  retryDocumentAction,
  signedDocumentUrlAction,
} from "@/lib/knowledge/actions";
import type { DocumentListItem, DocumentStatus } from "@/lib/knowledge/types";

/**
 * Depois de 10 minutos parada, a leitura é considerada abandonada — o processo
 * que estava lendo morreu (deploy, reinício, queda) e ninguém vai terminar.
 *
 * O MESMO número está na função `queue_document` do banco, que é quem manda.
 * Aqui ele só decide se o botão fica clicável.
 */
const MINUTOS_ATE_CONSIDERAR_ABANDONADA = 10;

function leituraAbandonada(documento: DocumentListItem): boolean {
  const parado = Date.now() - new Date(documento.updatedAt).getTime();
  return parado > MINUTOS_ATE_CONSIDERAR_ABANDONADA * 60_000;
}

const SITUACAO_LABEL: Record<DocumentStatus, string> = {
  pending: "Na fila",
  processing: "Lendo...",
  ready: "Pronto",
  failed: "Falhou",
};

const SITUACAO_ESTILO: Record<DocumentStatus, string> = {
  pending: "border-border text-muted-foreground",
  processing: "border-border text-muted-foreground",
  ready: "border-primary/40 bg-primary/10 text-primary",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

const ORIGEM_LABEL: Record<DocumentListItem["sourceKind"], string> = {
  upload: "arquivo",
  text: "texto colado",
  url: "endereço",
};

export function getDocumentColumns(
  orgSlug: string,
  baseSlug: string,
  podeAdministrar: boolean,
): ColumnDef<DocumentListItem>[] {
  const colunas: ColumnDef<DocumentListItem>[] = [
    {
      accessorKey: "title",
      header: "Documento",
      cell: ({ row }) => (
        <Link
          href={`/app/${orgSlug}/conhecimento/${baseSlug}/${row.original.id}`}
          className="group flex flex-col gap-0.5"
        >
          <span className="flex items-center gap-1.5 font-medium text-sm group-hover:text-primary">
            <span className="truncate">{row.original.title}</span>
            <ArrowUpRightIcon className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
          </span>
          <span className="text-muted-foreground text-xs">
            {ORIGEM_LABEL[row.original.sourceKind]}
            {row.original.byteSize
              ? ` · ${Math.max(1, Math.round(row.original.byteSize / 1024))} KB`
              : ""}
          </span>
        </Link>
      ),
    },
    {
      accessorKey: "status",
      header: "Situação",
      cell: ({ row }) => (
        <div className="flex max-w-xs flex-col gap-1">
          <Badge variant="outline" className={SITUACAO_ESTILO[row.original.status]}>
            {SITUACAO_LABEL[row.original.status]}
          </Badge>
          {/* A frase de erro já vem em português do servidor. A tela mostra
              crua de propósito: é ela que diz o que fazer. */}
          {row.original.errorMessage && (
            <span className="text-balance text-destructive text-xs">
              {row.original.errorMessage}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "chunkCount",
      header: "Trechos",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {row.original.chunkCount === 0 ? "—" : row.original.chunkCount}
        </span>
      ),
    },
    {
      accessorKey: "embedCostMicros",
      header: "Custo da leitura",
      cell: ({ row }) => (
        // `null` vira "preço desconhecido", NUNCA "US$ 0,00": zero é "custou
        // zero mesmo". Quem escreve isso é `formatUsdFromMicros`.
        <span className="font-mono text-muted-foreground text-xs">
          {formatUsdFromMicros(row.original.embedCostMicros)}
        </span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Enviado",
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground text-xs">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
  ];

  if (podeAdministrar) {
    colunas.push({
      id: "acoes",
      header: "",
      cell: ({ row }) => <AcoesDoDocumento orgSlug={orgSlug} documento={row.original} />,
    });
  }

  return colunas;
}

/**
 * Os três botões de linha: baixar, tentar de novo e apagar.
 *
 * ⚠️ "TENTAR DE NOVO" APAGA OS TRECHOS ANTIGOS antes de reler (é o
 * `queue_document` do banco). Sem isso, reindexar deixaria a versão velha e a
 * nova do mesmo trecho na base, e a busca passaria a devolver as duas.
 */
function AcoesDoDocumento({
  orgSlug,
  documento,
}: {
  orgSlug: string;
  documento: DocumentListItem;
}) {
  const router = useRouter();
  const [ocupado, start] = useTransition();

  function baixar() {
    start(async () => {
      const r = await signedDocumentUrlAction({ orgSlug, documentId: documento.id });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.data?.url) window.open(r.data.url, "_blank", "noopener,noreferrer");
    });
  }

  function reler() {
    start(async () => {
      const r = await retryDocumentAction({ orgSlug, documentId: documento.id });
      router.refresh();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Documento lido de novo.");
    });
  }

  function apagar() {
    if (
      !window.confirm(
        `Apagar "${documento.title}"? Os trechos indexados e o arquivo original somem junto. ` +
          "Não tem desfazer.",
      )
    ) {
      return;
    }
    start(async () => {
      const r = await deleteDocumentAction({ orgSlug, documentId: documento.id });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Documento apagado.");
      router.refresh();
    });
  }

  return (
    <div className="flex justify-end gap-1">
      {documento.temArquivo && (
        <Button
          size="sm"
          variant="ghost"
          disabled={ocupado}
          onClick={baixar}
          title="Baixar o arquivo original"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={ocupado || (documento.status === "processing" && !leituraAbandonada(documento))}
        onClick={reler}
        title={
          documento.status === "processing" && leituraAbandonada(documento)
            ? "Essa leitura travou. Clique pra tentar de novo."
            : "Ler de novo (apaga os trechos antigos)"
        }
      >
        <RefreshCwIcon className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={ocupado}
        onClick={apagar}
        title="Apagar documento"
        className="text-destructive hover:text-destructive"
      >
        <Trash2Icon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
