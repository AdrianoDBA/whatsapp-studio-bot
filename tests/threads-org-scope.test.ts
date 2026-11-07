/**
 * A PROVA DE ISOLAMENTO ENTRE WORKSPACES — conversas e mensagens.
 *
 * Uma pergunta só: **quem está no workspace A consegue, de algum jeito, ler ou
 * escrever conversa do workspace B?**
 *
 * A resposta precisa ser NÃO inclusive quando quem chama passa o id certo da
 * conversa do outro workspace — porque um id de conversa aparece na URL, e URL
 * é a primeira coisa que alguém troca pra ver o que acontece.
 *
 * O dublê de banco aqui FILTRA de verdade: ele guarda linhas dos DOIS
 * workspaces e aplica cada `eq` que a consulta acumulou. Assim o teste prova
 * comportamento, não só "a função foi chamada com o argumento certo".
 *
 * O que ele NÃO prova (e não tem como, sem banco): a RLS do Postgres, que é a
 * PRIMEIRA camada. As policies de `threads` e `thread_messages` estão na
 * migration `20260821000000_threads.sql`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { appendMessage, ensureTitle, loadHistory } from "@/lib/threads/persist";
import {
  getLatestThreadId,
  getThread,
  getThreadMessages,
  listThreads,
} from "@/lib/threads/queries";
import type { Database } from "@/types/supabase";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const AGENTE = "44444444-4444-4444-8444-444444444444";
const PESSOA_A = "99999999-9999-4999-8999-999999999999";

const CONVERSA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Linha = Record<string, unknown>;

type Chamada = {
  tabela: string;
  operacao: "select" | "insert" | "update" | "delete";
  filtros: Array<[string, unknown]>;
  valores: Linha | null;
};

function criarSupabaseFalso(dados: Record<string, Linha[]>) {
  const chamadas: Chamada[] = [];

  function construir(tabela: string, operacao: Chamada["operacao"], valores: Linha | null) {
    const registro: Chamada = { tabela, operacao, filtros: [], valores };
    chamadas.push(registro);

    const predicados: Array<(l: Linha) => boolean> = [];
    let limite = Number.POSITIVE_INFINITY;

    function resolver(): { data: Linha[]; error: null } {
      if (operacao === "insert") {
        const linha = valores ?? {};
        const existentes = dados[tabela] ?? [];
        existentes.push(linha);
        dados[tabela] = existentes;
        return { data: [linha], error: null };
      }
      const base = (dados[tabela] ?? []).filter((l) => predicados.every((p) => p(l)));
      if (operacao === "update") {
        for (const linha of base) Object.assign(linha, valores ?? {});
      }
      return { data: base.slice(0, limite), error: null };
    }

    const api = {
      eq(coluna: string, valor: unknown) {
        registro.filtros.push([coluna, valor]);
        predicados.push((l) => l[coluna] === valor);
        return api;
      },
      is(coluna: string, valor: unknown) {
        registro.filtros.push([coluna, valor]);
        predicados.push((l) => (l[coluna] ?? null) === valor);
        return api;
      },
      order() {
        return api;
      },
      limit(n: number) {
        limite = n;
        return api;
      },
      select() {
        return api;
      },
      maybeSingle() {
        return {
          // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
          then(onOk: (r: { data: Linha | null; error: null }) => unknown) {
            const { data } = resolver();
            return Promise.resolve(onOk({ data: data[0] ?? null, error: null }));
          },
        };
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
      return {
        select: () => construir(tabela, "select", null),
        insert: (valores: Linha) => construir(tabela, "insert", valores),
        update: (valores: Linha) => construir(tabela, "update", valores),
        delete: () => construir(tabela, "delete", null),
      };
    },
  };

  return {
    // O dublê só implementa o pedaço da API que estas funções usam. É a única
    // asserção de tipo do arquivo, e ela é de teste.
    cliente: cliente as unknown as SupabaseClient<Database>,
    chamadas,
    dados,
  };
}

function conversasDosDoisWorkspaces(): Record<string, Linha[]> {
  return {
    threads: [
      {
        id: CONVERSA_A,
        organization_id: ORG_A,
        agent_id: AGENTE,
        user_id: PESSOA_A,
        title: null,
        message_count: 2,
        last_message_at: "2026-08-20T10:00:00Z",
        created_at: "2026-08-20T09:00:00Z",
        updated_at: "2026-08-20T10:00:00Z",
        autor: { full_name: "Ana" },
      },
      {
        id: CONVERSA_B,
        organization_id: ORG_B,
        agent_id: AGENTE,
        user_id: "77777777-7777-4777-8777-777777777777",
        title: "Segredo do workspace B",
        message_count: 5,
        last_message_at: "2026-08-20T11:00:00Z",
        created_at: "2026-08-20T08:00:00Z",
        updated_at: "2026-08-20T11:00:00Z",
        autor: { full_name: "Beto" },
      },
    ],
    thread_messages: [
      {
        id: "ma1",
        organization_id: ORG_A,
        thread_id: CONVERSA_A,
        role: "user",
        parts: [{ type: "text", text: "pergunta do A" }],
        metadata: null,
        seq: 1,
      },
      {
        id: "mb1",
        organization_id: ORG_B,
        thread_id: CONVERSA_B,
        role: "user",
        parts: [{ type: "text", text: "SEGREDO DO B" }],
        metadata: null,
        seq: 1,
      },
      {
        // A pior linha possível: mesma CONVERSA do A, mas carimbada com o
        // workspace B. Se alguma consulta filtrasse só por `thread_id`, o
        // segredo vazaria por aqui.
        id: "mb2",
        organization_id: ORG_B,
        thread_id: CONVERSA_A,
        role: "assistant",
        parts: [{ type: "text", text: "SEGREDO PLANTADO NA CONVERSA DO A" }],
        metadata: null,
        seq: 2,
      },
    ],
  };
}

function textoDe(partes: unknown): string {
  return JSON.stringify(partes);
}

// ---------------------------------------------------------------------------

describe("listThreads", () => {
  it("A não vê a conversa de B", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    const lista = await listThreads(banco.cliente, ORG_A, { agentId: AGENTE });

    expect(lista).toHaveLength(1);
    expect(lista[0]?.id).toBe(CONVERSA_A);
    expect(JSON.stringify(lista)).not.toContain("Segredo do workspace B");
  });

  it("filtra por organization_id em TODA consulta", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    await listThreads(banco.cliente, ORG_A, { agentId: AGENTE, userId: PESSOA_A });

    for (const chamada of banco.chamadas) {
      expect(chamada.filtros.map(([c]) => c)).toContain("organization_id");
    }
  });

  it("`isMine` só é verdade pra quem começou a conversa", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    const lista = await listThreads(banco.cliente, ORG_A, { agentId: AGENTE, userId: PESSOA_A });
    expect(lista[0]?.isMine).toBe(true);
  });
});

describe("getThread", () => {
  it("pedindo a conversa de B com o id certo, de dentro do A, volta nada", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    const conversa = await getThread(banco.cliente, ORG_A, CONVERSA_B);
    expect(conversa).toBeNull();
  });

  it("a própria conversa volta normal", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    const conversa = await getThread(banco.cliente, ORG_A, CONVERSA_A);
    expect(conversa?.id).toBe(CONVERSA_A);
  });
});

describe("getThreadMessages / loadHistory", () => {
  it("linha carimbada com outro workspace NÃO entra na conversa", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    const balões = await getThreadMessages(banco.cliente, ORG_A, CONVERSA_A);

    expect(balões).toHaveLength(1);
    expect(textoDe(balões)).not.toContain("SEGREDO PLANTADO");
  });

  it("o histórico que vai pro MODELO também não carrega o de fora", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    const historico = await loadHistory({
      supabase: banco.cliente,
      organizationId: ORG_A,
      threadId: CONVERSA_A,
      tools: {},
    });

    expect(historico).toHaveLength(1);
    expect(textoDe(historico)).not.toContain("SEGREDO");
  });

  it("pedir a conversa de B de dentro do A volta vazio", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    const balões = await getThreadMessages(banco.cliente, ORG_A, CONVERSA_B);
    expect(balões).toHaveLength(0);
  });
});

describe("getLatestThreadId", () => {
  it("só acha conversa do próprio workspace", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    expect(await getLatestThreadId(banco.cliente, ORG_A, AGENTE, PESSOA_A)).toBe(CONVERSA_A);
    expect(
      await getLatestThreadId(banco.cliente, ORG_A, AGENTE, "77777777-7777-4777-8777-777777777777"),
    ).toBeNull();
  });
});

describe("gravação", () => {
  it("appendMessage carimba o workspace de quem chamou, sempre", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    await appendMessage({
      supabase: banco.cliente,
      organizationId: ORG_A,
      threadId: CONVERSA_A,
      role: "user",
      message: { id: "nova", role: "user", parts: [{ type: "text", text: "oi" }] },
      runId: null,
    });

    const gravada = banco.chamadas.find((c) => c.operacao === "insert");
    expect(gravada?.tabela).toBe("thread_messages");
    expect(gravada?.valores?.organization_id).toBe(ORG_A);
  });

  it("ensureTitle não renomeia conversa de outro workspace", async () => {
    const banco = criarSupabaseFalso(conversasDosDoisWorkspaces());
    await ensureTitle({
      supabase: banco.cliente,
      organizationId: ORG_A,
      // O id da conversa do OUTRO workspace, com o título ainda vazio? Não:
      // aqui ela tem título. O que importa é que o filtro de workspace impede
      // a escrita de qualquer jeito.
      threadId: CONVERSA_B,
      texto: "titulo forjado",
    });

    const conversaB = banco.dados.threads?.find((l) => l.id === CONVERSA_B);
    expect(conversaB?.title).toBe("Segredo do workspace B");

    const escrita = banco.chamadas.find((c) => c.operacao === "update");
    expect(escrita?.filtros.map(([c]) => c)).toContain("organization_id");
  });
});
