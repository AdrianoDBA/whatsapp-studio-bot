/**
 * A porta de entrada da camada de IA.
 *
 * Outras pastas importam daqui: `import { resolveModel } from "@/lib/ai"`.
 *
 * ⚠️ ESTE ARQUIVO PUXA CÓDIGO DE SERVIDOR (`resolve.ts` fala com o cofre, que
 * fala com o banco usando o cookie da sessão). Não importe ele de um
 * componente com "use client" — o build quebra. Numa tela, importe direto o
 * que é puro: `@/lib/ai/catalog`, `@/lib/ai/model-id`, `@/lib/ai/types`,
 * `@/lib/ai/cost`.
 *
 * `buildLanguageModel` NÃO é exportado aqui de propósito: quem quer um modelo
 * passa por `resolveModel`, que é quem garante a busca de chave pelo cofre.
 */

export {
  DEFAULT_MODEL_ID,
  getModel,
  isKnownModelId,
  listModels,
  listModelsByProvider,
  MODEL_CATALOG,
  pickDefaultModelId,
} from "./catalog";
export { calcCostMicros, calcCostMicrosById, extractProviderCostMicros } from "./cost";
export {
  calcEmbeddingCostMicros,
  DEFAULT_EMBEDDING_MODEL_ID,
  EMBEDDING_CATALOG,
  getEmbeddingModelEntry,
  listEmbeddingModelsByProvider,
  textoAjudaEmbedding,
} from "./embeddings";
export { AiConfigError, isAiConfigError, isMissingCredentialError } from "./errors";
export { formatModelId, modelIdSchema, parseModelId, tryParseModelId } from "./model-id";
export {
  hasAnyAiCredential,
  hasEmbeddingCredential,
  listConfiguredAiProviders,
  listEmbeddingCapableProviders,
  resolveEmbeddingModel,
  resolveModel,
} from "./resolve";
export type {
  AiConfigErrorCode,
  AiProviderName,
  CostBreakdown,
  CredentialSource,
  EmbeddingCatalogEntry,
  EmbeddingModel,
  EmbeddingProviderName,
  LanguageModel,
  LongContextPricing,
  ModelCapabilities,
  ModelCatalogEntry,
  ModelId,
  ModelTier,
  ParsedModelId,
  ResolvedEmbeddingModel,
  ResolvedModel,
  ResolveModelInput,
  TokenCounts,
} from "./types";
export { AI_PROVIDERS, EMBEDDING_PROVIDERS, PROVEDORES_SEM_EMBEDDING } from "./types";
