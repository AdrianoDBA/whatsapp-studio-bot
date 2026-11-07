/**
 * A TRADUÇÃO DA PONTE: pedido da API do Supabase → SQL.
 *
 * A ponte reimplementa o pedacinho da API do Supabase que o nosso próprio
 * código usa. Estes testes fixam esse pedacinho: se um dia a tradução mudar, é
 * aqui que aparece — e não às 8h da manhã, numa automação que ninguém está
 * olhando.
 *
 * O irmão deste arquivo é `automation-bridge-sql-injection.test.ts` (valor
 * nunca vira SQL) e `automation-impersonation.test.ts` (a identidade não
 * vaza).
 */
import type pg from "pg";
import { describe, expect, test } from "vitest";
import {
  COLUNAS_DA_PONTE,
  createBridgeFetch,
  FORMA_DA_FUNCAO,
  FUNCOES_DA_PONTE,
  OPERADORES_DA_PONTE,
  TABELAS_DA_PONTE,
} from "@/lib/automation/postgrest-bridge";
import { montarTabelas, PESSOA_A, PoolDeMentira, WORKSPACE_A } from "./helpers/banco-de-mentira";

const URL_FALSA = "http://localhost:54321";
const JOB = "aaaa1111-1111-4111-8111-111111111111";

/** Ver a explicação do `as unknown as pg.Pool` em automation-impersonation.test.ts. */
function montarPonte(pool: PoolDeMentira) {
  return createBridgeFetch({
    pool: pool as unknown as pg.Pool,
    claims: { sub: PESSOA_A, role: "authenticated" },
    jobId: JOB,
  });
}

function ultimoTexto(pool: PoolDeMentira): string {
  const lista = pool.consultasDeDados();
  return lista[lista.length - 1]?.text ?? "";
}

describe("as listas fechadas", () => {
  test("as tabelas da ponte são exatamente as escopadas por workspace", () => {
    // Se alguém criar tabela nova com `organization_id` e esquecer de
    // acrescentar aqui, a automação passa a falhar só naquela tabela — e o
    // sintoma seria "funciona no painel, falha às 8h".
    expect([...TABELAS_DA_PONTE].sort()).toEqual([
      "agent_run_steps",
      "agent_runs",
      "agents",
      "automation_usage",
      "document_chunks",
      "documents",
      "invitations",
      "jobs",
      "knowledge_bases",
      "memberships",
      "org_ai_limits",
      "org_ai_spend",
      "schedules",
      "thread_messages",
      "threads",
      "webhook_endpoints",
    ]);
  });

  test("toda tabela da ponte tem a lista de colunas declarada", () => {
    for (const tabela of TABELAS_DA_PONTE) {
      const colunas = COLUNAS_DA_PONTE[tabela];
      expect(colunas, `faltou declarar as colunas de ${tabela}`).toBeDefined();
      expect(colunas.length).toBeGreaterThan(0);
      expect(colunas).toContain("organization_id");
    }
  });

  test("a lista de funções é curta e conhecida", () => {
    // ⚠️ ESTA LISTA É ESCRITA À MÃO DE PROPÓSITO. Cada nome aqui é uma porta
    // que a automação pode abrir no banco — ampliar sem pensar é ampliar a
    // superfície. Quando alguém acrescenta uma função, este teste quebra e a
    // decisão aparece no diff, que é exatamente o efeito desejado.
    //
    // O teste IRMÃO (`automation-bridge-cobertura`) cobre o erro oposto:
    // esquecer de acrescentar. Os dois juntos fecham o buraco dos dois lados.
    expect([...FUNCOES_DA_PONTE].sort()).toEqual([
      // As quatro de indexar documento: desde que ler o arquivo virou trabalho
      // de fila, elas rodam por aqui.
      "append_document_chunks",
      "consume_llm_tokens",
      "fail_document",
      "finish_agent_run",
      "finish_document_indexing",
      "match_document_chunks",
      // Sem esta, o teto de gasto funciona no painel e quebra às 8h da manhã:
      // é ela que o motor lê no passo 2a, e pela automação a leitura passa pela
      // ponte.
      "org_ai_budget_status",
      "org_ai_spend_add",
      "org_ai_spend_add_embedding",
      // Sem esta, a automação roda e NÃO DEIXA RASTRO — medido: 3 passos e
      // US$ 0,000487 pelo painel contra 0 passos e custo zero pela automação.
      "record_agent_run_step",
      "resolve_credential",
      "start_document_processing",
    ]);
  });

  test("a lista de operadores é a do contrato", () => {
    expect([...OPERADORES_DA_PONTE]).toEqual([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "like",
      "ilike",
      "is",
      "in",
      "cs",
      "cd",
      "not",
    ]);
  });
});

