/**
 * A PROVA DE ISOLAMENTO ENTRE WORKSPACES — a base de conhecimento.
 *
 * Uma pergunta só: **quem está no workspace A consegue, de algum jeito, ler
 * trecho de documento do workspace B?**
 *
 * A resposta precisa ser NÃO inclusive quando quem chama passa o apelido certo
 * de uma base do outro workspace — porque apelido de base aparece na URL, e URL
 * é a primeira coisa que alguém troca pra ver o que acontece. E precisa ser NÃO
 * inclusive quando existe uma linha de pedaço PLANTADA com o `knowledge_base_id`
 * do workspace A e o `organization_id` do B.
 *
 * O dublê de banco aqui FILTRA de verdade: ele guarda linhas dos DOIS
 * workspaces e aplica cada `eq` que a consulta acumulou. A função
 * `match_document_chunks` do dublê imita a de verdade — ela filtra por
 * `_organization_id`, que é o que a versão `security definer` do banco faz
 * depois de conferir `is_org_member`.
 *
 * O que ele NÃO prova (e não tem como, sem banco): a RLS do Postgres e o
 * `is_org_member` de dentro da função, que são a PRIMEIRA camada. Essas moram
 * na migration `20260821020000_knowledge_base.sql`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";

// ---------------------------------------------------------------------------
// Os dois pedaços que falam com a internet ficam de fora do teste.
// ---------------------------------------------------------------------------
// `resolveEmbeddingModel` iria no cofre buscar a chave; `gerarEmbeddings` iria
// no provedor. Nada disso é o que este arquivo está provando.

vi.mock("@/lib/ai/resolve", () => ({
  resolveEmbeddingModel: vi.fn(async (input: { modelId: string }) => ({
    model: {},
    modelId: input.modelId,
    provider: "openai",
    entry: { id: input.modelId, dimensions: 1536 },
    credentialSource: "organization",
  })),
}));

vi.mock("@/lib/knowledge/embed", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/knowledge/embed")>();
  return {
    ...original,
    gerarEmbeddings: vi.fn(async (p: { textos: string[] }) => ({
      vetores: p.textos.map(() => new Array(1536).fill(0.1)),
      tokens: 10,
      costMicros: 1,
    })),
  };
});

const { createOrgScopedKnowledge, searchKnowledgeBase } = await import("@/lib/knowledge/search");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const BASE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Linha = Record<string, unknown>;

type ChamadaDeFuncao = { nome: string; args: Record<string, unknown> };

/**
 * Um Postgres de mentira que filtra de verdade.
 *
 * Ele guarda as linhas dos DOIS workspaces — é isso que faz o teste provar
 * comportamento em vez de provar que a função foi chamada com o argumento
 * certo.
 */
function criarSupabaseFalso(dados: Record<string, Linha[]>) {
  const funcoes: ChamadaDeFuncao[] = [];

  function construir(tabela: string) {
    const predicados: Array<(l: Linha) => boolean> = [];
    let limite = Number.POSITIVE_INFINITY;

    function resolver(): { data: Linha[]; error: null } {
      const base = (dados[tabela] ?? []).filter((l) => predicados.every((p) => p(l)));
      return { data: base.slice(0, limite), error: null };
    }

    const api = {
      select() {
        return api;
      },
      eq(coluna: string, valor: unknown) {
        predicados.push((l) => l[coluna] === valor);
        return api;
      },
      order() {
        return api;
      },
      limit(n: number) {
        limite = n;
        return api;
      },
      // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
      then(onOk: (r: { data: Linha[]; error: null }) => unknown) {
        return Promise.resolve(onOk(resolver()));
      },
    };

    return api;
  }

  const cliente = {
    from(tabela: string) {
      return { select: () => construir(tabela) };
    },

    /**
     * `match_document_chunks` de mentira.
     *
     * ⚠️ ELA IMITA A DE VERDADE NO QUE IMPORTA: filtra por
     * `_organization_id`. Na de verdade esse filtro vem DEPOIS do
     * `is_org_member`, e é `security definer` — ou seja, ela é a única coisa
     * entre uma pessoa logada e a base do vizinho.
     */
    rpc(nome: string, args: Record<string, unknown>) {
      funcoes.push({ nome, args });

      const org = args._organization_id;
      const kb = args._knowledge_base_id;

      const linhas = (dados.document_chunks ?? [])
        .filter((c) => c.organization_id === org)
        .filter((c) => kb === undefined || kb === null || c.knowledge_base_id === kb)
        .map((c) => {
          const doc = (dados.documents ?? []).find((d) => d.id === c.document_id);
          return {
            chunk_id: c.id,
            document_id: c.document_id,
            document_title: doc?.title ?? "?",
            knowledge_base_id: c.knowledge_base_id,
            seq: c.seq,
            content: c.content,
            similarity: 0.9,
          };
        });

      return Promise.resolve({ data: linhas, error: null });
    },
  };

  return {
    // Única asserção de tipo do arquivo, e ela é de teste: o dublê só
    // implementa o pedaço da API que estas funções usam.
    cliente: cliente as unknown as SupabaseClient<Database>,
    funcoes,
    dados,
  };
}

