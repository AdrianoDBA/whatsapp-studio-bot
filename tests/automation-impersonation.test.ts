/**
 * A PROVA DE QUE A IMPERSONAÇÃO NÃO VAZA.
 *
 * Este é o teste mais importante da automação. Ele responde duas perguntas:
 *
 *   1. **Um trabalho do workspace A consegue ler ou escrever dado do
 *      workspace B?** (não)
 *   2. **Alguém consegue pedir pro trabalhador rodar no nome de outra
 *      pessoa?** (não — a identidade não viaja no pedido)
 *
 * Quem for mexer em `lib/automation/pg.ts`, `postgrest-bridge.ts` ou
 * `run-job.ts`: leia este arquivo ANTES. Ele existe pra quebrar quando alguém
 * "melhorar" uma daquelas três linhas perigosas.
 *
 * O Postgres de mentira que serve de banco aqui está em
 * `tests/helpers/banco-de-mentira.ts`, com a explicação do que ele imita e do
 * que ele NÃO imita.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { describe, expect, test } from "vitest";
import {
  createBridgeFetch,
  isBridgeUnsupportedError,
  type PonteFetch,
} from "@/lib/automation/postgrest-bridge";
import { runJobRequestSchema } from "@/lib/automation/schemas";
import type { Database } from "@/types/supabase";
import {
  montarTabelas,
  PESSOA_A,
  PESSOA_B,
  PoolDeMentira,
  WORKSPACE_A,
  WORKSPACE_B,
} from "./helpers/banco-de-mentira";

const URL_FALSA = "http://localhost:54321";
/** De propósito uma chave sem valor nenhum: a identidade NÃO vem dela. */
const CHAVE_FALSA = "chave-anon-que-nao-vale-nada";

const JOB_A = "aaaa1111-1111-4111-8111-111111111111";
const JOB_B = "bbbb2222-2222-4222-8222-222222222222";

/**
 * Monta a dupla (ponte + cliente do Supabase) do jeito que
 * `lib/automation/impersonate.ts` monta em produção.
 *
 * O `as unknown as pg.Pool` é o único do arquivo, e ele é honesto: o objeto de
 * mentira implementa `connect()` devolvendo um cliente com `query()` e
 * `release()`, que é tudo o que a ponte usa. Tipar isso "de verdade" exigiria
 * arrastar a interface inteira do `pg` pra dentro do teste sem ganhar nada.
 */
function montarSessao(pool: PoolDeMentira, sub: string, jobId: string) {
  const ponte = createBridgeFetch({
    pool: pool as unknown as pg.Pool,
    claims: { sub, role: "authenticated" },
    jobId,
  });

  const supabase: SupabaseClient<Database> = createClient<Database>(URL_FALSA, CHAVE_FALSA, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: ponte },
  });

  return { ponte, supabase };
}

function lerFonte(...pedacos: string[]): string {
  return readFileSync(join(process.cwd(), ...pedacos), "utf8");
}

// ===========================================================================
// 1. A IDENTIDADE VEM DA FILA, NUNCA DO PEDIDO (ameaça T5)
// ===========================================================================

