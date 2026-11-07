/**
 * Leitura da base de conhecimento — o que as TELAS mostram.
 *
 * ⚠️ TODA FUNÇÃO AQUI RECEBE O `supabase` COMO PRIMEIRO PARÂMETRO, em vez de
 * chamar `createClient()` lá dentro. É a mesma disciplina de `runAgent` e de
 * `lib/threads/queries.ts`: quem chama diz com que identidade a consulta roda.
 *
 * A regra de segurança do banco já prende cada consulta ao workspace de quem
 * está logado; o `.eq("organization_id", orgId)` daqui é o cinto além do
 * suspensório.
 *
 * ⚠️ NENHUMA CONSULTA AQUI SELECIONA `document_chunks.embedding`. São 1536
 * números, uns 20 KB POR LINHA — uma listagem de 50 pedaços viraria 1 MB de
 * JSON viajando à toa. Repare que os `select` desta pasta sempre listam as
 * colunas na mão; `select("*")` em `document_chunks` é proibido.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com "use client".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { textoAjudaEmbedding } from "@/lib/ai/embeddings";
import { listConfiguredAiProviders } from "@/lib/ai/resolve";
import { EMBEDDING_PROVIDERS, PROVEDORES_SEM_EMBEDDING } from "@/lib/ai/types";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";
import type {
  DocumentChunkListItem,
  DocumentListItem,
  EmbeddingReadiness,
  KnowledgeBaseListItem,
  KnowledgeBaseRecord,
} from "./types";

/** Quantos pedaços a tela de detalhe mostra por vez. */
export const PEDACOS_POR_PAGINA = 20;

/**
 * As bases do workspace, já com as contas que a tabela mostra.
 *
 * ⚠️ AS CONTAGENS SÃO FEITAS EM DUAS CONSULTAS, e não em cinco por base:
 * uma tela com 10 bases faria 50 idas ao banco. Aqui são sempre 3, custe o que
 * custar em linhas de código.
 */
export async function listKnowledgeBases(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<KnowledgeBaseListItem[]> {
  const { data: bases, error } = await supabase
    .from("knowledge_bases")
    .select("id, slug, name, description, embedding_model, status, updated_at")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    logError("knowledge.listKnowledgeBases", error);
    throw new Error("Não deu pra carregar as bases de conhecimento. Atualize a página.");
  }

  const linhas = bases ?? [];
  if (linhas.length === 0) return [];

  const [docs, pedacos] = await Promise.all([
    supabase
      .from("documents")
      .select("knowledge_base_id, status, chunk_count")
      .eq("organization_id", orgId),
    // Só o vínculo, sem `embedding` e sem `content`: é uma contagem.
    supabase
      .from("document_chunks")
      .select("knowledge_base_id")
      .eq("organization_id", orgId)
      .limit(100_000),
  ]);

  if (docs.error) logError("knowledge.listKnowledgeBases.documents", docs.error);
  if (pedacos.error) logError("knowledge.listKnowledgeBases.chunks", pedacos.error);

  const porBase = new Map<
    string,
    { documentos: number; falhos: number; processando: number; pedacos: number }
  >();
  const pegar = (id: string) => {
    let atual = porBase.get(id);
    if (!atual) {
      atual = { documentos: 0, falhos: 0, processando: 0, pedacos: 0 };
      porBase.set(id, atual);
    }
    return atual;
  };

  for (const d of docs.data ?? []) {
    const conta = pegar(d.knowledge_base_id);
    conta.documentos += 1;
    if (d.status === "failed") conta.falhos += 1;
    if (d.status === "processing" || d.status === "pending") conta.processando += 1;
  }
  for (const c of pedacos.data ?? []) {
    pegar(c.knowledge_base_id).pedacos += 1;
  }

  return linhas.map((b) => {
    const conta = porBase.get(b.id);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      description: b.description,
      embeddingModel: b.embedding_model,
      status: b.status,
      documentos: conta?.documentos ?? 0,
      pedacos: conta?.pedacos ?? 0,
      documentosFalhos: conta?.falhos ?? 0,
      documentosProcessando: conta?.processando ?? 0,
      updatedAt: b.updated_at,
    };
  });
}

/** Uma base pelo apelido, ou `null` quando ela não existe neste workspace. */
export async function getKnowledgeBaseBySlug(
  supabase: SupabaseClient<Database>,
  orgId: string,
  slug: string,
): Promise<KnowledgeBaseRecord | null> {
  const { data, error } = await supabase
    .from("knowledge_bases")
    .select("*")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    logError("knowledge.getKnowledgeBaseBySlug", error);
    return null;
  }
  return data;
}

/** Só as colunas que a tabela de documentos precisa — nunca o `content`. */
const COLUNAS_DO_DOCUMENTO =
  "id, title, status, source_kind, mime_type, byte_size, chunk_count, char_count, embed_tokens, embed_cost_micros, error_message, created_at, processed_at, updated_at, storage_path";

