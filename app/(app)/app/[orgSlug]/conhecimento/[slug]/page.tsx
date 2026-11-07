import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getEmbeddingModelEntry } from "@/lib/ai/embeddings";
import { requireOrgMember } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { getKnowledgeBaseBySlug, listDocuments } from "@/lib/knowledge/queries";
import { createClient } from "@/lib/supabase/server";
import { DocumentsTable } from "./documents-table";
import { TestarBusca } from "./testar-busca";
import { UploadForm } from "./upload-form";

type Props = { params: Promise<{ orgSlug: string; slug: string }> };

export const metadata = { title: "Base de conhecimento" };

/**
 * O detalhe de uma base: o que tem dentro, como subir mais e como testar.
 *
 * ⚠️ O APELIDO NA URL É CONGELADO no banco (gatilho
 * `freeze_knowledge_base_slug`). Isso é de propósito: o endereço desta tela
 * pode ser colado num chat do time e continuar valendo.
 */
export default async function BaseDeConhecimentoPage({ params }: Props) {
  const { orgSlug, slug } = await params;
  const { org, role } = await requireOrgMember({ orgSlug });

  const supabase = await createClient();
  const base = await getKnowledgeBaseBySlug(supabase, org.id, slug);
  if (!base) notFound();

  const documentos = await listDocuments(supabase, org.id, base.id);
  const podeAdministrar = role === "owner" || role === "admin";
  const comoLe = getEmbeddingModelEntry(base.embedding_model);
  const prontos = documentos.filter((d) => d.status === "ready").length;
  const trechos = documentos.reduce((soma, d) => soma + d.chunkCount, 0);

  return (
    <div className="space-y-8">
      <Button
        render={<Link href={`/app/${orgSlug}/conhecimento`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Voltar pra Conhecimento
      </Button>

      <div className="space-y-1.5">
        <span className="label-mono">/ conhecimento / {base.slug}</span>
        <h1 className="font-semibold text-3xl tracking-tight">{base.name}</h1>
        {base.description && <p className="text-muted-foreground text-sm">{base.description}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {base.status === "archived" && (
            <Badge variant="outline" className="border-border/60 text-muted-foreground opacity-70">
              Aposentada
            </Badge>
          )}
          <Badge variant="outline" className="border-border text-muted-foreground">
            {prontos} de {documentos.length} prontos
          </Badge>
          <Badge variant="outline" className="border-border text-muted-foreground">
            {trechos} trechos indexados
          </Badge>
          <span className="text-muted-foreground text-xs">
            Lida com {comoLe ? comoLe.label : base.embedding_model} · criada em{" "}
            {formatDateTime(base.created_at)}
          </span>
        </div>
      </div>

      {/* Aposentada: some da busca e não lê documento novo. O formulário de
          enviar sai da tela porque o envio seria recusado depois de subir o
          arquivo — melhor não oferecer do que aceitar e falhar. */}
      {base.status === "archived" ? (
        <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-muted-foreground text-sm">
          Esta base está <strong>aposentada</strong>: o agente não procura mais nela, e ela não
          recebe documento novo. O que já foi indexado continua aqui, intacto — se ela voltar a ser
          declarada como ativa, tudo volta a funcionar sem precisar subir nada de novo.
        </p>
      ) : (
        podeAdministrar && <UploadForm orgSlug={orgSlug} baseSlug={base.slug} />
      )}

      <DocumentsTable
        orgSlug={orgSlug}
        baseSlug={base.slug}
        documentos={documentos}
        podeAdministrar={podeAdministrar}
      />

      {/* Numa base aposentada a busca SEMPRE devolveria "nenhuma base ativa" —
          oferecer o campo seria convidar pra um erro garantido. */}
      {base.status !== "archived" && <TestarBusca orgSlug={orgSlug} baseSlug={base.slug} />}

      <p className="text-muted-foreground text-xs">
        Nome e descrição vêm do arquivo que declara esta base (
        <code className="font-mono">lib/knowledge/blueprint.ts</code> +{" "}
        <code className="font-mono">lib/seed/registro.ts</code>); a
        mudança chega no próximo deploy (ou rode <code className="font-mono">npm run semear</code>{" "}
        agora, sem esperar). O apelido (<code className="font-mono">/{base.slug}</code>) e o jeito
        de ler os documentos são congelados assim que a base nasce: pra trocar de modelo, crie outra
        e suba os arquivos de novo. Pra tirar esta base de circulação sem perder o que já foi
        indexado, peça pra declarar <code className="font-mono text-xs">status: "archived"</code>{" "}
        nela.
      </p>
    </div>
  );
}
