/**
 * A PROVA DE QUE VALOR NUNCA VIRA SQL (regra R4 da ponte).
 *
 * A ponte monta consulta de verdade a partir de um pedido HTTP. Isso só é
 * seguro enquanto TODO valor virar parâmetro (`$1`, `$2`…) e NENHUM valor for
 * colado dentro do texto da consulta.
 *
 * O ataque que este arquivo tenta é o pior possível: fazer o Postgres executar
 * `reset role` no meio da consulta. Se ele conseguisse, a conexão voltaria a
 * ser `postgres` — dono das tabelas — e a regra de segurança do banco deixaria
 * de valer PRA TODOS OS WORKSPACES.
 */
import type pg from "pg";
import { describe, expect, test } from "vitest";
import { BridgeUnsupportedError, createBridgeFetch } from "@/lib/automation/postgrest-bridge";
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

/** A consulta de dado que a ponte emitiu (a última). */
function ultimaConsultaDeDados(pool: PoolDeMentira) {
  const lista = pool.consultasDeDados();
  return lista[lista.length - 1];
}

const VENENOS = [
  "'; reset role; --",
  "' or '1'='1",
  '"; drop table public.documents; --',
  "\\'; set role postgres; --",
  "a' union select * from public.credentials --",
];

describe("valor de filtro nunca vira SQL", () => {
  for (const veneno of VENENOS) {
    test(`o valor ${JSON.stringify(veneno)} vai parar em values, não no texto`, async () => {
      const pool = new PoolDeMentira(montarTabelas());
      const ponte = montarPonte(pool);

      const url = new URL(`${URL_FALSA}/rest/v1/documents`);
      url.searchParams.set("select", "*");
      url.searchParams.append("organization_id", `eq.${WORKSPACE_A}`);
      url.searchParams.append("title", `eq.${veneno}`);

      await ponte(url.toString());

      const consulta = ultimaConsultaDeDados(pool);
      expect(consulta).toBeDefined();

      // 1. O texto emitido é EXATAMENTE o mesmo que sairia com um valor bobo.
      expect(consulta?.text).toBe(
        'select coalesce(json_agg(t), \'[]\'::json)::text as corpo from (select * from public."documents" where "organization_id" = $1 and "title" = $2) t',
      );
      // 2. O veneno está nos valores, intacto e inofensivo.
      expect(consulta?.values).toEqual([WORKSPACE_A, veneno]);
      // 3. E nenhum pedaço dele encostou no texto.
      expect(consulta?.text).not.toContain("reset role");
      expect(consulta?.text).not.toContain("drop table");
      expect(consulta?.text).not.toContain("union");

      await ponte.encerrar();
    });
  }

  test("o mesmo vale pro valor de um insert", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/documents?select=id`, {
      method: "POST",
      headers: { "content-type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        id: "nova",
        organization_id: WORKSPACE_A,
        title: "'; reset role; --",
        created_by: PESSOA_A,
      }),
    });

    const consulta = ultimaConsultaDeDados(pool);
    expect(consulta?.text).not.toContain("reset role");
    expect(consulta?.values).toContain("'; reset role; --");
    await ponte.encerrar();
  });

  test("o mesmo vale pro argumento de uma função", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await ponte(`${URL_FALSA}/rest/v1/rpc/consume_llm_tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _tokens: "1); reset role; --" }),
    });

    const consulta = ultimaConsultaDeDados(pool);
    expect(consulta?.text).toBe(
      'select to_json(public."consume_llm_tokens"(_tokens => $1))::text as corpo',
    );
    expect(consulta?.values).toEqual(["1); reset role; --"]);
    await ponte.encerrar();
  });
});

describe("nome de coluna e de tabela saem de lista fechada", () => {
  test("coluna inventada é recusada com nome, sem chegar no banco", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await expect(
      ponte(`${URL_FALSA}/rest/v1/documents?select=*&titulo_inventado=eq.x`),
    ).rejects.toBeInstanceOf(BridgeUnsupportedError);
    expect(pool.consultasDeDados()).toHaveLength(0);
    await ponte.encerrar();
  });

  test('coluna com aspas ("id" from x) é recusada pelo formato', async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    const url = new URL(`${URL_FALSA}/rest/v1/documents`);
    url.searchParams.set("select", "*");
    url.searchParams.append('id" from public.credentials --', "eq.1");

    await expect(ponte(url.toString())).rejects.toBeInstanceOf(BridgeUnsupportedError);
    expect(pool.consultasDeDados()).toHaveLength(0);
    await ponte.encerrar();
  });

  test("ordenação inventada é recusada", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await expect(
      ponte(`${URL_FALSA}/rest/v1/documents?select=*&order=created_at.desc%3B%20reset%20role`),
    ).rejects.toBeInstanceOf(BridgeUnsupportedError);
    await ponte.encerrar();
  });

  test("filtro fora da lista de operadores é recusado", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    // `fts` (busca de texto completo) existe na API do Supabase e NÃO na ponte.
    await expect(
      ponte(`${URL_FALSA}/rest/v1/documents?select=*&title=fts.qualquer`),
    ).rejects.toBeInstanceOf(BridgeUnsupportedError);
    await ponte.encerrar();
  });

  test('"is" só aceita as quatro palavras do SQL', async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = montarPonte(pool);

    await expect(
      ponte(`${URL_FALSA}/rest/v1/documents?select=*&processed_at=is.null%3B%20reset%20role`),
    ).rejects.toBeInstanceOf(BridgeUnsupportedError);
    await ponte.encerrar();
  });
});