describe("ninguém consegue pedir pro trabalhador rodar como outra pessoa", () => {
  test("o formato do pedido interno tem TRÊS campos, e nenhum deles é identidade", () => {
    const analisado = runJobRequestSchema.parse({
      jobId: JOB_A,
      workerId: "trabalhador-1",
      ts: Date.now(),
    });
    expect(Object.keys(analisado).sort()).toEqual(["jobId", "ts", "workerId"]);
  });

  test("mandar organização, agente ou identidade no pedido não tem efeito nenhum", () => {
    const analisado = runJobRequestSchema.parse({
      jobId: JOB_A,
      workerId: "trabalhador-1",
      ts: Date.now(),
      // A tentativa de escalar identidade, escrita do jeito mais direto:
      organizationId: WORKSPACE_B,
      runAs: PESSOA_B,
      agentId: "qualquer-um",
      role: "owner",
    } as Record<string, unknown>);

    expect(analisado).not.toHaveProperty("organizationId");
    expect(analisado).not.toHaveProperty("runAs");
    expect(analisado).not.toHaveProperty("agentId");
    expect(analisado).not.toHaveProperty("role");
  });

  test("a rota interna não lê organização nem identidade do pedido", () => {
    const fonte = lerFonte("app", "api", "internal", "run-job", "route.ts");
    // Se um dia alguém acrescentar isso aqui, a ameaça T5 volta a existir.
    expect(fonte).not.toMatch(/corpo\s*\)?\.\s*organizationId/);
    expect(fonte).not.toMatch(/corpo\s*\)?\.\s*runAs/);
    expect(fonte).not.toMatch(/corpo\s*\)?\.\s*userId/);
    // O ÚNICO dado do pedido que chega no motor é o número do trabalho.
    expect(fonte).toContain("executarTrabalho(pedido.data.jobId, pedido.data.workerId)");
  });

  test("quem roda o trabalho tira organização, agente e identidade da LINHA da fila", () => {
    const fonte = lerFonte("lib", "automation", "run-job.ts");
    expect(fonte).toContain("loadJobForRun(jobId, workerId)");
    expect(fonte).toContain("userId: job.runAs");
    expect(fonte).toContain("organizationId: job.organizationId");
    // O papel vem do banco (`memberships`), nunca fixado no código.
    expect(fonte).toContain("role: sessao.sessao.role");
    expect(fonte).not.toMatch(/role:\s*"(owner|admin|member)"/);
  });
});

// ===========================================================================
// 2. UM TRABALHO DO WORKSPACE A NÃO ALCANÇA O WORKSPACE B
// ===========================================================================

describe("um trabalho do workspace A não lê nem escreve dado do workspace B", () => {
  test("lendo COM filtro do próprio workspace: só vem o que é dele", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);

    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("organization_id", WORKSPACE_A);

    expect(error).toBeNull();
    expect(data?.map((t) => t.id)).toEqual(["t-a"]);
    await ponte.encerrar();
  });

  test("lendo com filtro do OUTRO workspace: zero linha", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);

    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("organization_id", WORKSPACE_B);

    expect(error).toBeNull();
    expect(data).toEqual([]);
    await ponte.encerrar();
  });

  test("lendo SEM FILTRO NENHUM: mesmo assim só vem o workspace da automação", async () => {
    // Este é o teste que importa de verdade. Ele prova que o isolamento é do
    // BANCO (a regra de segurança + `auth.uid()`), e não da disciplina de quem
    // escreveu a consulta. Uma ferramenta que "esquecesse" de filtrar não
    // enxergaria o vizinho.
    const pool = new PoolDeMentira(montarTabelas());
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);

    const { data, error } = await supabase.from("documents").select("*");

    expect(error).toBeNull();
    expect(data?.map((t) => t.id)).toEqual(["t-a"]);
    await ponte.encerrar();
  });

  test("gravando no OUTRO workspace: a regra de segurança recusa (42501)", async () => {
    const tabelas = montarTabelas();
    const pool = new PoolDeMentira(tabelas);
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);

    const { error } = await supabase.from("documents").insert({
      id: "invasora",
      organization_id: WORKSPACE_B,
      title: "documento plantado no vizinho",
      created_by: PESSOA_A,
      knowledge_base_id: "kb-fake",
      source_kind: "text",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    // E, o que mais importa: NADA foi gravado.
    expect(tabelas.documents.map((t) => t.id)).toEqual(["t-a", "t-b"]);
    await ponte.encerrar();
  });

  test("gravando no PRÓPRIO workspace: funciona normalmente", async () => {
    const tabelas = montarTabelas();
    const pool = new PoolDeMentira(tabelas);
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);

    const { error } = await supabase.from("documents").insert({
      id: "nova-do-a",
      organization_id: WORKSPACE_A,
      title: "documento do próprio workspace",
      created_by: PESSOA_A,
      knowledge_base_id: "kb-fake",
      source_kind: "text",
    });

    expect(error).toBeNull();
    expect(tabelas.documents.map((t) => t.id)).toContain("nova-do-a");
    await ponte.encerrar();
  });

  test("a chave anônima do Supabase NÃO decide nada: quem decide é o `sub`", async () => {
    // A ponte ignora o cabeçalho `Authorization` de propósito. Se ela olhasse
    // pra ele, dava pra trocar a identidade pelo lado de fora.
    const pool = new PoolDeMentira(montarTabelas());
    const { ponte, supabase } = montarSessao(pool, PESSOA_B, JOB_B);

    const { data } = await supabase.from("documents").select("*");
    expect(data?.map((t) => t.id)).toEqual(["t-b"]);

    const preambulo = pool.consultas.find((c) => c.text.includes("request.jwt.claims"));
    expect(preambulo?.values).toContain(JSON.stringify({ sub: PESSOA_B, role: "authenticated" }));
    await ponte.encerrar();
  });
});

