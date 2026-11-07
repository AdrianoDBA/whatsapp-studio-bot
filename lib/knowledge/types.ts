/**
 * Tipos da base de conhecimento.
 *
 * ESTE ARQUIVO É A CASA DOS TIPOS DE `lib/knowledge`. Os outros arquivos da
 * pasta reexportam daqui — ninguém redeclara. Mesma disciplina de
 * `lib/ai/types.ts` e `lib/secrets/types.ts`, e pelo mesmo motivo: quando o
 * mesmo tipo existe em dois lugares com formatos diferentes, quem importa do
 * lugar errado só descobre em produção.
 *
 * Arquivo PURO e só de tipos: pode ser importado por página, por componente
 * com "use client" e por teste.
 */

import type { EmbeddingProviderName } from "@/lib/ai/types";
import type { Database, Tables } from "@/types/supabase";

export type KnowledgeBaseRecord = Tables<"knowledge_bases">;
export type DocumentRecord = Tables<"documents">;
export type DocumentChunkRecord = Tables<"document_chunks">;

/** `pending` → `processing` → `ready` | `failed`. */
export type DocumentStatus = Database["public"]["Enums"]["document_status"];

/** De onde veio o documento: arquivo enviado, texto colado ou endereço. */
export type DocumentSourceKind = Database["public"]["Enums"]["document_source_kind"];

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/** Um trecho que a busca achou. */
export type KnowledgeSearchHit = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  /** a ordem do trecho dentro do documento (0 é o começo) */
  seq: number;
  content: string;
  /** 0..1 — quanto mais perto de 1, mais parecido com a pergunta. */
  similarity: number;
};

export type KnowledgeSearchResult = {
  /** `null` quando a busca varreu TODAS as bases do workspace. */
  base: { id: string; slug: string; name: string } | null;
  hits: KnowledgeSearchHit[];
};

/**
 * A capacidade estreita que uma ferramenta de agente recebe.
 *
 * MESMO ESPÍRITO DO `ctx.db`: uma capacidade nomeada, presa ao workspace, e
 * não um cliente cru. Quem escreve a ferramenta não tem por onde pedir a base
 * de conhecimento de outro workspace — não existe parâmetro pra isso.
 */
export type OrgScopedKnowledge = {
  /** As bases deste workspace, pro modelo saber o que existe. */
  listBases(): Promise<
    Array<{ id: string; slug: string; name: string; description: string | null }>
  >;
  /**
   * Procura os trechos mais parecidos com a pergunta.
   *
   * `baseSlug` vazio = procura em TODAS as bases do workspace.
   */
  search(params: {
    query: string;
    baseSlug?: string | null;
    limit?: number;
    minSimilarity?: number;
  }): Promise<KnowledgeSearchResult>;
};

// ---------------------------------------------------------------------------
// A pergunta que a tela precisa responder antes de qualquer coisa
// ---------------------------------------------------------------------------

/**
 * "Este workspace consegue indexar documento hoje?"
 *
 * A Anthropic não tem endpoint de embedding e o OpenRouter não repassa
 * `/embeddings`. Quem só tem essas chaves cadastradas NÃO indexa nada — e
 * descobrir isso depois de subir um PDF de 4 MB é péssimo. Por isso a tela
 * pergunta antes de qualquer upload, com `EmbeddingKeyCard`.
 */
export type EmbeddingReadiness = {
  pronto: boolean;
  /** Provedores com chave que SABEM indexar. */
  // Escrito à mão seria mentira em pouco tempo: o OpenRouter entrou nesta lista
  // depois. Vem do tipo, que é a fonte única.
  provedoresProntos: EmbeddingProviderName[];
  /** Provedores com chave que NÃO sabem — é o que explica o "por quê". */
  provedoresSemEmbedding: Array<"anthropic" | "openrouter">;
  /** Frase pronta pra tela, em PT-BR coloquial. `null` quando está tudo certo. */
  mensagem: string | null;
};

// ---------------------------------------------------------------------------
// O que as telas listam
// ---------------------------------------------------------------------------

export type KnowledgeBaseListItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  embeddingModel: string;
  /** "active" | "archived". Aposentada some da busca do agente. */
  status: string;
  documentos: number;
  pedacos: number;
  documentosFalhos: number;
  documentosProcessando: number;
  updatedAt: string;
};

export type DocumentListItem = {
  id: string;
  title: string;
  status: DocumentStatus;
  sourceKind: DocumentSourceKind;
  mimeType: string | null;
  byteSize: number | null;
  chunkCount: number;
  charCount: number;
  embedTokens: number;
  /** micro-dólares. `null` = preço desconhecido; 0 = custou zero mesmo. */
  embedCostMicros: number | null;
  /** JÁ em PT-BR leigo. A tela mostra cru. */
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
  /**
   * Última mexida na linha. A tela usa isso pra saber se uma leitura marcada
   * como "Lendo..." está viva ou foi abandonada (processo morreu no meio).
   */
  updatedAt: string;
  /** true quando existe arquivo no bucket (dá pra baixar de novo). */
  temArquivo: boolean;
};

export type DocumentChunkListItem = {
  id: string;
  seq: number;
  content: string;
  tokens: number | null;
};