function paraItem(linha: {
  id: string;
  title: string;
  status: DocumentListItem["status"];
  source_kind: DocumentListItem["sourceKind"];
  mime_type: string | null;
  byte_size: number | null;
  chunk_count: number;
  char_count: number;
  embed_tokens: number;
  embed_cost_micros: number | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  updated_at: string;
  storage_path: string | null;
}): DocumentListItem {
  return {
    id: linha.id,
    title: linha.title,
    status: linha.status,
    sourceKind: linha.source_kind,
    mimeType: linha.mime_type,
    byteSize: linha.byte_size,
    chunkCount: linha.chunk_count,
    charCount: linha.char_count,
    embedTokens: linha.embed_tokens,
    embedCostMicros: linha.embed_cost_micros,
    errorMessage: linha.error_message,
    createdAt: linha.created_at,
    processedAt: linha.processed_at,
    updatedAt: linha.updated_at,
    temArquivo: Boolean(linha.storage_path),
  };
}

export async function listDocuments(
  supabase: SupabaseClient<Database>,
  orgId: string,
  kbId: string,
): Promise<DocumentListItem[]> {
  const { data, error } = await supabase
    .from("documents")
    .select(COLUNAS_DO_DOCUMENTO)
    .eq("organization_id", orgId)
    .eq("knowledge_base_id", kbId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    logError("knowledge.listDocuments", error);
    throw new Error("Não deu pra carregar os documentos. Atualize a página.");
  }
  return (data ?? []).map(paraItem);
}

export async function getDocument(
  supabase: SupabaseClient<Database>,
  orgId: string,
  docId: string,
): Promise<DocumentListItem | null> {
  const { data, error } = await supabase
    .from("documents")
    .select(COLUNAS_DO_DOCUMENTO)
    .eq("organization_id", orgId)
    .eq("id", docId)
    .maybeSingle();

  if (error) {
    logError("knowledge.getDocument", error);
    return null;
  }
  return data ? paraItem(data) : null;
}

/**
 * Os pedaços de um documento, paginados.
 *
 * ⚠️ O `select` lista as colunas na mão porque `embedding` NÃO pode entrar:
 * 20 pedaços com o vetor junto são ~400 KB de JSON, e a tela não mostra nada
 * disso.
 */
export async function listDocumentChunks(
  supabase: SupabaseClient<Database>,
  orgId: string,
  docId: string,
  opts?: { limit?: number; offset?: number },
): Promise<{ itens: DocumentChunkListItem[]; total: number }> {
  const limite = Math.max(1, Math.min(opts?.limit ?? PEDACOS_POR_PAGINA, 100));
  const inicio = Math.max(0, opts?.offset ?? 0);

  const { data, error, count } = await supabase
    .from("document_chunks")
    .select("id, seq, content, tokens", { count: "exact" })
    .eq("organization_id", orgId)
    .eq("document_id", docId)
    .order("seq", { ascending: true })
    .range(inicio, inicio + limite - 1);

  if (error) {
    logError("knowledge.listDocumentChunks", error);
    throw new Error("Não deu pra carregar os pedaços desse documento.");
  }

  return {
    itens: (data ?? []).map((c) => ({
      id: c.id,
      seq: c.seq,
      content: c.content,
      tokens: c.tokens,
    })),
    total: count ?? (data ?? []).length,
  };
}

/**
 * "Este workspace consegue indexar documento hoje?"
 *
 * ⚠️ ESTA PERGUNTA É FEITA ANTES DE QUALQUER COISA na tela de Conhecimento, e
 * é a mitigação nº 1 do risco 14 do contrato ("a armadilha da Anthropic"). Sem
 * ela, alguém com só a chave da Anthropic criaria a base, subiria um PDF de
 * 4 MB, esperaria, e receberia "model not found" — que não diz nada.
 */
export async function getEmbeddingReadiness(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<EmbeddingReadiness> {
  let comChave: string[] = [];
  try {
    comChave = await listConfiguredAiProviders(orgId, supabase);
  } catch (err) {
    logError("knowledge.getEmbeddingReadiness", err);
    return {
      pronto: false,
      provedoresProntos: [],
      provedoresSemEmbedding: [],
      mensagem: "Não deu pra conferir as chaves de IA agora. Atualize a página.",
    };
  }

  const prontos = EMBEDDING_PROVIDERS.filter((p) => comChave.includes(p));
  const semEmbedding = PROVEDORES_SEM_EMBEDDING.filter((p) => comChave.includes(p));

  if (prontos.length > 0) {
    return {
      pronto: true,
      provedoresProntos: [...prontos],
      provedoresSemEmbedding: [...semEmbedding],
      mensagem: null,
    };
  }

  // Duas situações diferentes, duas frases diferentes. Dizer "cadastre uma
  // chave" pra quem JÁ cadastrou uma é o jeito mais rápido de perder a pessoa.
  const mensagem =
    semEmbedding.length > 0
      ? textoAjudaEmbedding()
      : "Antes de subir um documento, cadastre uma chave em Configurações → " +
        "Integrações. A do OpenRouter é a mais simples: uma chave só serve pros agentes e " +
        "pra ler os seus documentos.";

  return {
    pronto: false,
    provedoresProntos: [],
    provedoresSemEmbedding: [...semEmbedding],
    mensagem,
  };
}