describe("leitura", () => {
  test("select com ordem e limite", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(
      `${URL_FALSA}/rest/v1/documents?select=*&organization_id=eq.${WORKSPACE_A}` +
        "&order=created_at.desc&limit=20",
    );

    expect(ultimoTexto(pool)).toContain('order by "created_at" desc');
    expect(ultimoTexto(pool)).toContain("limit $");
    await ponte.encerrar();
  });

  test("select de colunas nomeadas", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/documents?select=id,title`);
    expect(ultimoTexto(pool)).toContain('select "id", "title" from public."documents"');
    await ponte.encerrar();
  });

  test("o operador `in` respeita valor com vírgula dentro de aspas", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const url = new URL(`${URL_FALSA}/rest/v1/documents`);
    url.searchParams.set("select", "*");
    url.searchParams.append("title", 'in.(um,"dois, e virgula",tres)');

    await ponte(url.toString());

    const consulta = pool.consultasDeDados().at(-1);
    expect(consulta?.values).toEqual(["um", "dois, e virgula", "tres"]);
    expect(consulta?.text).toContain('"title" in ($1, $2, $3)');
    await ponte.encerrar();
  });

  test("`not` inverte o filtro", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const url = new URL(`${URL_FALSA}/rest/v1/documents`);
    url.searchParams.set("select", "*");
    url.searchParams.append("status", "not.eq.done");

    await ponte(url.toString());
    expect(ultimoTexto(pool)).toContain('not ("status" = $1)');
    await ponte.encerrar();
  });

  test("`ilike` troca o curinga `*` da API pelo `%` do SQL", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const url = new URL(`${URL_FALSA}/rest/v1/documents`);
    url.searchParams.set("select", "*");
    url.searchParams.append("title", "ilike.*relatorio*");

    await ponte(url.toString());
    expect(pool.consultasDeDados().at(-1)?.values).toContain("%relatorio%");
    await ponte.encerrar();
  });

  test("`single()` com uma linha devolve o objeto", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const resposta = await ponte(`${URL_FALSA}/rest/v1/documents?select=*&id=eq.t-a`, {
      headers: { Accept: "application/vnd.pgrst.object+json" },
    });

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as { id: string };
    expect(corpo.id).toBe("t-a");
    await ponte.encerrar();
  });

  test("`single()` sem linha nenhuma devolve 406 com o código PGRST116", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const resposta = await ponte(`${URL_FALSA}/rest/v1/documents?select=*&id=eq.nao-existe`, {
      headers: { Accept: "application/vnd.pgrst.object+json" },
    });

    expect(resposta.status).toBe(406);
    const corpo = (await resposta.json()) as { code: string };
    expect(corpo.code).toBe("PGRST116");
    await ponte.encerrar();
  });

  test("contagem exata volta no cabeçalho content-range", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const resposta = await ponte(`${URL_FALSA}/rest/v1/documents?select=*`, {
      headers: { Prefer: "count=exact" },
    });

    expect(resposta.headers.get("content-range")).toBe("*/1");
    await ponte.encerrar();
  });
});

describe("escrita", () => {
  test("insert sem `select()` não devolve nada (201 vazio)", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const resposta = await ponte(`${URL_FALSA}/rest/v1/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x", organization_id: WORKSPACE_A, title: "t" }),
    });

    expect(resposta.status).toBe(201);
    expect(ultimoTexto(pool)).toContain(
      'insert into public."documents" ("id", "organization_id", "title") values ($1, $2, $3)',
    );
    expect(ultimoTexto(pool)).not.toContain("returning");
    await ponte.encerrar();
  });

  test("insert com `select()` devolve a linha gravada", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const resposta = await ponte(`${URL_FALSA}/rest/v1/documents?select=id`, {
      method: "POST",
      headers: { "content-type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ id: "x", organization_id: WORKSPACE_A, title: "t" }),
    });

    expect(resposta.status).toBe(201);
    expect(ultimoTexto(pool)).toContain('returning "id"');
    await ponte.encerrar();
  });

  test("gravar-ou-atualizar (upsert) é recusado com nome", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await expect(
      ponte(`${URL_FALSA}/rest/v1/documents?on_conflict=id`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "x", organization_id: WORKSPACE_A }),
      }),
    ).rejects.toThrow(/não roda/);
    await ponte.encerrar();
  });

  test("trazer tabela vizinha junto no select é recusado com nome", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await expect(
      ponte(`${URL_FALSA}/rest/v1/memberships?select=role,organization:organizations(id,slug)`),
    ).rejects.toThrow(/tabela vizinha/);
    await ponte.encerrar();
  });
});

