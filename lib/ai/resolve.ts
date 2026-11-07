/**
 * O PONTO DE ENTRADA de todo mundo que quer falar com um modelo.
 *
 * Junta as três peças, nesta ordem:
 *
 *   1. o CATÁLOGO  — o modelo existe? qual é o preço e o limite dele?
 *   2. o COFRE     — tem chave pra esse provedor? (workspace → plataforma → env)
 *   3. a FÁBRICA   — monta a instância do modelo com aquela chave
 *
 * Ninguém deve pular esse caminho. É por isso que `buildLanguageModel` NÃO é
 * exportado pelo `index.ts` da pasta: quem chamasse a fábrica direto teria que
 * arranjar a chave por conta própria, e é exatamente aí que alguém acaba
 * lendo `process.env` no lugar errado.
 *
 * ⚠️ ESTE ARQUIVO FALA COM O BANCO (pelo cofre). Não importe ele de um
 * componente com "use client". Numa tela, importe `@/lib/ai/catalog`,
 * `@/lib/ai/model-id` ou `@/lib/ai/types`, que são puros.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCredentialSources, resolveApiKey } from "@/lib/secrets";
import { getProviderInfo } from "@/lib/secrets/providers";
import type { Database } from "@/types/supabase";
import { getModel } from "./catalog";
import { getEmbeddingModelEntry, textoAjudaEmbedding } from "./embeddings";
import { AiConfigError } from "./errors";
import { parseModelId } from "./model-id";
import { buildEmbeddingModel, buildLanguageModel } from "./providers";
import {
  AI_PROVIDERS,
  type AiProviderName,
  EMBEDDING_PROVIDERS,
  type EmbeddingProviderName,
  type ResolvedEmbeddingModel,
  type ResolvedModel,
  type ResolveModelInput,
} from "./types";

export type { ResolveModelInput } from "./types";

/**
 * Modelo pronto pra usar, com a chave certa daquele workspace.
 *
 * LANÇA `AiConfigError` em qualquer falha de CONFIGURAÇÃO (id torto, modelo
 * fora do catálogo, nenhuma chave cadastrada) — e o `mensagemLeiga` dele já
 * vem pronto pra jogar na tela. NÃO lança erro de rede nem de cota do
 * provedor: isso só aparece quando o motor chama `generateText`/`streamText`.
 *
 * Identificador fora do catálogo é RECUSADO, sem exceção. Não existe modo
 * "aceita qualquer modelo": no bloco 1 não existe campo de texto livre pra
 * modelo (o editor usa uma lista), e aceitar um id desconhecido desligaria o
 * cálculo de custo em silêncio.
 */
export async function resolveModel(input: ResolveModelInput): Promise<ResolvedModel> {
  const { provider, providerModelId, id } = parseModelId(input.modelId);

  const entry = getModel(id);
  if (!entry) {
    throw new AiConfigError(
      "modelo-desconhecido",
      "Esse modelo não está mais na lista do app. Abra o agente, escolha outro modelo " +
        "na lista e salve.",
      `modelo fora do MODEL_CATALOG: ${id.slice(0, 120)}`,
      provider,
    );
  }

  const credencial = await resolveApiKey(provider, {
    organizationId: input.organizationId,
    supabase: input.supabase,
  });
  if (!credencial) {
    const info = getProviderInfo(provider);
    throw new AiConfigError(
      "credencial-ausente",
      `Falta cadastrar a chave do ${info.label} pra usar esse modelo. ` +
        "Abra Configurações → Integrações e cole a chave " +
        `(${info.keyHint.toLowerCase()}). Se você não tiver uma, pegue em ${info.helpUrl}.`,
      `sem credencial para ${provider} (organizationId=${input.organizationId ?? "plataforma"})`,
      provider,
    );
  }

  return {
    model: buildLanguageModel({ provider, providerModelId, apiKey: credencial.apiKey }),
    modelId: entry.id,
    provider,
    entry,
    credentialSource: credencial.source,
  };
}

/**
 * Quais provedores de IA esse escopo consegue usar AGORA.
 *
 * A ordem é sempre a de `AI_PROVIDERS` — estável, então a tela não fica
 * dançando entre um carregamento e outro. O `resend` fica de fora: ele é envio
 * de email, não IA.
 *
 * Uma consulta só cobre os quatro provedores (por baixo é a mesma chamada que
 * a tela de Integrações usa), e nenhum segredo é aberto no caminho.
 */
