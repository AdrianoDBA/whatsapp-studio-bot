/**
 * "Planta" de base de conhecimento: uma base descrita em CÓDIGO, pronta pra
 * virar uma linha em `knowledge_bases`.
 *
 * Arquivo PURO — dá pra testar direto no Vitest, sem banco.
 *
 * 🔴 `slug` e `embeddingModel` são CONGELADOS pelo gatilho
 * `freeze_knowledge_base_slug` assim que a linha nasce. Trocar qualquer um dos
 * dois no arquivo depois disso NÃO muda a base: o gatilho recusa, e a saída é
 * declarar OUTRA base, com outro apelido, e subir os arquivos de novo (regra
 * 10-I). Misturar trechos lidos por dois modelos de embedding faz a busca
 * devolver trecho aleatório, em silêncio.
 */
import type { TablesInsert } from "@/types/supabase";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** `provedor:modelo`, como em `lib/ai/catalog.ts`. */
const MODELO_RE = /^[a-z0-9-]+:.+$/;

export type KnowledgeBaseBlueprint = {
  /** Apelido na URL e chave da materialização. Minúsculas, números e hífen. */
  slug: string;
  /** O nome que aparece na tela. 2 a 80 caracteres. */
  name: string;
  /** Uma linha explicando pra que serve. Opcional, até 300 caracteres. */
  description?: string;
  /** `"provedor:modelo"`. Congelado depois de criado. */
  embeddingModel: string;
  /**
   * `"archived"` é como se APOSENTA uma base sem perder o que já foi indexado:
   * ela some da busca do agente, para de aceitar documento novo, e continua
   * aparecendo na lista com o selo de aposentada.
   *
   * ⚠️ É o ÚNICO jeito, e por um motivo que não dá pra contornar: o apelido e
   * o modelo de leitura são congelados por gatilho assim que a base nasce
   * (regra 10-I), não existe tela de apagar base, e base não tem agente dono
   * cujo `archived` a desligaria por tabela. Declarar aqui é a saída — e dá
   * pra voltar atrás trocando de novo pra `"active"`.
   *
   * Padrão: `"active"`.
   */
  status?: "active" | "archived";
};

function exigir(condicao: boolean, mensagem: string): void {
  if (!condicao) throw new Error(`baseParaInsert: ${mensagem}`);
}

export function baseParaInsert(
  bp: KnowledgeBaseBlueprint,
  organizationId: string,
  ownerId: string,
): TablesInsert<"knowledge_bases"> {
  exigir(
    SLUG_RE.test(bp.slug) && bp.slug.length >= 2 && bp.slug.length <= 60,
    `apelido "${bp.slug}" fora do formato (minúsculas, números e hífen, de 2 a 60 caracteres)`,
  );
  exigir(
    bp.name.trim().length >= 2 && bp.name.trim().length <= 80,
    `nome "${bp.name}" precisa ter de 2 a 80 caracteres`,
  );
  // Medido APARADO: é o valor aparado (`description: bp.description?.trim()`,
  // no `return` abaixo) que vai pro banco. Sem isso, uma descrição de 300
  // caracteres com espaço em volta era recusada aqui mesmo que o banco fosse
  // aceitar ela depois do trim.
  exigir((bp.description ?? "").trim().length <= 300, "a descrição passa de 300 caracteres");
  // `knowledge_bases_model_len` no banco: `char_length between 3 and 120`.
  exigir(
    MODELO_RE.test(bp.embeddingModel) &&
      bp.embeddingModel.length >= 3 &&
      bp.embeddingModel.length <= 120,
    `o modelo de embedding "${bp.embeddingModel}" não está no formato "provedor:modelo" (3 a 120 caracteres)`,
  );

  return {
    organization_id: organizationId,
    slug: bp.slug,
    name: bp.name.trim(),
    description: bp.description?.trim() || null,
    embedding_model: bp.embeddingModel,
    // A policy de INSERT ("admins create knowledge bases",
    // 20260821020000_knowledge_base.sql) exige `auth.uid() = created_by`.
    // Faltando aqui, TODA materialização de base por arquivo era recusada
    // pela regra de segurança do banco (42501) — achado rodando a prova ao
    // vivo do materializador contra Postgres de verdade, não pelo dublê de
    // teste. `created_by` alinha `baseParaInsert` com os outros três
    // blueprints (`blueprintToInsert`, `agendamentoParaInsert`,
    // `webhookParaInsert`), que já recebem quem está rodando e gravam a
    // coluna. `tests/knowledge-blueprint.test.ts` trava que a linha devolvida
    // sempre tem `created_by` preenchido.
    created_by: ownerId,
    status: bp.status ?? "active",
  };
}