describe("funções", () => {
  test("função que devolve um valor sai como JSON puro", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/rpc/consume_llm_tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _tokens: 100 }),
    });

    expect(ultimoTexto(pool)).toBe(
      'select to_json(public."consume_llm_tokens"(_tokens => $1))::text as corpo',
    );
    await ponte.encerrar();
  });

  test("fechar execução devolve JSON, não 204 vazio", async () => {
    // Desde a onda 6 `finish_agent_run` devolve `jsonb` (`{"alerta": …}`) — é
    // por ali que o aviso do teto de gasto volta pro motor. Enquanto ela esteve
    // marcada como "vazio" nesta lista, a ponte respondia 204 e o aviso sumia
    // no caminho da automação, sem ninguém perceber.
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const resposta = await ponte(`${URL_FALSA}/rest/v1/rpc/finish_agent_run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _run_id: JOB, _status: "succeeded" }),
    });

    expect(resposta.status).toBe(200);
    expect(ultimoTexto(pool)).toBe(
      'select to_json(public."finish_agent_run"(_run_id => $1, _status => $2))::text as corpo',
    );
    await ponte.encerrar();
  });

  test("o teto de gasto sai como lista (é uma função de linhas)", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/rpc/org_ai_budget_status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _organization_id: WORKSPACE_A }),
    });

    expect(ultimoTexto(pool)).toContain(
      'from (select * from public."org_ai_budget_status"(_organization_id => $1)) t',
    );
    await ponte.encerrar();
  });

  test("função que devolve linhas sai como lista", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/rpc/resolve_credential`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _organization_id: WORKSPACE_A, _provider: "openai" }),
    });

    expect(ultimoTexto(pool)).toContain(
      'from (select * from public."resolve_credential"(_organization_id => $1, _provider => $2)) t',
    );
    await ponte.encerrar();
  });

  test("argumento inventado é recusado com nome", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await expect(
      ponte(`${URL_FALSA}/rest/v1/rpc/consume_llm_tokens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ _tokens: 10, _organization_id: WORKSPACE_A }),
      }),
    ).rejects.toThrow(/argumento/);
    await ponte.encerrar();
  });
});

describe("argumento jsonb: o `pg` não pode adivinhar", () => {
  /**
   * ISTO QUEBROU DE VERDADE, e só apareceu subindo um arquivo no navegador.
   *
   * O `pg` serializa sozinho o que a gente entrega — e serializa DIFERENTE por
   * tipo: objeto vira JSON, mas ARRAY vira literal de array do Postgres
   * (`{...}`). Como `record_agent_run_step` recebe objetos, ela sempre
   * funcionou; `append_document_chunks` recebe uma LISTA de pedaços, e o banco
   * respondia `22P02: invalid input syntax for type json`.
   *
   * O estrago era do tipo caro: o arquivo já tinha sido baixado, recortado e
   * o embedding já tinha sido COBRADO. Aí o documento virava "Falhou".
   */
  function ultimosValores(pool: PoolDeMentira): unknown[] {
    const lista = pool.consultasDeDados();
    return lista[lista.length - 1]?.values ?? [];
  }

  test("lista de pedaços vai como texto, com ::jsonb no SQL", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const pedacos = [
      { seq: 0, content: "primeiro trecho", embedding: "[0.1,0.2]" },
      { seq: 1, content: "segundo trecho", embedding: "[0.3,0.4]" },
    ];

    await ponte(`${URL_FALSA}/rest/v1/rpc/append_document_chunks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _document_id: JOB, _chunks: pedacos }),
    });

    expect(ultimoTexto(pool)).toContain("_chunks => $2::jsonb");

    const valores = ultimosValores(pool);
    // Texto, não array: é isso que impede o `pg` de montar `{...}`.
    expect(typeof valores[1]).toBe("string");
    expect(JSON.parse(String(valores[1]))).toEqual(pedacos);

    await ponte.encerrar();
  });

  test("o rastro do agente também é jsonb declarado", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/rpc/record_agent_run_step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        _run_id: JOB,
        _seq: 1,
        _kind: "tool",
        _input: { situacao: "pendente" },
        _output: { total: 2 },
      }),
    });

    const sql = ultimoTexto(pool);
    expect(sql).toContain("_input => $4::jsonb");
    expect(sql).toContain("_output => $5::jsonb");
    await ponte.encerrar();
  });

  test("_simulado (onda 7, o passo de ação) passa pela ponte sem estourar", async () => {
    // Esta é EXATAMENTE a armadilha que este arquivo existe pra impedir:
    // `_simulado` foi acrescentado à função do banco pra gravar o passo de
    // ação (`ctx.acao`) na task 4, e SEM entrar em `FORMA_DA_FUNCAO` aqui, a
    // ponte recusaria o argumento com `BridgeUnsupportedError` — a ação
    // rodaria certo pelo painel e o passo dela sumiria do rastro sempre que a
    // mesma automação rodasse por agendamento ou webhook.
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/rpc/record_agent_run_step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        _run_id: JOB,
        _seq: 1,
        _kind: "tool",
        _tool_name: "acao:email",
        _simulado: true,
      }),
    });

    // Não é `jsonb`: vai como argumento comum, SEM `::jsonb` colado atrás do
    // placeholder — daí o teste não fixar qual número de placeholder, só a
    // forma (`argumento => $N`, ponto final, sem cast).
    const sql = ultimoTexto(pool);
    expect(sql).toMatch(/_simulado => \$\d+(?!::jsonb)(,|\)|$)/);
    expect(ultimosValores(pool)).toContain(true);
    await ponte.encerrar();
  });

  test('jsonb nulo continua nulo — não vira a string "null"', async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/rpc/record_agent_run_step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _run_id: JOB, _seq: 0, _kind: "model", _output: null }),
    });

    expect(ultimosValores(pool)).toContain(null);
    await ponte.encerrar();
  });

  test("TODO argumento jsonb do banco está declarado na ponte", () => {
    // A lista abaixo é o que `pg_get_function_identity_arguments` devolve pras
    // funções da ponte. Acrescentou função com jsonb? Acrescente aqui também —
    // senão o defeito volta calado, e só no caminho da automação.
    const JSONB_NO_BANCO: Record<string, string[]> = {
      append_document_chunks: ["_chunks"],
      record_agent_run_step: ["_input", "_output"],
    };

    for (const [funcao, args] of Object.entries(JSONB_NO_BANCO)) {
      const declarado = FORMA_DA_FUNCAO[funcao as keyof typeof FORMA_DA_FUNCAO]?.json ?? [];
      expect([...declarado].sort(), `${funcao} está sem argumento jsonb declarado`).toEqual(
        args.sort(),
      );
    }
  });
});
