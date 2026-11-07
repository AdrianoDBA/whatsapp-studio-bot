/**
 * O catálogo de modelos.
 *
 * O CATÁLOGO É CÓDIGO, NÃO TABELA DO BANCO. Ele muda quando sai uma versão
 * nova do template, não quando um workspace mexe em alguma coisa. Isso é de
 * propósito: preço e limite de modelo são a mesma informação pra todo mundo, e
 * guardar isso por inquilino só criaria 300 cópias desatualizadas.
 *
 * PREÇO É INTEIRO, EM MICRO-DÓLARES POR 1 MILHÃO DE TOKENS.
 * US$ 5,00 por 1M de tokens = `5_000_000`. Nada de float em lugar nenhum — do
 * catálogo até `agent_runs.cost_micros`. Ver `cost.ts`.
 *
 * ⚠️ PREÇO ENVELHECE. Os 15 preços aqui foram conferidos ao vivo em
 * 20/08/2026 (`GET https://openrouter.ai/api/v1/models` e a tabela oficial da
 * Anthropic). O campo `pricedAt` de cada linha aparece NA TELA do seletor de
 * modelo, então o aluno VÊ que a conferência é de tal dia. De propósito não
 * existe teste que quebre sozinho com o tempo: um aluno que clonar o template
 * daqui a sete meses não pode tomar `npm run verify` vermelho por um motivo
 * que ele não tem como consertar.
 *
 * ORDEM DA LISTA: recomendados primeiro, e dentro de cada bloco do mais barato
 * pro mais caro (somando entrada + saída). `tests/ai-catalog.test.ts` cobra
 * essa ordem — a tela mostra a lista na ordem em que ela está aqui.
 *
 * Arquivo PURO: pode ser importado por página, por componente com "use client"
 * e por teste.
 */
import type { AiProviderName, ModelCatalogEntry, ModelId } from "./types";

/** Data em que os preços deste arquivo foram conferidos. Aparece na tela. */
const CONFERIDO_EM = "2026-08-20";

/** A maioria dos modelos daqui faz tudo. Atalho pra não repetir 15 vezes. */
const COMPLETO = { tools: true, images: true, structuredOutput: true } as const;

