/**
 * A BUSCA — "que trechos dos meus documentos falam disso?"
 *
 * O caminho inteiro, em quatro passos:
 *
 *   1. a pergunta vira números (embedding), com o MESMO modelo que indexou;
 *   2. o banco compara com os pedaços e devolve os mais parecidos;
 *   3. cada trecho volta com a origem (documento e posição);
 *   4. quem chamou mostra pro aluno ou entrega pro modelo.
 *
 * ⚠️ O ISOLAMENTO ENTRE WORKSPACES MORA NO BANCO, NÃO AQUI.
 * `match_document_chunks` é `security definer` (precisa ser, pra usar o índice
 * HNSW sem a RLS reprocessar linha a linha), e ela confere `is_org_member` no
 * `_organization_id` ANTES de responder. O `organizationId` que esta função
 * recebe nunca vem de dado digitado: ele vem do guard da página ou do
 * `ctx.organizationId` da execução.
 *
 * ⚠️ O MODELO DE EMBEDDING SAI DA BASE, NÃO DE UMA CONSTANTE.
 * Cada base grava com que modelo ela foi indexada, e o gatilho
 * `freeze_knowledge_base_slug` congela isso. Perguntar com um modelo e ter
 * indexado com outro devolve trecho ALEATÓRIO — sem erro nenhum aparecendo. É
 * por isso que a busca em "todas as bases" agrupa por modelo (ver abaixo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiConfigError } from "@/lib/ai/errors";
import { resolveEmbeddingModel } from "@/lib/ai/resolve";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";
import { gerarEmbeddings, vetorParaTexto } from "./embed";
import type { KnowledgeSearchHit, KnowledgeSearchResult, OrgScopedKnowledge } from "./types";

/** Quantos trechos a busca devolve por padrão. */
export const LIMITE_PADRAO_DE_BUSCA = 5;

/** Teto duro. O mesmo da função do banco — passar disso é cortado lá. */
export const LIMITE_MAXIMO_DE_BUSCA = 20;

/**
 * O quanto um trecho precisa se parecer com a pergunta pra valer a pena.
 *
 * 0 devolveria SEMPRE 5 trechos, mesmo pra uma pergunta que não tem nada a ver
 * com o documento — e o modelo trataria aquilo como resposta. 0,25 é baixo o
 * suficiente pra não engolir acerto e alto o suficiente pra "não achei nada"
 * existir de verdade.
 */
export const SIMILARIDADE_MINIMA_PADRAO = 0.25;

function limitarLimite(n: number | undefined): number {
  const bruto = Number.isFinite(n) ? Math.trunc(n as number) : LIMITE_PADRAO_DE_BUSCA;
  return Math.max(1, Math.min(bruto, LIMITE_MAXIMO_DE_BUSCA));
}

function limitarSimilaridade(n: number | undefined): number {
  if (!Number.isFinite(n)) return SIMILARIDADE_MINIMA_PADRAO;
  return Math.max(0, Math.min(n as number, 1));
}

/**
 * Espera uma consulta e garante que, se ela LEVANTAR, o que sai daqui é uma
 * frase em português.
 *
 * Por que existe: todo erro levantado por esta pasta pode chegar em duas
 * telas — a de "Testar busca" e o rastro da execução do agente (a ferramenta
 * `buscar-na-base` repassa a frase). Erro de rede do `fetch` não tem frase
 * nenhuma; sem isto, o aluno leria "TypeError: fetch failed".
 */
async function tentar<T>(
  consulta: PromiseLike<T>,
  ondeNoRegistro: string,
  mensagemLeiga: string,
): Promise<T> {
  try {
    return await consulta;
  } catch (err) {
    logError(ondeNoRegistro, err);
    throw new Error(mensagemLeiga);
  }
}

/**
 * Procura trechos parecidos com a pergunta.
 *
 * `baseSlug` vazio = procura em TODAS as bases do workspace.
 *
 * LANÇA `Error` com frase JÁ EM PT-BR quando não dá pra buscar (sem chave de
 * embedding, base que não existe, banco fora do ar). Quem chama decide o que
 * fazer: a função do servidor vira `{ ok: false, error }`, a ferramenta vira
 * `falhaDeFerramenta(...)`.
 */
