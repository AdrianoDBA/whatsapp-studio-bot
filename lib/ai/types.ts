/**
 * Tipos da camada de modelos de IA.
 *
 * ESTE ARQUIVO É A CASA DOS TIPOS DE `lib/ai`. Os outros arquivos da pasta
 * reexportam daqui — ninguém redeclara. É a mesma disciplina de
 * `lib/secrets/types.ts`, e pelo mesmo motivo: quando o mesmo tipo existe em
 * dois lugares com formatos diferentes, o código que importa do lugar errado
 * só quebra em produção.
 *
 * Arquivo PURO e só de tipos (fora a constante `AI_PROVIDERS`): pode ser
 * importado por página, por componente com "use client" e por teste.
 */
import type { EmbeddingModelV3, LanguageModelV3 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CredentialSource } from "@/lib/secrets";
import type { Database } from "@/types/supabase";

/**
 * Modelo pronto pro `streamText` / `generateText` do AI SDK v6.
 *
 * Repare que é o tipo do SDK, não um invólucro nosso: o template não tem uma
 * "interface de LLM" própria pra manter. Quem fala com o modelo é o AI SDK.
 */
export type LanguageModel = LanguageModelV3;

/**
 * Os quatro provedores de IA que o template sabe usar.
 *
 * O `resend` do cofre NÃO está aqui de propósito — ele é envio de email, não
 * IA. Por isso `AiProviderName` é um subconjunto de `CredentialProvider`.
 */
export const AI_PROVIDERS = ["openrouter", "anthropic", "openai", "google"] as const;

export type AiProviderName = (typeof AI_PROVIDERS)[number];

/**
 * O identificador de modelo como ele fica gravado em `agents.model`:
 * `"provedor:modelo"`.
 *
 * Ex.: `"openrouter:anthropic/claude-sonnet-5"`, `"anthropic:claude-sonnet-5"`,
 * `"google:gemini-3.7-flash"`.
 */
export type ModelId = string;

/** O que o modelo aceita fazer. Alimenta o aviso da tela de escolha. */
export type ModelCapabilities = {
  /** aceita ferramenta (o modelo pode pedir pra rodar uma função) */
  tools: boolean;
  /** aceita imagem na entrada */
  images: boolean;
  /** aceita resposta em formato fixo (JSON com formato combinado) */
  structuredOutput: boolean;
};

/**
 * Faixa cara pra modelo que cobra mais quando o prompt é gigante (o Gemini Pro
 * dobra de preço acima de 200 mil tokens de entrada).
 *
 * ⚠️ Quando a faixa entra, ela vale pra execução INTEIRA — entrada E saída —,
 * não só pros tokens que passaram do limite. É assim que os provedores cobram.
 */
export type LongContextPricing = {
  thresholdTokens: number;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
};

/** Só pra agrupar na tela: barato, meio-termo, caro-e-esperto. */
export type ModelTier = "economico" | "equilibrado" | "avancado";

export type ModelCatalogEntry = {
  /** exatamente `${provider}:${providerModelId}` */
  id: ModelId;
  provider: AiProviderName;
  /** o que vai pro SDK. Ex.: "anthropic/claude-sonnet-5", "gpt-5.6-terra" */
  providerModelId: string;
  label: string;
  /** uma linha em PT-BR coloquial: pra que serve */
  description: string;
  /** máximo de tokens de ENTRADA (é o que limita o tamanho da conversa) */
  contextWindow: number;
  /** máximo de tokens de SAÍDA numa resposta só */
  maxOutputTokens: number;
  /** micro-dólares INTEIROS por 1.000.000 de tokens. US$ 5,00 = 5_000_000 */
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  longContextPricing?: LongContextPricing;
  capabilities: ModelCapabilities;
  tier: ModelTier;
  recommended: boolean;
  /** ISO YYYY-MM-DD em que o preço foi conferido. APARECE NA TELA. */
  pricedAt: string;
  /** aviso em PT-BR sobre o preço (promoção com data, faixa por tamanho) */
  pricingNote?: string;
};

/** O que `parseModelId` devolve. Ver `model-id.ts`. */
export type ParsedModelId = {
  provider: AiProviderName;
  providerModelId: string;
  id: ModelId;
};

/** O que `resolveModel` recebe. Ver `resolve.ts`. */
export type ResolveModelInput = {
  modelId: string;
  /**
   * Workspace dono da execução. `null` = "não tem workspace nesse caminho", e
   * a busca de chave pula direto pra plataforma → variável de ambiente.
   *
   * É `string | null` OBRIGATÓRIO (não opcional) de propósito: quem chama tem
   * que DIGITAR `null`, então vira escolha consciente, não esquecimento.
   */
  organizationId: string | null;
  /**
   * Com que identidade falar com o banco pra achar a chave.
   *
   * OBRIGATÓRIO. Ver a justificativa completa em `lib/secrets/resolve.ts`: numa
   * execução agendada não existe cookie, e um `createClient()` escondido lá
   * dentro sairia anônimo — toda automação falharia na hora de buscar a chave.
   */
  supabase: SupabaseClient<Database>;
};

/** O que `resolveModel` devolve: modelo pronto + a ficha dele. */
export type ResolvedModel = {
  model: LanguageModel;
  modelId: ModelId;
  provider: AiProviderName;
  /** o registro do catálogo. É de onde sai o preço. */
  entry: ModelCatalogEntry;
  /** de onde veio a chave. Serve pro rastro, nunca pra tela do aluno. */
  credentialSource: CredentialSource;
};