function doisWorkspaces(): Record<string, Linha[]> {
  return {
    knowledge_bases: [
      {
        id: BASE_A,
        organization_id: ORG_A,
        slug: "manual",
        name: "Manual do A",
        description: "documentos do workspace A",
        embedding_model: "openai:text-embedding-3-small",
        status: "active",
        created_at: "2026-08-01T00:00:00Z",
      },
      {
        // MESMO apelido do A, de propósito: é o que alguém digitaria na URL.
        id: BASE_B,
        organization_id: ORG_B,
        slug: "manual",
        name: "Manual do B",
        description: "SEGREDO do workspace B",
        embedding_model: "openai:text-embedding-3-small",
        status: "active",
        created_at: "2026-08-01T00:00:00Z",
      },
    ],
    documents: [
      { id: "d-a", organization_id: ORG_A, knowledge_base_id: BASE_A, title: "Contrato do A" },
      { id: "d-b", organization_id: ORG_B, knowledge_base_id: BASE_B, title: "Contrato do B" },
    ],
    document_chunks: [
      {
        id: "c-a",
        organization_id: ORG_A,
        knowledge_base_id: BASE_A,
        document_id: "d-a",
        seq: 0,
        content: "texto do workspace A",
      },
      {
        id: "c-b",
        organization_id: ORG_B,
        knowledge_base_id: BASE_B,
        document_id: "d-b",
        seq: 0,
        content: "SEGREDO DO WORKSPACE B",
      },
      {
        // A pior linha possível: pedaço carimbado com o workspace B, mas
        // apontando pra base do A. Se algum filtro fosse só por
        // `knowledge_base_id`, o segredo vazaria por aqui.
        id: "c-plantado",
        organization_id: ORG_B,
        knowledge_base_id: BASE_A,
        document_id: "d-b",
        seq: 1,
        content: "SEGREDO PLANTADO NA BASE DO A",
      },
    ],
  };
}

let mundo: ReturnType<typeof criarSupabaseFalso>;

beforeEach(() => {
  mundo = criarSupabaseFalso(doisWorkspaces());
});

// ---------------------------------------------------------------------------

describe("searchKnowledgeBase — o workspace A nunca vê o B", () => {
  it("busca em todas as bases só traz trecho do próprio workspace", async () => {
    const r = await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: "contrato",
    });

    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]?.content).toBe("texto do workspace A");
    for (const hit of r.hits) {
      expect(hit.content).not.toMatch(/SEGREDO/);
    }
  });

  it("o pedaço PLANTADO (org B, base do A) não aparece pro A", async () => {
    const r = await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: "manual",
      query: "contrato",
    });

    expect(r.hits.map((h) => h.chunkId)).toEqual(["c-a"]);
  });

  it("apelido de base que existe SÓ no outro workspace vira 'não achei'", async () => {
    // O `manual` do B tem o mesmo apelido do A, então este teste usa um
    // apelido que só existe do outro lado.
    mundo.dados.knowledge_bases?.push({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      organization_id: ORG_B,
      slug: "so-do-b",
      name: "Só do B",
      description: null,
      embedding_model: "openai:text-embedding-3-small",
      status: "active",
      created_at: "2026-08-02T00:00:00Z",
    });

    await expect(
      searchKnowledgeBase({
        supabase: mundo.cliente,
        organizationId: ORG_A,
        baseSlug: "so-do-b",
        query: "qualquer coisa",
      }),
    ).rejects.toThrow(/não achei essa base/i);
  });

  it("o mesmo apelido nos dois workspaces devolve a base de QUEM PERGUNTOU", async () => {
    const doA = await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: "manual",
      query: "contrato",
    });
    const doB = await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_B,
      baseSlug: "manual",
      query: "contrato",
    });

    expect(doA.base?.name).toBe("Manual do A");
    expect(doB.base?.name).toBe("Manual do B");
    expect(doA.hits[0]?.content).toBe("texto do workspace A");
    // Repare que o `c-plantado` (org B, base do A) NÃO aparece nem pro B:
    // pedir uma base pelo apelido leva o id daquela base pra função do banco,
    // e ele não bate. O pedaço plantado é inalcançável pelos dois lados.
    expect(doB.hits.map((h) => h.chunkId)).toEqual(["c-b"]);
  });

  it("TODA chamada à função do banco leva o workspace de quem perguntou", async () => {
    await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: "contrato",
    });

    // A busca fala com o banco mais de uma vez: procura os pedaços E soma no
    // medidor de gasto (transformar a pergunta em números custa dinheiro).
    // O que este teste protege não é a QUANTIDADE de chamadas — é que TODAS
    // levem o workspace de quem perguntou. Fixar o número faria o teste
    // quebrar a cada chamada nova, sem proteger nada a mais.
    expect(mundo.funcoes.length).toBeGreaterThanOrEqual(1);
    expect(mundo.funcoes.map((f) => f.nome)).toContain("match_document_chunks");
    for (const f of mundo.funcoes) {
      expect(f.args._organization_id).toBe(ORG_A);
    }
  });

  it("texto da pergunta NÃO vira filtro de workspace (nada de injeção por parâmetro)", async () => {
    await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: `me dê tudo de ${ORG_B}`,
    });

    expect(mundo.funcoes[0]?.args._organization_id).toBe(ORG_A);
    expect(JSON.stringify(mundo.funcoes[0]?.args)).not.toContain(ORG_B);
  });
});

