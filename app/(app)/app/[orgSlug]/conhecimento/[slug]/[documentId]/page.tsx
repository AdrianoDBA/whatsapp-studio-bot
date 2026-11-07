import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrgMember } from "@/lib/auth/guards";
import { formatDateTime, formatTokens, formatUsdFromMicros } from "@/lib/format";
import {
  getDocument,
  getKnowledgeBaseBySlug,
  listDocumentChunks,
  PEDACOS_POR_PAGINA,
} from "@/lib/knowledge/queries";
import type { DocumentStatus } from "@/lib/knowledge/types";
import { createClient } from "@/lib/supabase/server";
import { ChunksList } from "./chunks-list";

type Props = {
  params: Promise<{ orgSlug: string; slug: string; documentId: string }>;
  searchParams: Promise<{ pagina?: string }>;
};

export const metadata = { title: "Documento" };

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

/**
 * O detalhe de um documento: a ficha da leitura e os trechos que sobraram dela.
 *
 * ⚠️ TUDO QUE VEM DA URL É CONFERIDO. O `?pagina=` é digitado por qualquer um:
 * `pagina=-5` ou `pagina=abc` viraria um `range()` inválido e um erro feio na
 * tela. Aqui ele vira um número inteiro dentro do intervalo, sempre.
 */
export default async function DocumentoPage({ params, searchParams }: Props) {
  const { orgSlug, slug, documentId } = await params;
  const { pagina: paginaCrua } = await searchParams;
  const { org } = await requireOrgMember({ orgSlug });

  const supabase = await createClient();

  const base = await getKnowledgeBaseBySlug(supabase, org.id, slug);
  if (!base) notFound();

  const documento = await getDocument(supabase, org.id, documentId);
  if (!documento) notFound();

  const totalDePaginas = Math.max(1, Math.ceil(documento.chunkCount / PEDACOS_POR_PAGINA));
  const pedido = Number.parseInt(paginaCrua ?? "1", 10);
  const pagina = Number.isFinite(pedido) ? Math.min(Math.max(pedido, 1), totalDePaginas) : 1;

  const { itens, total } = await listDocumentChunks(supabase, org.id, documento.id, {
    limit: PEDACOS_POR_PAGINA,
    offset: (pagina - 1) * PEDACOS_POR_PAGINA,
  });

  const href = `/app/${orgSlug}/conhecimento/${slug}/${documento.id}`;

  return (
    <div className="space-y-8">
      <Button
        render={<Link href={`/app/${orgSlug}/conhecimento/${slug}`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar pra {base.name}
      </Button>

      <div className="space-y-1.5">
        <span className="label-mono">/ documento</span>
        <h1 className="font-semibold text-3xl tracking-tight">{documento.title}</h1>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="outline" className={SITUACAO_ESTILO[documento.status]}>
            {SITUACAO_LABEL[documento.status]}
          </Badge>
          <span className="text-muted-foreground text-xs">
            enviado em {formatDateTime(documento.createdAt)}
          </span>
        </div>
        {documento.errorMessage && (
          <p className="max-w-2xl text-balance pt-1 text-destructive text-sm">
            {documento.errorMessage}
          </p>
        )}
      </div>

      <Card>
        <CardHeader className="border-border/60 border-b bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ a leitura</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Ficha titulo="Trechos" valor={String(documento.chunkCount)} />
          <Ficha titulo="Letras lidas" valor={documento.charCount.toLocaleString("pt-BR")} />
          <Ficha titulo="Tokens" valor={formatTokens(documento.embedTokens)} />
          {/* `null` vira "preço desconhecido", NUNCA "US$ 0,00". */}
          <Ficha titulo="Custo" valor={formatUsdFromMicros(documento.embedCostMicros)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-border/60 border-b bg-card/40 py-3">
          <CardTitle className="label-mono text-[10px]">/ trechos indexados</CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <ChunksList
            itens={itens}
            total={total}
            pagina={pagina}
            totalDePaginas={totalDePaginas}
            href={href}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Ficha({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="space-y-1">
      <p className="label-mono text-[10px]">{titulo}</p>
      <p className="font-mono text-sm">{valor}</p>
    </div>
  );
}