// ===========================================================================
// 3. O ENVELOPE: papel de sessão (R1) e transação sempre (R2)
// ===========================================================================

describe("o envelope de toda consulta", () => {
  test("nenhuma consulta de dado sai fora de transação, e nenhuma sai como postgres", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);

    await supabase.from("documents").select("*").eq("organization_id", WORKSPACE_A);
    await supabase.from("memberships").select("role").eq("user_id", PESSOA_A);

    const deDados = pool.consultasDeDados();
    expect(deDados.length).toBeGreaterThan(0);
    for (const consulta of deDados) {
      expect(consulta.dentroDeTransacao, `sem BEGIN: ${consulta.text}`).toBe(true);
      expect(consulta.papel, `papel errado em: ${consulta.text}`).toBe("authenticated");
      expect(consulta.sub, `sem identidade em: ${consulta.text}`).toBe(PESSOA_A);
    }

    await ponte.encerrar();
  });

  test("os três set_config usam is_local = true", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);
    await supabase.from("documents").select("*");

    const preambulo = pool.consultas.find((c) => c.text.includes("set_config("));
    expect(preambulo).toBeDefined();
    const texto = preambulo?.text ?? "";

    for (const chave of ["role", "request.jwt.claims", "app.automation_job"]) {
      expect(texto).toMatch(
        new RegExp(`set_config\\('${chave.replace(".", "\\.")}', \\$\\d+, true\\)`),
      );
    }
    // Nenhum `false` escondido no meio.
    expect(texto).not.toContain(", false)");

    await ponte.encerrar();
  });

  test("a marca app.automation_job é o número do trabalho da fila", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);
    await supabase.from("documents").select("*");

    const preambulo = pool.consultas.find((c) => c.text.includes("app.automation_job"));
    expect(preambulo?.values.at(-1)).toBe(JOB_A);
    await ponte.encerrar();
  });

  test("conexão que ficou como postgres é RECUSADA e destruída", async () => {
    // Imita o `set role authenticated` do `connect` tendo falhado. Sem esta
    // recusa, a automação rodaria como DONO das tabelas — e a regra de
    // segurança do banco não valeria pra nada.
    const pool = new PoolDeMentira(montarTabelas(), false);
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);

    const { data, error } = await supabase.from("documents").select("*");

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(pool.clientes[0]?.destruido).toBe(true);
    await ponte.encerrar();
  });
});

// ===========================================================================
// 4. A IDENTIDADE NÃO SOBRA PRO PRÓXIMO TRABALHO (ameaça T8)
// ===========================================================================