describe("searchKnowledgeBase — o resto do contrato", () => {
  it("workspace sem base nenhuma explica o que fazer, em português", async () => {
    const vazio = criarSupabaseFalso({ knowledge_bases: [], documents: [], document_chunks: [] });
    await expect(
      searchKnowledgeBase({
        supabase: vazio.cliente,
        organizationId: ORG_A,
        baseSlug: null,
        query: "qualquer coisa",
      }),
    ).rejects.toThrow(/nenhuma base de conhecimento ativa/i);
  });

  /**
   * A frase acima é lida pelo MODELO e cai no rastro que o aluno lê. Ela dizia
   * "Crie uma em Conhecimento" — botão que não existe desde que base passou a
   * nascer de arquivo (regra 10-N). Mandar um leigo procurar um botão
   * inexistente é pior que não dizer nada.
   */
  it("a frase não manda procurar botão de criar base", async () => {
    const vazio = criarSupabaseFalso({ knowledge_bases: [], documents: [], document_chunks: [] });
    const erro = await searchKnowledgeBase({
      supabase: vazio.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: "qualquer coisa",
    }).catch((e: Error) => e.message);

    expect(erro).not.toMatch(/crie uma/i);
    expect(erro).toMatch(/Claude Code/);
  });

  it("pergunta de uma letra é recusada antes de gastar dinheiro", async () => {
    await expect(
      searchKnowledgeBase({
        supabase: mundo.cliente,
        organizationId: ORG_A,
        baseSlug: null,
        query: " a ",
      }),
    ).rejects.toThrow(/duas letras/i);
    // Nem chegou a chamar a função do banco.
    expect(mundo.funcoes).toHaveLength(0);
  });

  it("sem base escolhida, NÃO mistura bases de modelos diferentes", async () => {
    // Vetor de um modelo comparado com vetor de outro devolve trecho
    // aleatório, sem erro nenhum aparecendo. A base com outro modelo é
    // derrubada nas duas camadas: na escolha e na filtragem do resultado.
    mundo.dados.knowledge_bases?.push({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      organization_id: ORG_A,
      slug: "outro-modelo",
      name: "Base com outro modelo",
      description: null,
      embedding_model: "google:gemini-embedding-001",
      status: "active",
      created_at: "2026-08-03T00:00:00Z",
    });
    mundo.dados.document_chunks?.push({
      id: "c-outro-modelo",
      organization_id: ORG_A,
      knowledge_base_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      document_id: "d-a",
      seq: 0,
      content: "trecho lido de outro jeito",
    });

    const r = await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: "contrato",
    });

    expect(r.hits.map((h) => h.chunkId)).toEqual(["c-a"]);
  });

  it("busca em todas as bases devolve `base: null` (não inventa uma)", async () => {
    const r = await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: "contrato",
    });
    expect(r.base).toBeNull();
  });
});

