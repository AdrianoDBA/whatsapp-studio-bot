/**
 * Transformar texto em números — a chamada que gasta dinheiro.
 *
 * Cada pedaço vira uma lista de 1536 números que representa o SIGNIFICADO dele.
 * É isso que o `pgvector` compara depois.
 *
 * TRÊS COISAS QUE NÃO PODEM MUDAR AQUI:
 *
 * 1. **A ORDEM DE SAÍDA É A ORDEM DE ENTRADA.** O vetor da posição 3 tem que
 *    ser o do texto da posição 3. Se isso embaralhar, cada pedaço fica com o
 *    significado de outro — e a busca passa a devolver o trecho errado sem
 *    NENHUM erro aparecendo. É o defeito mais difícil de perceber desta pasta.
 * 2. **O tamanho do vetor é 1536.** É o tipo da coluna. Vetor de outro tamanho
 *    é recusado pelo Postgres com uma mensagem que não diz nada pro aluno, e
 *    por isso a conferência é feita AQUI, com frase em português.
 * 3. **Custo desconhecido é `null`, nunca 0.** Zero é "custou zero mesmo".
 *
 * ⚠️ ISTO FALA COM A INTERNET. Não importe de um componente com "use client".
 */
import { embedMany } from "ai";
import { calcEmbeddingCostMicros } from "@/lib/ai/embeddings";
import { opcoesDeEmbedding } from "@/lib/ai/providers";
import type { ResolvedEmbeddingModel } from "@/lib/ai/types";
import { estimarTokens } from "./chunk";

/**
 * Quantos pedaços vão numa chamada só.
 *
 * 32 é conservador de propósito: o teto da OpenAI é bem maior, mas um lote
 * gigante que falha no meio joga fora o trabalho todo — e a indexação aqui é
 * síncrona, dentro de uma requisição que o servidor da frente corta aos 60 s.
 * Lote menor = mais chamadas, porém falha menor e progresso visível.
 */
export const LOTE_EMBEDDING = 32;

/** Quantos números o vetor precisa ter. É o tipo da coluna, não uma escolha. */
export const DIMENSOES = 1536;

export type EmbeddingLoteResult = {
  /** um vetor por pedaço, NA MESMA ORDEM em que os textos entraram */
  vetores: number[][];
  tokens: number;
  /** micro-dólares. `null` = não deu pra saber (NUNCA 0 pra "não sei"). */
  costMicros: number | null;
};

/**
 * Manda um lote de textos e recebe os vetores.
 *
 * LANÇA quando o provedor recusa (chave errada, sem crédito, fora do ar) —
 * quem chama é `ingest.ts`, que embrulha tudo e nunca deixa vazar exceção
 * técnica pro aluno.
 */
export async function gerarEmbeddings(p: {
  modelo: ResolvedEmbeddingModel;
  textos: string[];
  signal?: AbortSignal;
}): Promise<EmbeddingLoteResult> {
  if (p.textos.length === 0) return { vetores: [], tokens: 0, costMicros: 0 };

  const { embeddings, usage } = await embedMany({
    model: p.modelo.model,
    values: p.textos,
    abortSignal: p.signal,
    // Sem isto o Gemini devolve 3072 números e a gravação falha no banco.
    providerOptions: opcoesDeEmbedding(p.modelo.provider, p.modelo.entry.dimensions),
    // O AI SDK já divide em chamadas do tamanho que o provedor aceita; o nosso
    // lote de 32 é a divisão de cima, pra falhar pequeno.
    maxRetries: 2,
  });

  if (embeddings.length !== p.textos.length) {
    // Isto nunca deveria acontecer — e é justamente por isso que precisa
    // estourar alto. Um vetor a menos silenciosamente desalinha TODOS os
    // pedaços dali pra frente.
    throw new Error(
      `embedding: o provedor devolveu ${embeddings.length} vetores para ${p.textos.length} textos`,
    );
  }

  for (const vetor of embeddings) {
    if (vetor.length !== DIMENSOES) {
      throw new Error(
        `embedding: o provedor devolveu vetor de ${vetor.length} números (esperado ${DIMENSOES})`,
      );
    }
  }

  // O provedor informa o total de tokens do lote. Quando ele não informa
  // (acontece), a estimativa do recorte entra no lugar — sempre pra cima.
  const tokens =
    typeof usage?.tokens === "number" && Number.isFinite(usage.tokens) && usage.tokens > 0
      ? usage.tokens
      : p.textos.reduce((soma, t) => soma + estimarTokens(t), 0);

  return {
    vetores: embeddings.map((v) => [...v]),
    tokens,
    costMicros: calcEmbeddingCostMicros(p.modelo.modelId, tokens),
  };
}

/**
 * O vetor no formato que o Postgres entende.
 *
 * ⚠️ VAI COMO TEXTO, e não como lista de números: `jsonb` não tem tipo de
 * vetor, então `append_document_chunks` e `match_document_chunks` recebem
 * `"[0.1,0.2,…]"` e fazem `::vector` na entrada. É o mesmo formato que o
 * `pgvector` imprime, então a ida e a volta batem.
 *
 * O corte em 6 casas decimais economiza ~40% do tamanho do JSON sem mexer no
 * resultado da busca (a comparação por cosseno não distingue a 7ª casa).
 */
export function vetorParaTexto(vetor: number[]): string {
  const partes = new Array<string>(vetor.length);
  for (let i = 0; i < vetor.length; i++) {
    const n = vetor[i] ?? 0;
    partes[i] = Number.isFinite(n) ? n.toFixed(6) : "0";
  }
  return `[${partes.join(",")}]`;
}

/** Quebra uma lista em lotes de `LOTE_EMBEDDING`. */
export function emLotes<T>(itens: T[], tamanho = LOTE_EMBEDDING): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}