describe("a identidade de um trabalho não vaza pro seguinte", () => {
  test("dois trabalhos seguidos no mesmo conjunto de conexões não se misturam", async () => {
    const pool = new PoolDeMentira(montarTabelas());

    // Trabalho 1: workspace A.
    const primeiro = montarSessao(pool, PESSOA_A, JOB_A);
    const um = await primeiro.supabase.from("documents").select("*");
    expect(um.data?.map((t) => t.id)).toEqual(["t-a"]);
    await primeiro.ponte.encerrar();

    // A conexão do primeiro trabalho foi DESTRUÍDA, não devolvida pro
    // conjunto. Estado de sessão nunca sobrevive a um trabalho.
    expect(pool.clientes[0]?.destruido).toBe(true);
    expect(pool.clientes[0]?.local).toEqual({});

    // Trabalho 2: workspace B, no mesmo conjunto.
    const segundo = montarSessao(pool, PESSOA_B, JOB_B);
    const dois = await segundo.supabase.from("documents").select("*");
    expect(dois.data?.map((t) => t.id)).toEqual(["t-b"]);
    await segundo.ponte.encerrar();

    // São conexões diferentes, e NENHUMA consulta feita na segunda conexão
    // rodou com a identidade do primeiro trabalho.
    expect(pool.clientes.length).toBe(2);
    const doSegundo = pool.consultas.filter((c) => c.clienteId === 1);
    expect(doSegundo.length).toBeGreaterThan(0);
    for (const consulta of doSegundo) {
      expect(consulta.sub, `vazou a identidade em: ${consulta.text}`).not.toBe(PESSOA_A);
    }
  });

  test("depois do commit as configurações locais somem", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const { ponte, supabase } = montarSessao(pool, PESSOA_A, JOB_A);
    await supabase.from("documents").select("*");

    // O Postgres de mentira limpa as locais no `commit`, igual ao de verdade.
    // Se algum dia a ponte mandar `is_local = false`, ele estoura antes disso.
    expect(pool.clientes[0]?.local).toEqual({});
    await ponte.encerrar();
  });
});

// ===========================================================================
// 5. A PONTE SERVE /rest/v1 E MAIS NADA (R5)
// ===========================================================================

describe("a ponte recusa o que ela não sabe fazer, com nome", () => {
  const proibidos = [
    `${URL_FALSA}/storage/v1/object/knowledge-docs/arquivo.pdf`,
    `${URL_FALSA}/auth/v1/token?grant_type=password`,
    `${URL_FALSA}/realtime/v1/websocket`,
    `${URL_FALSA}/functions/v1/minha-funcao`,
  ];

  for (const endereco of proibidos) {
    test(`recusa ${new URL(endereco).pathname}`, async () => {
      const pool = new PoolDeMentira(montarTabelas());
      const ponte: PonteFetch = createBridgeFetch({
        pool: pool as unknown as pg.Pool,
        claims: { sub: PESSOA_A, role: "authenticated" },
        jobId: JOB_A,
      });

      await expect(ponte(endereco)).rejects.toSatisfy(isBridgeUnsupportedError);
      // E fica anotado, pra o agendamento ser PAUSADO em vez de falhar todo
      // dia calado.
      expect(ponte.recursoNaoSuportado()).not.toBeNull();
      await ponte.encerrar();
    });
  }

  test("tabela fora da lista fechada é recusada", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = createBridgeFetch({
      pool: pool as unknown as pg.Pool,
      claims: { sub: PESSOA_A, role: "authenticated" },
      jobId: JOB_A,
    });

    await expect(ponte(`${URL_FALSA}/rest/v1/credentials?select=*`)).rejects.toSatisfy(
      isBridgeUnsupportedError,
    );
    await ponte.encerrar();
  });

  test("função fora da lista fechada é recusada", async () => {
    const pool = new PoolDeMentira(montarTabelas());
    const ponte = createBridgeFetch({
      pool: pool as unknown as pg.Pool,
      claims: { sub: PESSOA_A, role: "authenticated" },
      jobId: JOB_A,
    });

    await expect(
      ponte(`${URL_FALSA}/rest/v1/rpc/save_credential`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ _provider: "openai" }),
      }),
    ).rejects.toSatisfy(isBridgeUnsupportedError);
    await ponte.encerrar();
  });
});