/** Sem entrada de imagem (modelo só de texto). */
const SO_TEXTO = { tools: true, images: false, structuredOutput: true } as const;

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  // ---------------------------------------------------------------------------
  // Recomendados — do mais barato pro mais caro
  // ---------------------------------------------------------------------------
  {
    id: "openrouter:openai/gpt-5.6-luna",
    provider: "openrouter",
    providerModelId: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna (via OpenRouter)",
    description: "O modelo rápido e barato da OpenAI, pago pela sua conta do OpenRouter.",
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 200_000,
    outputMicrosPerMillion: 1_200_000,
    capabilities: COMPLETO,
    tier: "economico",
    recommended: true,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "openai:gpt-5.6-luna",
    provider: "openai",
    providerModelId: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Rápido e barato, direto com a OpenAI. Bom padrão pra conversa e resumo.",
    contextWindow: 922_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 200_000,
    outputMicrosPerMillion: 1_200_000,
    capabilities: COMPLETO,
    tier: "economico",
    recommended: true,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "openrouter:google/gemini-3.7-flash",
    provider: "openrouter",
    providerModelId: "google/gemini-3.7-flash",
    label: "Gemini 3.7 Flash (via OpenRouter)",
    description:
      "Rápido, aceita conversa gigante e sai barato. É com ele que todo agente novo nasce.",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputMicrosPerMillion: 375_000,
    outputMicrosPerMillion: 1_875_000,
    capabilities: COMPLETO,
    tier: "equilibrado",
    recommended: true,
    pricedAt: CONFERIDO_EM,
    pricingNote:
      "No OpenRouter esse modelo está pela metade do preço do Google direto " +
      "(conferido em 20/08/2026). Pode subir sem aviso.",
  },
  {
    id: "google:gemini-3.5-flash-lite",
    provider: "google",
    providerModelId: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    description: "O mais barato do Google. Serve pra tarefa simples e repetitiva, em volume.",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputMicrosPerMillion: 300_000,
    outputMicrosPerMillion: 2_500_000,
    capabilities: COMPLETO,
    tier: "economico",
    recommended: true,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "google:gemini-3.7-flash",
    provider: "google",
    providerModelId: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    description: "Rápido e esperto, direto com o Google. Aceita conversa muito longa.",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputMicrosPerMillion: 750_000,
    outputMicrosPerMillion: 3_750_000,
    capabilities: COMPLETO,
    tier: "equilibrado",
    recommended: true,
    pricedAt: CONFERIDO_EM,
    pricingNote: "Preço promocional. Confira em ai.google.dev antes de contar com ele.",
  },
  {
    id: "anthropic:claude-haiku-4-5",
    provider: "anthropic",
    providerModelId: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "O Claude rápido e barato. Bom pra classificar, extrair e responder curto.",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputMicrosPerMillion: 1_000_000,
    outputMicrosPerMillion: 5_000_000,
    capabilities: COMPLETO,
    tier: "economico",
    recommended: true,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "openrouter:anthropic/claude-sonnet-5",
    provider: "openrouter",
    providerModelId: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5 (via OpenRouter)",
    description: "O Claude do dia a dia, pago pela sua conta do OpenRouter.",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 2_000_000,
    outputMicrosPerMillion: 10_000_000,
    capabilities: COMPLETO,
    tier: "avancado",
    recommended: true,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "openai:gpt-5.6-terra",
    provider: "openai",
    providerModelId: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "O GPT grande. Use quando a tarefa é difícil e vale pagar mais pela resposta.",
    contextWindow: 922_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 2_000_000,
    outputMicrosPerMillion: 12_000_000,
    capabilities: COMPLETO,
    tier: "avancado",
    recommended: true,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "anthropic:claude-sonnet-5",
    provider: "anthropic",
    providerModelId: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "O Claude do dia a dia, direto com a Anthropic. Escreve e raciocina muito bem.",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 3_000_000,
    outputMicrosPerMillion: 15_000_000,
    capabilities: COMPLETO,
    tier: "avancado",
    recommended: true,
    pricedAt: CONFERIDO_EM,
    pricingNote:
      "Preço de tabela. Até 31/08/2026 a Anthropic cobra US$ 2 / US$ 10 por 1M — " +
      "a conta real pode sair MENOR que a estimativa.",
  },

  // ---------------------------------------------------------------------------
  // Os outros — do mais barato pro mais caro
  // ---------------------------------------------------------------------------
  {
    id: "openrouter:deepseek/deepseek-v4-flash",
    provider: "openrouter",
    providerModelId: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash (via OpenRouter)",
    description:
      "O mais barato da lista, com folga. Bom pra volume grande de texto simples; " +
      "não aceita imagem.",
    contextWindow: 1_048_576,
    maxOutputTokens: 384_000,
    inputMicrosPerMillion: 75_600,
    outputMicrosPerMillion: 151_200,
    capabilities: SO_TEXTO,
    tier: "economico",
    recommended: false,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "openai:gpt-5.4-mini",
    provider: "openai",
    providerModelId: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    description: "Geração anterior da OpenAI. Está aqui pra quem já tinha um agente usando ele.",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 750_000,
    outputMicrosPerMillion: 4_500_000,
    capabilities: COMPLETO,
    tier: "equilibrado",
    recommended: false,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "openrouter:openai/gpt-5.6-terra",
    provider: "openrouter",
    providerModelId: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra (via OpenRouter)",
    description: "O GPT grande, pago pela sua conta do OpenRouter.",
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 2_000_000,
    outputMicrosPerMillion: 12_000_000,
    capabilities: COMPLETO,
    tier: "avancado",
    recommended: false,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "google:gemini-3.1-pro-preview",
    provider: "google",
    providerModelId: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (prévia)",
    description:
      "O Gemini grande, ainda em prévia. Aguenta prompt gigante, mas cobra o dobro quando " +
      "a conversa passa de 200 mil tokens.",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputMicrosPerMillion: 2_000_000,
    outputMicrosPerMillion: 12_000_000,
    longContextPricing: {
      thresholdTokens: 200_000,
      inputMicrosPerMillion: 4_000_000,
      outputMicrosPerMillion: 18_000_000,
    },
    capabilities: COMPLETO,
    tier: "avancado",
    recommended: false,
    pricedAt: CONFERIDO_EM,
    pricingNote: "Prompt acima de 200 mil tokens custa o dobro.",
  },
  {
    id: "openrouter:anthropic/claude-opus-5",
    provider: "openrouter",
    providerModelId: "anthropic/claude-opus-5",
    label: "Claude Opus 5 (via OpenRouter)",
    description: "O Claude mais forte (e mais caro), pago pela sua conta do OpenRouter.",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 5_000_000,
    outputMicrosPerMillion: 25_000_000,
    capabilities: COMPLETO,
    tier: "avancado",
    recommended: false,
    pricedAt: CONFERIDO_EM,
  },
  {
    id: "anthropic:claude-opus-5",
    provider: "anthropic",
    providerModelId: "claude-opus-5",
    label: "Claude Opus 5",
    description: "O Claude mais forte da Anthropic. Caro: use só quando os outros não derem conta.",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputMicrosPerMillion: 5_000_000,
    outputMicrosPerMillion: 25_000_000,
    capabilities: COMPLETO,
    tier: "avancado",
    recommended: false,
    pricedAt: CONFERIDO_EM,
  },
];

