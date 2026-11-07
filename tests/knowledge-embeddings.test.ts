/**
 * O CATÁLOGO DE EMBEDDING e o formato do vetor.
 *
 * Duas coisas aqui não são configuração, são REGRA DE BANCO — e é isso que
 * este arquivo tranca:
 *
 *   1. **a dimensão é 1536, sempre.** É o TIPO da coluna
 *      `document_chunks.embedding`. Um modelo de 3072 no catálogo faria toda
 *      gravação falhar, com uma mensagem do Postgres que não diz nada;
 *   2. **Anthropic e OpenRouter não entram na lista.** A Anthropic não tem
 *      serviço de embedding e o OpenRouter não repassa o dele.
 *
 * E uma que não é de banco, mas dói igual: **custo desconhecido é `null`,
 * NUNCA 0.** Zero é "custou zero mesmo"; mostrar "US$ 0,00" pra um documento
 * que custou dinheiro é mentir pro aluno.
 *
 * ⚠️ NÃO EXISTE AQUI nenhum teste que quebre sozinho com o tempo (nada de
 * comparar preço com um número fixo que envelhece). Mesma decisão do
 * `tests/ai-catalog.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  calcEmbeddingCostMicros,
  DEFAULT_EMBEDDING_MODEL_ID,
  EMBEDDING_CATALOG,
  getEmbeddingModelEntry,
  listEmbeddingModelsByProvider,
  textoAjudaEmbedding,
} from "@/lib/ai/embeddings";
import { EMBEDDING_PROVIDERS, PROVEDORES_SEM_EMBEDDING } from "@/lib/ai/types";
import { DIMENSOES, emLotes, LOTE_EMBEDDING, vetorParaTexto } from "@/lib/knowledge/embed";

describe("EMBEDDING_CATALOG", () => {
  it("não está vazio e não tem id repetido", () => {
    expect(EMBEDDING_CATALOG.length).toBeGreaterThan(0);
    const ids = EMBEDDING_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("TODO modelo tem 1536 dimensões — é o tipo da coluna", () => {
    for (const e of EMBEDDING_CATALOG) {
      expect(e.dimensions).toBe(1536);
      expect(e.dimensions).toBe(DIMENSOES);
    }
  });

  it("nenhum modelo é de provedor que não sabe indexar", () => {
    const semEmbedding = new Set<string>(PROVEDORES_SEM_EMBEDDING);
    for (const e of EMBEDDING_CATALOG) {
      expect(semEmbedding.has(e.provider)).toBe(false);
      expect(EMBEDDING_PROVIDERS as readonly string[]).toContain(e.provider);
    }
  });

  it("o id é sempre 'provedor:modelo', e as duas metades batem com a ficha", () => {
    for (const e of EMBEDDING_CATALOG) {
      expect(e.id).toBe(`${e.provider}:${e.providerModelId}`);
    }
  });

  it("todo modelo tem preço inteiro, positivo, e a data em que foi conferido", () => {
    for (const e of EMBEDDING_CATALOG) {
      expect(Number.isInteger(e.microsPerMillion)).toBe(true);
      expect(e.microsPerMillion).toBeGreaterThan(0);
      // A data aparece NA TELA de criação de base: ela precisa ser AAAA-MM-DD.
      expect(e.pricedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.label.length).toBeGreaterThan(3);
      expect(e.description.length).toBeGreaterThan(10);
      expect(e.maxInputTokens).toBeGreaterThan(0);
    }
  });

  it("o padrão existe no catálogo e é o mesmo default da coluna do banco", () => {
    expect(getEmbeddingModelEntry(DEFAULT_EMBEDDING_MODEL_ID)).toBeDefined();
    // ⚠️ Este literal é o `default` de `knowledge_bases.embedding_model`, hoje
    // fixado pela migration 20260821090000. Mudou um, muda o outro — senão uma
    // base criada pelo SQL Editor e uma criada pela tela indexariam com
    // modelos diferentes, e a busca de uma não acharia nada da outra.
    expect(DEFAULT_EMBEDDING_MODEL_ID).toBe("openrouter:openai/text-embedding-3-small");
  });

  it("existe exatamente um recomendado, e ele é o padrão", () => {
    const recomendados = EMBEDDING_CATALOG.filter((e) => e.recommended);
    expect(recomendados).toHaveLength(1);
    expect(recomendados[0]?.id).toBe(DEFAULT_EMBEDDING_MODEL_ID);
  });

  it("id fora da lista devolve undefined (nunca um objeto vazio)", () => {
    expect(getEmbeddingModelEntry("openai:modelo-que-nao-existe")).toBeUndefined();
    expect(getEmbeddingModelEntry("")).toBeUndefined();
  });

  it("listEmbeddingModelsByProvider filtra pelo provedor", () => {
    const daOpenai = listEmbeddingModelsByProvider("openai");
    expect(daOpenai.length).toBeGreaterThan(0);
    expect(daOpenai.every((e) => e.provider === "openai")).toBe(true);
  });
});

describe("calcEmbeddingCostMicros", () => {
  it("é micro-dólar INTEIRO e arredonda pra cima", () => {
    const entry = EMBEDDING_CATALOG[0];
    if (!entry) throw new Error("catálogo vazio");

    const um = calcEmbeddingCostMicros(entry.id, 1_000_000);
    expect(um).toBe(entry.microsPerMillion);

    const pouco = calcEmbeddingCostMicros(entry.id, 1);
    expect(pouco).toBe(1); // arredondado pra cima, nunca 0,00002
    expect(Number.isInteger(pouco)).toBe(true);
  });

  it("modelo fora do catálogo devolve `null`, NUNCA 0", () => {
    // 0 significa "custou zero mesmo". `null` é "não sei" — e a tela escreve
    // "preço desconhecido" pra ele.
    expect(calcEmbeddingCostMicros("openai:inexistente", 1_000_000)).toBeNull();
  });

  it("zero token custa zero de verdade", () => {
    const entry = EMBEDDING_CATALOG[0];
    if (!entry) throw new Error("catálogo vazio");
    expect(calcEmbeddingCostMicros(entry.id, 0)).toBe(0);
    expect(calcEmbeddingCostMicros(entry.id, Number.NaN)).toBe(0);
    expect(calcEmbeddingCostMicros(entry.id, -5)).toBe(0);
  });
});

describe("textoAjudaEmbedding", () => {
  it("cita os dois provedores que servem e os dois que não servem", () => {
    const texto = textoAjudaEmbedding();
    expect(texto).toMatch(/OpenAI/);
    expect(texto).toMatch(/Google/);
    expect(texto).toMatch(/Anthropic/);
    expect(texto).toMatch(/OpenRouter/);
    // E diz ONDE resolver — sem isso o aviso não serve pra nada.
    expect(texto).toMatch(/Integrações/);
  });
});

describe("vetorParaTexto — o formato que o Postgres entende", () => {
  it("vira '[a,b,c]' com 6 casas decimais", () => {
    expect(vetorParaTexto([0.1, -0.25, 1])).toBe("[0.100000,-0.250000,1.000000]");
  });

  it("número quebrado (NaN, Infinity) vira 0 em vez de derrubar a gravação", () => {
    // Um `NaN` no meio faria o `::vector` do Postgres recusar o LOTE INTEIRO,
    // com um erro que não aponta pro pedaço culpado.
    expect(vetorParaTexto([Number.NaN, Number.POSITIVE_INFINITY, 0.5])).toBe("[0,0,0.500000]");
  });

  it("vetor vazio vira '[]' (e o banco recusa, que é o certo)", () => {
    expect(vetorParaTexto([])).toBe("[]");
  });
});

describe("emLotes", () => {
  it("quebra em lotes do tamanho pedido, sem perder nem repetir item", () => {
    const itens = Array.from({ length: 70 }, (_, i) => i);
    const lotes = emLotes(itens);

    expect(lotes).toHaveLength(Math.ceil(70 / LOTE_EMBEDDING));
    expect(lotes.flat()).toEqual(itens);
    for (const lote of lotes) {
      expect(lote.length).toBeLessThanOrEqual(LOTE_EMBEDDING);
      expect(lote.length).toBeGreaterThan(0);
    }
  });

  it("lista vazia vira nenhum lote (e não um lote vazio)", () => {
    expect(emLotes([])).toEqual([]);
  });

  it("o lote de 32 cabe com folga no teto de 300 do `append_document_chunks`", () => {
    expect(LOTE_EMBEDDING).toBeLessThanOrEqual(300);
  });
});
