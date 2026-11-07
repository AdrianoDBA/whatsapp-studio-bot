/**
 * O catálogo de modelos de EMBEDDING — os que transformam texto em números.
 *
 * "Embedding" é a peça que faz a base de conhecimento funcionar: cada pedaço
 * de documento vira uma lista de 1536 números que representa o SIGNIFICADO
 * daquele trecho. A pergunta também vira. Aí o banco procura os pedaços cujos
 * números estão mais perto dos da pergunta — e é isso que o agente lê.
 *
 * ⚠️ DUAS COISAS AQUI NÃO SÃO CONFIGURAÇÃO, SÃO REGRA DE BANCO:
 *
 * 1. **A dimensão é 1536, sempre.** É o TIPO da coluna
 *    `document_chunks.embedding` (`vector(1536)`), não um número num arquivo.
 *    Modelo que nasce com 3072 é truncado pelo próprio provedor — ver
 *    `buildEmbeddingModel` em `providers.ts`.
 * 2. **A Anthropic e o OpenRouter não entram nesta lista.** A Anthropic não
 *    tem endpoint de embedding, e o OpenRouter não repassa `/embeddings`. Um
 *    workspace que só tenha essas chaves não indexa nada — e a tela avisa
 *    ANTES, em três lugares (ver `lib/knowledge/CLAUDE.md`).
 *
 * ⚠️ PREÇO ENVELHECE. Os três preços aqui foram conferidos em 21/08/2026 nas
 * tabelas públicas da OpenAI e do Google. O campo `pricedAt` aparece NA TELA
 * de criação de base, então o aluno vê de que dia é a conferência. De
 * propósito não existe teste que quebre sozinho com o tempo — mesma decisão do
 * `catalog.ts`.
 *
 * Arquivo PURO: pode ser importado por página, por componente com "use client"
 * e por teste.
 */
import type { EmbeddingCatalogEntry, ModelId } from "./types";

export { EMBEDDING_PROVIDERS, PROVEDORES_SEM_EMBEDDING } from "./types";

/** Data em que os preços deste arquivo foram conferidos. Aparece na tela. */
const CONFERIDO_EM = "2026-08-21";

/**
 * Os modelos de embedding que o template sabe usar.
 *
 * Ordem: recomendado primeiro, e dentro disso do mais barato pro mais caro —
 * a tela mostra na ordem em que estão aqui.
 */
export const EMBEDDING_CATALOG: readonly EmbeddingCatalogEntry[] = [
  {
    id: "openrouter:openai/text-embedding-3-small",
    provider: "openrouter",
    providerModelId: "openai/text-embedding-3-small",
    label: "Embedding 3 Small (via OpenRouter)",
    description:
      "O melhor pra começar: usa a MESMA chave do OpenRouter que os agentes já usam, então " +
      "você não precisa de conta em mais lugar nenhum.",
    dimensions: 1536,
    // US$ 0,02 por 1M de tokens + a taxa do OpenRouter. Conferido ao vivo:
    // 1 token custou US$ 0,00000002.
    microsPerMillion: 20_000,
    maxInputTokens: 8_191,
    pricedAt: CONFERIDO_EM,
    recommended: true,
  },
  {
    id: "openrouter:openai/text-embedding-3-large",
    provider: "openrouter",
    providerModelId: "openai/text-embedding-3-large",
    label: "Embedding 3 Large (via OpenRouter)",
    description:
      "Acha trecho com um pouco mais de precisão e custa 6 vezes mais. Só vale se a busca do " +
      "Small estiver errando muito.",
    dimensions: 1536,
    microsPerMillion: 130_000,
    maxInputTokens: 8_191,
    pricedAt: CONFERIDO_EM,
    recommended: false,
  },
  {
    id: "openai:text-embedding-3-small",
    provider: "openai",
    providerModelId: "text-embedding-3-small",
    label: "OpenAI — Embedding 3 Small",
    description:
      "O mesmo modelo, mas cobrado direto pela OpenAI. Use se você já tem conta lá e prefere " +
      "pagar direto pra ela.",
    dimensions: 1536,
    // US$ 0,02 por 1M de tokens.
    microsPerMillion: 20_000,
    maxInputTokens: 8_191,
    pricedAt: CONFERIDO_EM,
    recommended: false,
  },
  {
    id: "openai:text-embedding-3-large",
    provider: "openai",
    providerModelId: "text-embedding-3-large",
    description:
      "Acha trecho com um pouco mais de precisão, e custa 6 vezes mais. Só vale a pena se a " +
      "busca do Small estiver errando muito.",
    label: "OpenAI — Embedding 3 Large",
    dimensions: 1536,
    // US$ 0,13 por 1M de tokens.
    microsPerMillion: 130_000,
    maxInputTokens: 8_191,
    pricedAt: CONFERIDO_EM,
    recommended: false,
  },
  {
    id: "google:gemini-embedding-001",
    provider: "google",
    providerModelId: "gemini-embedding-001",
    label: "Google — Gemini Embedding",
    description:
      "Use se a sua chave de IA é do Google. Aceita textos menores por chamada, então " +
      "documento grande demora um pouco mais.",
    dimensions: 1536,
    // US$ 0,15 por 1M de tokens.
    microsPerMillion: 150_000,
    // O limite de verdade do modelo. O nosso pedaço tem ~1.000 caracteres
    // (≈ 250 tokens), então nunca chega perto — o campo existe pro dia em que
    // alguém aumentar `CHUNK_ALVO_CHARS`.
    maxInputTokens: 2_048,
    pricedAt: CONFERIDO_EM,
    recommended: false,
  },
];