export async function listConfiguredAiProviders(
  organizationId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<AiProviderName[]> {
  const origens = await getCredentialSources(organizationId, supabase);
  return AI_PROVIDERS.filter((p) => origens[p] !== null);
}

/**
 * Dá pra usar IA nesse escopo hoje? Substitui o antigo `hasLLMConfigured()`,
 * que só olhava variável de ambiente e não enxergava as telas de chave.
 */
export async function hasAnyAiCredential(
  organizationId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const provedores = await listConfiguredAiProviders(organizationId, supabase);
  return provedores.length > 0;
}

// ---------------------------------------------------------------------------
// Embedding — o mesmo caminho, pro modelo que lê documento
// ---------------------------------------------------------------------------

/**
 * Modelo de embedding pronto pra usar, com a chave certa daquele workspace.
 *
 * LANÇA `AiConfigError` em qualquer falha de configuração, e o
 * `mensagemLeiga` dele já vem pronto pra jogar na tela. São três casos, e cada
 * um tem uma frase diferente de propósito:
 *
 *  • `modelo-desconhecido`      — a base aponta pra um modelo que saiu da lista
 *  • `provedor-sem-embedding`   — o workspace TEM chave, mas só de quem não
 *                                 sabe indexar (Anthropic, OpenRouter)
 *  • `credencial-ausente`       — não tem chave nenhuma daquele provedor
 *
 * ⚠️ O SEGUNDO CASO É O QUE MAIS ACONTECE NA VIDA REAL, e é o que não pode
 * aparecer como "model not found" pro aluno. Ver o risco 14 do contrato.
 */
export async function resolveEmbeddingModel(input: {
  modelId: string;
  organizationId: string | null;
  supabase: SupabaseClient<Database>;
}): Promise<ResolvedEmbeddingModel> {
  const entry = getEmbeddingModelEntry(input.modelId);
  if (!entry) {
    // Cai aqui quando alguém apagou um modelo do catálogo e uma base antiga
    // continua apontando pra ele. Como o modelo da base é CONGELADO por
    // gatilho, o conserto é criar outra base — e a frase precisa dizer isso.
    throw new AiConfigError(
      "modelo-desconhecido",
      "Essa base de conhecimento foi criada com um jeito de indexar que o app não usa mais. " +
        "Crie outra base e suba os arquivos nela.",
      `modelo fora do EMBEDDING_CATALOG: ${String(input.modelId).slice(0, 120)}`,
    );
  }

  const credencial = await resolveApiKey(entry.provider, {
    organizationId: input.organizationId,
    supabase: input.supabase,
  });

  if (!credencial) {
    // Antes de dizer "cadastre a chave X", vale conferir se a pessoa já tem
    // ALGUMA chave de IA: se tiver, o problema não é falta de chave — é que a
    // chave dela não sabe fazer isso, e a frase muda completamente.
    const comChave = await listConfiguredAiProviders(input.organizationId, input.supabase);
    const soTemQuemNaoIndexa =
      comChave.length > 0 &&
      !comChave.some((p) => (EMBEDDING_PROVIDERS as readonly string[]).includes(p));

    if (soTemQuemNaoIndexa) {
      throw new AiConfigError(
        "provedor-sem-embedding",
        textoAjudaEmbedding(),
        `workspace só tem provedor sem embedding: ${comChave.join(",")}`,
        entry.provider,
      );
    }

    const info = getProviderInfo(entry.provider);
    throw new AiConfigError(
      "credencial-ausente",
      `Falta cadastrar a chave do ${info.label} pra ler os seus documentos. ` +
        "Abra Configurações → Integrações e cole a chave " +
        `(${info.keyHint.toLowerCase()}). Se você não tiver uma, pegue em ${info.helpUrl}.`,
      `sem credencial para ${entry.provider} (organizationId=${input.organizationId ?? "plataforma"})`,
      entry.provider,
    );
  }

  return {
    model: buildEmbeddingModel({
      provider: entry.provider,
      providerModelId: entry.providerModelId,
      apiKey: credencial.apiKey,
    }),
    modelId: entry.id,
    provider: entry.provider,
    entry,
    credentialSource: credencial.source,
  };
}

/**
 * Quais provedores desse escopo sabem INDEXAR documento hoje.
 *
 * É `listConfiguredAiProviders` cruzado com `EMBEDDING_PROVIDERS`: ter chave
 * da Anthropic não ajuda em nada aqui.
 */
export async function listEmbeddingCapableProviders(
  organizationId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<EmbeddingProviderName[]> {
  const comChave = await listConfiguredAiProviders(organizationId, supabase);
  return EMBEDDING_PROVIDERS.filter((p) => comChave.includes(p));
}

/** Dá pra criar base de conhecimento nesse escopo hoje? */
export async function hasEmbeddingCredential(
  organizationId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const provedores = await listEmbeddingCapableProviders(organizationId, supabase);
  return provedores.length > 0;
}
