/**
 * A fábrica de modelos — o ÚNICO arquivo do projeto que importa `@ai-sdk/*`.
 *
 * Manter isso num arquivo só tem um motivo prático: quando o AI SDK mudar de
 * versão, existe UM lugar pra ajustar. Nenhuma ferramenta, nenhuma tela e
 * nenhuma função do servidor deve importar um adapter direto.
 *
 * ESTA FUNÇÃO É PURA E SÍNCRONA. Ela recebe a chave JÁ decifrada e devolve o
 * modelo. Ela não fala com o cofre e não chama `headers()` do Next — porque na
 * onda 4 o trabalhador da fila roda FORA de uma requisição, e qualquer coisa
 * que dependa de requisição quebraria lá.
 *
 * SEM CACHE, de propósito. A chave é POR WORKSPACE: um cache global de
 * instância de modelo faria o workspace B usar a chave do workspace A.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { appConfig } from "@/config/app.config";
import { appUrlFromEnv } from "@/lib/env";
import type { AiProviderName, EmbeddingModel, EmbeddingProviderName, LanguageModel } from "./types";

export type { EmbeddingModel } from "./types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Cabeçalhos que o OpenRouter usa pra creditar o app no ranking dele. São
 * opcionais e não secretos.
 *
 * ⚠️ Aqui vai `appUrlFromEnv()`, NUNCA `getAppUrl()`: o segundo lê os
 * cabeçalhos da requisição, e esta função também roda fora de requisição.
 * Quando `APP_URL` não está preenchida, o cabeçalho simplesmente não vai.
 */
function cabecalhosDoOpenRouter(): Record<string, string> {
  const cabecalhos: Record<string, string> = { "X-Title": appConfig.name };
  const url = appUrlFromEnv();
  if (url) cabecalhos["HTTP-Referer"] = url;
  return cabecalhos;
}

export type BuildLanguageModelInput = {
  provider: AiProviderName;
  /** o apelido do modelo DENTRO do provedor — sem o "provedor:" na frente */
  providerModelId: string;
  /** já decifrada; só existe na memória do servidor */
  apiKey: string;
};

/** Cria a instância do modelo pronta pro `generateText` / `streamText`. */
export function buildLanguageModel(input: BuildLanguageModelInput): LanguageModel {
  const { provider, providerModelId, apiKey } = input;

  switch (provider) {
    case "openrouter": {
      // O OpenRouter fala a mesma API de chat da OpenAI, então dá pra usar o
      // adapter da OpenAI apontado pra outra baseURL — zero dependência nova.
      const or = createOpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
        name: "openrouter",
        headers: cabecalhosDoOpenRouter(),
      });

      // ⚠️ `.chat()` É OBRIGATÓRIO AQUI, e trocar por `or(id)` quebra TUDO.
      // O jeito padrão de chamar o adapter da OpenAI v3 usa a Responses API
      // (POST /responses), que o OpenRouter NÃO implementa: toda chamada
      // voltaria 404 com uma mensagem genérica de erro do provedor.
      return or.chat(providerModelId);
    }

    case "openai": {
      // Direto com a OpenAI o caminho padrão do adapter (Responses API) é o
      // recomendado pela própria OpenAI e é o que o SDK suporta melhor.
      const openai = createOpenAI({ apiKey });
      return openai(providerModelId);
    }

    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(providerModelId);
    }

    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(providerModelId);
    }
  }
}

// ---------------------------------------------------------------------------
// Embedding — a mesma fábrica, pro outro tipo de modelo
// ---------------------------------------------------------------------------

export type BuildEmbeddingModelInput = {
  provider: EmbeddingProviderName;
  /** o apelido do modelo DENTRO do provedor — sem o "provedor:" na frente */
  providerModelId: string;
  /** já decifrada; só existe na memória do servidor */
  apiKey: string;
};

/**
 * Cria a instância do modelo de embedding pronta pro `embedMany` do AI SDK.
 *
 * ⚠️ SÓ EXISTEM DOIS CASOS AQUI, E ISSO É DE PROPÓSITO. A Anthropic não tem
 * endpoint de embedding e o OpenRouter não repassa `/embeddings` — quem tentar
 * acrescentar um `case` pra eles vai descobrir isso em produção, com o
 * documento parado em "Falhou". O tipo `EmbeddingProviderName` já barra na
 * compilação.
 *
 * ⚠️ A DIMENSÃO DE SAÍDA É DECIDIDA AQUI, e ela não é negociável: a coluna
 * `document_chunks.embedding` é `vector(1536)`. Um vetor de tamanho diferente
 * é RECUSADO pelo Postgres na hora de gravar — e o erro seria "expected 1536
 * dimensions, not 3072", que não diz nada pra um leigo. Por isso os modelos
 * que nascem com 3072 já saem truncados daqui.
 *
 * Os dois provedores fazem esse corte do lado deles, e os dois usam
 * "Matryoshka" (o vetor curto é um prefixo bem-comportado do longo), então
 * truncar não estraga a busca.
 */
export function buildEmbeddingModel(input: BuildEmbeddingModelInput): EmbeddingModel {
  const { provider, providerModelId, apiKey } = input;

  switch (provider) {
    case "openrouter": {
      // O OpenRouter fala a mesma API da OpenAI também aqui: o endpoint
      // `/embeddings` existe e devolve 1536 dimensões (conferido ao vivo em
      // 21/08/2026). O catálogo público deles não lista modelo de embedding
      // nenhum, o que engana — mas o endpoint funciona.
      const viaOpenRouter = createOpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
        name: "openrouter",
        headers: cabecalhosDoOpenRouter(),
      });
      return viaOpenRouter.embedding(providerModelId);
    }

    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai.embedding(providerModelId);
    }

    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google.embedding(providerModelId);
    }
  }
}

/**
 * As opções que precisam viajar JUNTO com o pedido de embedding pra o vetor
 * sair com 1536 números.
 *
 * Fica aqui (e não em `embed.ts`) porque é conhecimento sobre o SDK do
 * provedor, e este é o único arquivo do projeto que pode ter isso. Quem chama
 * repassa o objeto inteiro pro `embedMany` sem saber o que tem dentro.
 *
 * - OpenAI: `dimensions` é aceito pelos modelos da família `3`. Mandar 1536
 *   pro `3-small` (que já nasce com 1536) é inofensivo.
 * - Google: o parâmetro chama `outputDimensionality`, e sem ele o
 *   `gemini-embedding-001` devolve 3072.
 */
export function opcoesDeEmbedding(
  provider: EmbeddingProviderName,
  dimensions: number,
): Record<string, Record<string, number>> {
  switch (provider) {
    // O OpenRouter repassa o pedido pra OpenAI, então a opção é a mesma dela.
    case "openrouter":
      return { openai: { dimensions } };
    case "openai":
      return { openai: { dimensions } };
    case "google":
      return { google: { outputDimensionality: dimensions } };
  }
}
