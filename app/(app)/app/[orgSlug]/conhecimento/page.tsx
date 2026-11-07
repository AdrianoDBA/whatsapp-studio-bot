import { requireOrgMember } from "@/lib/auth/guards";
import { getEmbeddingReadiness, listKnowledgeBases } from "@/lib/knowledge/queries";
import { createClient } from "@/lib/supabase/server";
import { BasesTable } from "./bases-table";
import { EmbeddingKeyCard } from "./embedding-key-card";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Conhecimento" };

/**
 * A tela de Conhecimento: as "pastas" de documentos que os agentes consultam.
 *
 * QUALQUER MEMBRO ENTRA E LÊ — é o mesmo alcance da regra de segurança do
 * banco (`is_org_member` na policy de SELECT). Subir e apagar documento é de
 * quem administra, e quem manda nisso é a policy; a tela só esconde os
 * botões pra não oferecer o que vai ser recusado. Criar base não é botão
 * nenhum: uma base nasce de arquivo (`lib/knowledge/blueprint.ts`).
 *
 * ⚠️ A PRIMEIRA PERGUNTA DA TELA NÃO É "quais bases existem", é "este
 * workspace CONSEGUE ler documento hoje?". Ver `EmbeddingKeyCard`.
 */
export default async function ConhecimentoPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org, role } = await requireOrgMember({ orgSlug });

  const supabase = await createClient();
  const [prontidao, bases] = await Promise.all([
    getEmbeddingReadiness(supabase, org.id),
    listKnowledgeBases(supabase, org.id),
  ]);

  const podeAdministrar = role === "owner" || role === "admin";

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ conhecimento</span>
        <h1 className="font-semibold text-3xl tracking-tight">Conhecimento</h1>
        <p className="max-w-2xl text-muted-foreground text-sm">
          Suba os seus documentos e o agente passa a responder com eles: manual, contrato, política,
          tabela de preços. Ele procura os trechos que falam da pergunta e cita de onde tirou. As
          bases nascem do código: peça pro Claude Code declarar uma. Um workspace novo já nasce com
          ela; este workspace, que já existe, recebe no próximo deploy — ou rode npm run semear
          agora, sem esperar.
        </p>
      </div>

      {podeAdministrar ? (
        <EmbeddingKeyCard orgSlug={orgSlug} prontidao={prontidao} />
      ) : (
        <p className="text-muted-foreground text-xs">
          Quem administra este workspace é quem sobe e apaga documento. Você lê e testa a busca.
        </p>
      )}

      <BasesTable orgSlug={orgSlug} bases={bases} />

      <p className="text-muted-foreground text-xs">
        Pra um agente usar isto, peça pro Claude Code marcar a ferramenta{" "}
        <span className="font-medium">Buscar na base de conhecimento</span> na planta dele.
      </p>
    </div>
  );
}