export async function searchKnowledgeBase(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  baseSlug: string | null;
  query: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<KnowledgeSearchResult> {
  const pergunta = typeof params.query === "string" ? params.query.trim() : "";
  if (pergunta.length < 2) {
    throw new Error("Escreva a pergunta com pelo menos duas letras.");
  }
  // Pergunta gigante custa dinheiro e não melhora a busca: o que importa é o
  // assunto, e ele já está nas primeiras linhas.
  const perguntaCortada = pergunta.slice(0, 2000);

  // 1. Qual base? E, principalmente, indexada com QUAL modelo.
  //
  // ⚠️ O `try` NÃO é decoração. O cliente do Supabase devolve `{ data, error }`
  // pra erro do banco, mas LEVANTA quando a rede cai — e a ferramenta
  // `buscar-na-base` repassa a frase do erro pro modelo e pro rastro que o
  // aluno lê. Sem isto, um problema de rede apareceria como "fetch failed" na
  // tela de quem não programa.
  const consultaDasBases = await tentar(
    params.supabase
      .from("knowledge_bases")
      .select("id, slug, name, embedding_model")
      .eq("organization_id", params.organizationId)
      // Base APOSENTADA nao entra na busca do agente. O que ja foi indexado
      // continua no banco -- so para de ser consultado.
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    "knowledge.searchKnowledgeBase.bases",
    "Não deu pra abrir as bases de conhecimento agora. Tente de novo.",
  );
  const { data: bases, error: erroDasBases } = consultaDasBases;

  if (erroDasBases) {
    logError("knowledge.searchKnowledgeBase.bases", erroDasBases);
    throw new Error("Não deu pra abrir as bases de conhecimento agora. Tente de novo.");
  }

  const todas = bases ?? [];
  if (todas.length === 0) {
    // ⚠️ Esta frase é lida pelo MODELO e vai parar no rastro que o aluno lê, e
    // ela não pode mandar clicar num botão que não existe: base nasce de
    // arquivo (regra 10-N), não de tela. "Nenhuma base ATIVA" também cobre o
    // caso de todas estarem aposentadas — daí a segunda frase.
    throw new Error(
      "Este workspace não tem nenhuma base de conhecimento ativa. Peça pro Claude Code " +
        "declarar uma (e, se alguma estiver aposentada, declarar ela como ativa de novo).",
    );
  }

  const escolhidas = params.baseSlug
    ? todas.filter((b) => b.slug === params.baseSlug)
    : // ⚠️ SEM base escolhida, procura só nas que usam o modelo da PRIMEIRA
      // base. Comparar vetores de modelos diferentes devolve trecho aleatório
      // — e como o modelo é congelado por base, misturar não tem conserto.
      todas.filter((b) => b.embedding_model === todas[0]?.embedding_model);

  if (escolhidas.length === 0) {
    throw new Error("Não achei essa base de conhecimento neste workspace.");
  }

  const modeloDaBase = escolhidas[0]?.embedding_model ?? "";

  // 2. A pergunta vira números — com o modelo da base, nunca com um padrão.
  let vetor: string;
  try {
    const modelo = await resolveEmbeddingModel({
      modelId: modeloDaBase,
      organizationId: params.organizationId,
      supabase: params.supabase,
    });
    const lote = await gerarEmbeddings({ modelo, textos: [perguntaCortada] });
    const primeiro = lote.vetores[0];
    if (!primeiro) throw new Error("embedding vazio");
    vetor = vetorParaTexto(primeiro);

    // TRANSFORMAR A PERGUNTA EM NÚMEROS CUSTA DINHEIRO, E ISSO TEM QUE ENTRAR
    // NO MEDIDOR.
    //
    // É pouco por busca — centavos de centavo. Mas um agente com esta
    // ferramenta busca a cada volta do laço, e uma automação que roda de hora
    // em hora busca o dia inteiro. Antes esse custo era calculado (o
    // `gerarEmbeddings` devolve `costMicros`) e jogado fora: o único gasto do
    // template que o teto não enxergava.
    // Manda os TOKENS, não o valor: quem calcula é o banco. Mandar o valor
    // pronto significaria que qualquer pessoa logada poderia somar um número
    // gigante no medidor e travar os agentes do workspace inteiro.
    if (lote.tokens > 0) {
      const { error: erroDoMedidor } = await params.supabase.rpc("org_ai_spend_add_embedding", {
        _organization_id: params.organizationId,
        _tokens: lote.tokens,
      });
      if (erroDoMedidor) logError("knowledge.searchKnowledgeBase.medidor", erroDoMedidor);
    }
  } catch (err) {
    if (isAiConfigError(err)) {
      logError("knowledge.searchKnowledgeBase.modelo", err);
      throw new Error(err.mensagemLeiga);
    }
    logError("knowledge.searchKnowledgeBase.embedding", err);
    throw new Error(
      "Não deu pra entender a pergunta agora — o serviço de IA não respondeu. Tente de novo.",
    );
  }

  // 3. O banco compara. É ele quem confere o pertencimento ao workspace.
  const busca = await tentar(
    params.supabase.rpc("match_document_chunks", {
      _organization_id: params.organizationId,
      _knowledge_base_id: params.baseSlug ? escolhidas[0]?.id : undefined,
      _embedding: vetor,
      _limite: limitarLimite(params.limit),
      _min_similarity: limitarSimilaridade(params.minSimilarity),
    }),
    "knowledge.searchKnowledgeBase.match",
    "Não deu pra procurar nos documentos agora. Tente de novo.",
  );
  const { data, error } = busca;

  if (error) {
    logError("knowledge.searchKnowledgeBase.match", error);
    throw new Error("Não deu pra procurar nos documentos agora. Tente de novo.");
  }

  // ⚠️ SEGUNDA CAMADA (a primeira é a função do banco): quando a busca foi em
  // "todas as bases", derruba o que não estiver na lista de bases do mesmo
  // modelo. Sem isto, uma base criada com outro modelo apareceria misturada.
  const idsAceitos = new Set(escolhidas.map((b) => b.id));
  const hits: KnowledgeSearchHit[] = (data ?? [])
    .filter((linha) => idsAceitos.has(linha.knowledge_base_id))
    .map((linha) => ({
      chunkId: linha.chunk_id,
      documentId: linha.document_id,
      documentTitle: linha.document_title,
      seq: linha.seq,
      content: linha.content,
      similarity: linha.similarity,
    }));

  const base = params.baseSlug ? escolhidas[0] : null;

  return {
    base: base ? { id: base.id, slug: base.slug, name: base.name } : null,
    hits,
  };
}

/**
 * A base de conhecimento vista de DENTRO de uma ferramenta de agente.
 *
 * MESMO ESPÍRITO DO `createOrgScopedDb`: uma capacidade nomeada e estreita,
 * presa a um workspace. Quem escreve a ferramenta não recebe `supabase`, não
 * recebe `organizationId` e não tem por onde pedir a base de outro workspace —
 * não existe parâmetro pra isso.
 */
export function createOrgScopedKnowledge(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): OrgScopedKnowledge {
  // A mesma trava do `createOrgScopedDb`: id torto vira erro AGORA, e não uma
  // consulta esquisita mais tarde.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    throw new Error("createOrgScopedKnowledge: organizationId inválido");
  }

  return {
    async listBases() {
      const { data, error } = await tentar(
        supabase
          .from("knowledge_bases")
          .select("id, slug, name, description")
          .eq("organization_id", organizationId)
          // Mesma regra da busca: aposentada nao aparece pro agente.
          .eq("status", "active")
          .order("name", { ascending: true })
          .limit(50),
        "knowledge.listBases",
        "Não deu pra abrir as bases de conhecimento agora.",
      );

      if (error) {
        logError("knowledge.listBases", error);
        throw new Error("Não deu pra abrir as bases de conhecimento agora.");
      }
      return data ?? [];
    },

    search(p) {
      return searchKnowledgeBase({
        supabase,
        organizationId,
        baseSlug: p.baseSlug ?? null,
        query: p.query,
        limit: p.limit,
        minSimilarity: p.minSimilarity,
      });
    },
  };
}