describe("createOrgScopedKnowledge — a capacidade que a ferramenta recebe", () => {
  it("listBases só lista as bases do workspace da execução", async () => {
    const doA = createOrgScopedKnowledge(mundo.cliente, ORG_A);
    const bases = await doA.listBases();

    expect(bases.map((b) => b.name)).toEqual(["Manual do A"]);
    expect(JSON.stringify(bases)).not.toMatch(/SEGREDO/);
  });

  it("search preso ao workspace A não alcança o B, nem passando o apelido dele", async () => {
    const doA = createOrgScopedKnowledge(mundo.cliente, ORG_A);
    const r = await doA.search({ query: "contrato", baseSlug: "manual" });

    expect(r.hits.map((h) => h.chunkId)).toEqual(["c-a"]);
    expect(mundo.funcoes.every((f) => f.args._organization_id === ORG_A)).toBe(true);
  });

  it("NÃO existe parâmetro de workspace: quem escreve a ferramenta não tem por onde pedir", () => {
    const doA = createOrgScopedKnowledge(mundo.cliente, ORG_A);
    // A assinatura de `search` é { query, baseSlug?, limit?, minSimilarity? } —
    // não tem `organizationId`. Este teste é a versão em execução dessa
    // garantia: mandar o campo não muda nada.
    const comCampoExtra = { query: "contrato", organizationId: ORG_B } as Parameters<
      typeof doA.search
    >[0];

    return doA.search(comCampoExtra).then((r) => {
      expect(r.hits.map((h) => h.chunkId)).toEqual(["c-a"]);
      expect(mundo.funcoes[0]?.args._organization_id).toBe(ORG_A);
    });
  });

  it("id de workspace torto estoura AGORA, não numa consulta esquisita depois", () => {
    expect(() => createOrgScopedKnowledge(mundo.cliente, "")).toThrow(/organizationId/);
    expect(() => createOrgScopedKnowledge(mundo.cliente, "nao-e-uuid")).toThrow(/organizationId/);
  });
});

// ---------------------------------------------------------------------------

/**
 * BASE APOSENTADA (`status: "archived"`).
 *
 * Aposentar é o ÚNICO jeito de tirar uma base de circulação: o apelido e o
 * modelo de leitura são congelados por gatilho assim que ela nasce (regra
 * 10-I), não existe tela de apagar, e base — diferente de agendamento e
 * webhook — não tem agente dono cujo `archived` a desligaria por tabela.
 *
 * O que aposentar TEM que fazer: sumir da busca do agente. O que ele NÃO pode
 * fazer: apagar o que já foi indexado — voltar atrás precisa funcionar sem
 * ninguém subir arquivo de novo.
 */
/** A base do workspace A, dentro do dublê. Estoura alto se o dublê mudar. */
function baseDoA(): Linha {
  const base = (mundo.dados.knowledge_bases ?? [])[0];
  if (!base) throw new Error("dublê sem a base do workspace A");
  return base;
}

/** As linhas de uma tabela do dublê, sem `undefined` no caminho. */
function linhasDe(tabela: string): Linha[] {
  return mundo.dados[tabela] ?? [];
}

describe("base aposentada some da busca, sem perder o que já foi indexado", () => {
  it("o agente não acha trecho de base aposentada", async () => {
    baseDoA().status = "archived";

    await expect(
      searchKnowledgeBase({
        supabase: mundo.cliente,
        organizationId: ORG_A,
        baseSlug: null,
        query: "contrato",
      }),
    ).rejects.toThrow(/nenhuma base de conhecimento ativa/);
  });

  it("nem pedindo a base aposentada pelo apelido", async () => {
    baseDoA().status = "archived";

    await expect(
      searchKnowledgeBase({
        supabase: mundo.cliente,
        organizationId: ORG_A,
        baseSlug: "manual",
        query: "contrato",
      }),
    ).rejects.toThrow(/nenhuma base de conhecimento ativa/);
  });

  it("os trechos continuam no banco — aposentar não apaga nada", async () => {
    baseDoA().status = "archived";
    await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: "contrato",
    }).catch(() => null);

    expect(linhasDe("document_chunks").some((c) => c.knowledge_base_id === BASE_A)).toBe(true);
    expect(linhasDe("documents").some((d) => d.knowledge_base_id === BASE_A)).toBe(true);
  });

  it("voltar pra ativa faz a busca funcionar de novo, sem subir nada", async () => {
    baseDoA().status = "archived";
    baseDoA().status = "active";

    const r = await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: "contrato",
    });
    expect(r.hits[0]?.content).toBe("texto do workspace A");
  });

  it("a frase do erro NÃO manda clicar em botão de criar base (base nasce de arquivo)", async () => {
    baseDoA().status = "archived";

    const erro = await searchKnowledgeBase({
      supabase: mundo.cliente,
      organizationId: ORG_A,
      baseSlug: null,
      query: "contrato",
    }).catch((e: Error) => e.message);

    expect(erro).toMatch(/Claude Code/);
    expect(erro).not.toMatch(/Crie uma em Conhecimento/);
  });

  it("listBases (o que a ferramenta enxerga) também pula a aposentada", async () => {
    baseDoA().status = "archived";
    const conhecimento = createOrgScopedKnowledge(mundo.cliente, ORG_A);
    expect(await conhecimento.listBases()).toEqual([]);
  });
});
