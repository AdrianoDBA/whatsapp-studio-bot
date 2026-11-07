"use client";

/**
 * OS TRECHOS — o que o agente realmente lê.
 *
 * Esta tela existe por um motivo só, e ele é de diagnóstico: quando a busca
 * "não acha" alguma coisa que está no documento, quase sempre o motivo aparece
 * aqui — o PDF veio com as colunas embaralhadas, a tabela virou uma parede de
 * números, o texto veio todo em maiúscula. Ver o pedaço do jeito que ele foi
 * guardado responde isso em cinco segundos.
 *
 * ⚠️ NENHUM VETOR APARECE AQUI, e nem chega a sair do banco: a consulta
 * (`listDocumentChunks`) lista as colunas na mão justamente pra não trazer a
 * coluna `embedding`, que tem 1536 números (~20 KB POR LINHA).
 */

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import type { DocumentChunkListItem } from "@/lib/knowledge/types";

/** Quanto de cada trecho aparece antes de a pessoa clicar em "ver tudo". */
const PREVIA_CHARS = 320;

export function ChunksList({
  itens,
  total,
  pagina,
  totalDePaginas,
  href,
}: {
  itens: DocumentChunkListItem[];
  total: number;
  /** Começa em 1, como a pessoa conta. */
  pagina: number;
  totalDePaginas: number;
  /** O endereço desta tela, sem o `?pagina=`. */
  href: string;
}) {
  if (itens.length === 0) {
    return (
      <EmptyState
        title="Nenhum trecho indexado"
        description="Ou a leitura ainda não terminou, ou ela falhou. O motivo aparece na situação do documento, aqui em cima."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        {total} trechos no total. Cada um vira uma "ficha" que o agente pode encontrar sozinho.
      </p>

      <ul className="space-y-3">
        {itens.map((pedaco) => (
          <li key={pedaco.id}>
            <Pedaco pedaco={pedaco} />
          </li>
        ))}
      </ul>

      {totalDePaginas > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            render={<Link href={`${href}?pagina=${Math.max(1, pagina - 1)}`} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            className="gap-1.5"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            Anteriores
          </Button>
          <span className="font-mono text-muted-foreground text-xs">
            página {pagina} de {totalDePaginas}
          </span>
          <Button
            render={<Link href={`${href}?pagina=${Math.min(totalDePaginas, pagina + 1)}`} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            disabled={pagina >= totalDePaginas}
            className="gap-1.5"
          >
            Próximos
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Pedaco({ pedaco }: { pedaco: DocumentChunkListItem }) {
  const [aberto, setAberto] = useState(false);
  const comprido = pedaco.content.length > PREVIA_CHARS;
  const texto = aberto || !comprido ? pedaco.content : `${pedaco.content.slice(0, PREVIA_CHARS)}…`;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label-mono text-[10px]">/ trecho #{pedaco.seq}</span>
        <span className="font-mono text-muted-foreground text-xs">
          {pedaco.content.length} letras
          {pedaco.tokens === null ? "" : ` · ~${pedaco.tokens} tokens`}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{texto}</p>
      {comprido && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="mt-2 text-primary text-xs hover:underline"
        >
          {aberto ? "mostrar menos" : "ver tudo"}
        </button>
      )}
    </div>
  );
}