/** Quanto custou, em micro-dólares INTEIROS. Ver `cost.ts`. */
export type CostBreakdown = {
  inputMicros: number;
  outputMicros: number;
  /** soma. É o que vai pra `agent_runs.cost_micros` (bigint). */
  totalMicros: number;
  /**
   * false quando algum contador de token veio indefinido do provedor.
   * O custo então é PISO, não verdade — a tela diz "aproximado".
   */
  exact: boolean;
  longContextApplied: boolean;
};

/** Contagem de tokens de uma execução, do jeito que o AI SDK v6 entrega. */
export type TokenCounts = {
  /** `usage.inputTokens` do AI SDK v6 — pode vir indefinido */
  input: number | undefined;
  output: number | undefined;
};

/** Códigos de falha de CONFIGURAÇÃO. Ver `errors.ts`. */
export type AiConfigErrorCode =
  /** não está no formato "provedor:modelo" */
  | "id-invalido"
  /** o pedaço antes do ':' não é um dos quatro provedores */
  | "provedor-desconhecido"
  /** bem formado, mas fora do catálogo */
  | "modelo-desconhecido"
  /** nenhuma chave achada pra esse provedor (workspace, plataforma nem env) */
  | "credencial-ausente"
  /**
   * O workspace TEM chave de IA, mas só de provedor que não sabe indexar
   * documento (Anthropic e OpenRouter não têm endpoint de embedding).
   *
   * É um código separado de propósito: a frase que o aluno precisa ler aqui
   * não é "cadastre uma chave" (ele já cadastrou), é "cadastre uma chave da
   * OpenRouter, da OpenAI ou do Google, porque a que você tem não sabe fazer isso".
   */
  | "provedor-sem-embedding";

// ---------------------------------------------------------------------------
// Embedding — transformar texto em números que representam o SIGNIFICADO
// ---------------------------------------------------------------------------
// Isso é o que faz a base de conhecimento funcionar: cada pedaço de documento
// vira uma lista de 1536 números, a pergunta também vira, e o banco procura os
// pedaços cujos números estão mais perto dos da pergunta.
//
// ⚠️ NEM TODO PROVEDOR SABE FAZER ISSO. A Anthropic não tem endpoint de
// embedding, e o OpenRouter não repassa `/embeddings`. Um workspace que só
// tenha essas duas chaves NÃO indexa nada — e a tela precisa avisar antes,
// não depois.

/** Modelo de embedding pronto pro `embedMany` do AI SDK v6. */
export type EmbeddingModel = EmbeddingModelV3;

/** Os provedores que TÊM endpoint de embedding. */
export const EMBEDDING_PROVIDERS = ["openrouter", "openai", "google"] as const;

export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

/**
 * O contrário: provedor de IA que NÃO sabe indexar documento.
 *
 * ⚠️ O OpenRouter JÁ ESTEVE nesta lista, por engano. O catálogo público deles
 * (420 modelos) não lista NENHUM modelo de embedding, o que dá a impressão de
 * que eles não fazem — mas o endpoint `/embeddings` funciona e devolve 1536
 * dimensões, que é exatamente o que a coluna do banco espera. Conferido ao
 * vivo em 21/08/2026.
 *
 * Isso importa muito pro aluno: com o OpenRouter fora daqui, quem cadastrasse
 * só a chave dele (que é a que a gente recomenda pra começar, justamente por
 * ser uma chave só) ficaria sem base de conhecimento e sem entender por quê.
 */
export const PROVEDORES_SEM_EMBEDDING = ["anthropic"] as const;

export type ProvedorSemEmbedding = (typeof PROVEDORES_SEM_EMBEDDING)[number];

export type EmbeddingCatalogEntry = {
  /** exatamente `${provider}:${providerModelId}` */
  id: ModelId;
  provider: EmbeddingProviderName;
  providerModelId: string;
  label: string;
  /** uma linha em PT-BR coloquial: quando escolher esse */
  description: string;
  /**
   * FIXO EM 1536 nesta versão — é o TIPO da coluna
   * `document_chunks.embedding`, não uma configuração. Modelo que nasce com
   * mais dimensões é truncado pelo próprio provedor (ver `providers.ts`).
   */
  dimensions: 1536;
  /** micro-dólares INTEIROS por 1.000.000 de tokens. US$ 0,02 = 20_000 */
  microsPerMillion: number;
  /** teto de tokens por texto enviado numa chamada */
  maxInputTokens: number;
  /** ISO YYYY-MM-DD em que o preço foi conferido. APARECE NA TELA. */
  pricedAt: string;
  recommended: boolean;
};

/** O que `resolveEmbeddingModel` devolve: modelo pronto + a ficha dele. */
export type ResolvedEmbeddingModel = {
  model: EmbeddingModel;
  modelId: ModelId;
  provider: EmbeddingProviderName;
  entry: EmbeddingCatalogEntry;
  /** de onde veio a chave. Serve pro log, nunca pra tela do aluno. */
  credentialSource: CredentialSource;
};

/**
 * REEXPORTADO, não redeclarado. A única definição de `CredentialSource` no
 * projeto mora em `lib/secrets/types.ts` — ver conflito C7 do contrato.
 */
export type { CredentialSource };