/**
 * O modelo com que toda base de conhecimento nasce.
 *
 * É o mesmo valor do `default` da coluna `knowledge_bases.embedding_model`.
 * Mudou aqui, mude na migration — senão uma base criada pelo SQL Editor e uma
 * criada pela tela indexariam com modelos diferentes.
 */
export const DEFAULT_EMBEDDING_MODEL_ID: ModelId = "openrouter:openai/text-embedding-3-small";

const POR_ID = new Map<string, EmbeddingCatalogEntry>(EMBEDDING_CATALOG.map((e) => [e.id, e]));

/** A ficha de um modelo de embedding, ou `undefined` se ele não está na lista. */
export function getEmbeddingModelEntry(id: string): EmbeddingCatalogEntry | undefined {
  return POR_ID.get(id);
}

/** Os modelos de embedding de um provedor, na ordem do catálogo. */
export function listEmbeddingModelsByProvider(
  provider: EmbeddingCatalogEntry["provider"],
): EmbeddingCatalogEntry[] {
  return EMBEDDING_CATALOG.filter((e) => e.provider === provider);
}

/**
 * Quanto custou indexar, em micro-dólares INTEIROS e arredondado PRA CIMA.
 *
 * ⚠️ Devolve `null` quando o modelo não está no catálogo — e aí
 * `documents.embed_cost_micros` grava NULO, que a tela lê como "preço
 * desconhecido". NUNCA devolva 0 pra "não sei": zero é "custou zero mesmo", e
 * mostrar "US$ 0,0000" pra um documento que custou dinheiro é mentir.
 */
export function calcEmbeddingCostMicros(id: string, tokens: number): number | null {
  const entry = POR_ID.get(id);
  if (!entry) return null;
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.ceil((Math.trunc(tokens) * entry.microsPerMillion) / 1_000_000);
}

/**
 * A frase que a tela mostra quando o workspace só tem chave de provedor que
 * não sabe indexar.
 *
 * Mora aqui (arquivo puro) porque ela aparece em TRÊS lugares: no cartão da
 * tela de Conhecimento, no aviso da tela de envio, e na `AiConfigError` de
 * código `provedor-sem-embedding` — e as três precisam dizer a mesma coisa.
 */
export function textoAjudaEmbedding(): string {
  return (
    "Pra ler os seus documentos o app precisa de uma chave do OpenRouter, da OpenAI ou do " +
    "Google. A da Anthropic (Claude) serve pra conversar, mas não sabe ler documento. " +
    "Abra Configurações → Integrações e cadastre uma das três — a do OpenRouter é a mais " +
    "simples, porque é a mesma que os agentes já usam."
  );
}