/**
 * O modelo com que todo agente novo nasce, e o padrão do `_TEMPLATE_agente`.
 *
 * É uma CONSTANTE (não uma função que consulta o cofre) porque o Zod e o
 * `insert` do painel precisam de um valor síncrono. Quando o aluno não tem
 * chave do OpenRouter, quem escolhe algo melhor é o `pickDefaultModelId`.
 */
export const DEFAULT_MODEL_ID: ModelId = "openrouter:google/gemini-3.7-flash";

/** Índice por id, montado uma vez só no carregamento do módulo. */
const POR_ID = new Map<string, ModelCatalogEntry>(MODEL_CATALOG.map((m) => [m.id, m]));

/** A ficha do modelo, ou null quando o id não está no catálogo. Nunca lança. */
export function getModel(id: ModelId): ModelCatalogEntry | null {
  return POR_ID.get(id) ?? null;
}

export function isKnownModelId(id: string): boolean {
  return POR_ID.has(id);
}

/** Todos, na ordem do catálogo (ver o comentário do topo). */
export function listModels(): readonly ModelCatalogEntry[] {
  return MODEL_CATALOG;
}

export function listModelsByProvider(provider: AiProviderName): readonly ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

/**
 * Ordem de preferência quando o app precisa escolher sozinho. Cada provedor
 * aponta pro modelo que é o melhor "padrão bom" dentro dele.
 */
const PADRAO_POR_PROVEDOR: ReadonlyArray<{ provider: AiProviderName; modelId: ModelId }> = [
  { provider: "openrouter", modelId: "openrouter:google/gemini-3.7-flash" },
  { provider: "google", modelId: "google:gemini-3.7-flash" },
  { provider: "openai", modelId: "openai:gpt-5.6-luna" },
  { provider: "anthropic", modelId: "anthropic:claude-haiku-4-5" },
];

/**
 * Escolhe um padrão sensato entre os provedores que TÊM chave hoje.
 *
 * O OpenRouter vem primeiro porque é a chave que dá acesso a todos os modelos
 * de uma vez — é o caminho que menos trava o aluno.
 *
 * Devolve null quando a lista está vazia (aí a tela diz "cadastre uma chave").
 */
export function pickDefaultModelId(providersComChave: readonly AiProviderName[]): ModelId | null {
  for (const candidato of PADRAO_POR_PROVEDOR) {
    if (providersComChave.includes(candidato.provider)) return candidato.modelId;
  }
  return null;
}
