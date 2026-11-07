/**
 * A PROVA DE ISOLAMENTO ENTRE WORKSPACES — o teto e o medidor.
 *
 * Uma pergunta só: **quem está no workspace A consegue, de algum jeito, ver
 * (ou mexer no) gasto do workspace B?**
 *
 * As duas tabelas novas guardam dinheiro, e dinheiro é o dado que mais
 * interessa a quem for bisbilhotar: `org_ai_limits` diz quanto o time pode
 * gastar, `org_ai_spend` diz quanto ele já gastou. As duas entram sozinhas em
 * `OrgScopedTable` (elas têm `organization_id`), o que quer dizer que uma
 * FERRAMENTA de agente também alcança as duas — por isso a prova aqui cobre os
 * dois caminhos: a leitura das telas e o `ctx.db` das ferramentas.
 *
 * O dublê de banco FILTRA de verdade: ele guarda linhas dos DOIS workspaces e
 * aplica cada `eq`/`gte` que a consulta acumulou. E a função
 * `org_ai_budget_status` do dublê imita a de verdade — ela responde pelo
 * `_organization_id` que recebeu, que é o que a versão `security definer` do
 * banco faz depois de conferir `is_org_member`.
 *
 * O que ele NÃO prova (e não tem como, sem banco): a RLS do Postgres e o
 * `is_org_member` de dentro da função, que são a PRIMEIRA camada. Essas moram
 * na migration `20260821040000_teto_de_gasto.sql`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createOrgScopedDb } from "@/lib/agents/tool-context";
import { getBudgetStatus, getMonthlySpendHistory } from "@/lib/limits/queries";
import type { Database } from "@/types/supabase";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

type Linha = Record<string, unknown>;

type Chamada = {
  tabela: string;
  operacao: "select" | "insert" | "update" | "delete";
  filtros: Array<[string, unknown]>;
  valores: Linha | null;
};

/**
 * Um banco de mentira que guarda linhas dos DOIS workspaces e aplica os
 * filtros de verdade. Assim o teste prova comportamento, e não só "a função
 * foi chamada".
 */
function criarBancoFalso(tabelas: Record<string, Linha[]>) {
  const chamadas: Chamada[] = [];

  function thenable<T>(valor: T) {
    return {
      // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
      then: (onOk: (v: T) => unknown) => Promise.resolve(onOk(valor)),
    };
  }

  /**
   * O PostgREST só vai ao banco quando alguém espera o resultado — e é isso
   * que faz `.eq()` depois do `.select()` valer. Um dublê que resolve na hora
   * da montagem responderia SEM os filtros, e o teste passaria dizendo que
   * está tudo isolado enquanto o vizinho aparece na lista.
   */
  function thenablePreguicoso<T>(calcular: () => T) {
    return {
      // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
      then: (onOk: (v: T) => unknown) => Promise.resolve(onOk(calcular())),
    };
  }

  function consultar(tabela: string, chamada: Chamada) {
    const linhas = (tabelas[tabela] ?? []).filter((linha) =>
      chamada.filtros.every(([coluna, valor]) => {
        if (coluna.startsWith(">=")) {
          return String(linha[coluna.slice(2)]) >= String(valor);
        }
        return linha[coluna] === valor;
      }),
    );
    return { data: linhas, error: null };
  }

  const cliente = {
    rpc(nome: string, args: Linha) {
      chamadas.push({
        tabela: `rpc:${nome}`,
        operacao: "select",
        filtros: Object.entries(args ?? {}),
        valores: null,
      });

      if (nome === "org_ai_budget_status") {
        // A função de verdade é `security definer` e confere `is_org_member`
        // antes de responder. Aqui ela responde SÓ pelo workspace pedido — que
        // é o mesmo efeito.
        const orgPedida = args._organization_id;
        const linha = (tabelas.budget_status ?? []).find((l) => l.organization_id === orgPedida);
        return thenable({ data: linha ? [linha] : [], error: null });
      }
      return thenable({ data: null, error: null });
    },

    from(tabela: string) {
      const chamada: Chamada = { tabela, operacao: "select", filtros: [], valores: null };

      function encadear() {
        const consulta = {
          eq: (coluna: string, valor: unknown) => {
            chamada.filtros.push([coluna, valor]);
            return consulta;
          },
          gte: (coluna: string, valor: unknown) => {
            chamada.filtros.push([`>=${coluna}`, valor]);
            return consulta;
          },
          order: () => consulta,
          limit: () => consulta,
          maybeSingle: () => thenablePreguicoso(() => consultar(tabela, chamada)),
          ...thenablePreguicoso(() => consultar(tabela, chamada)),
        };
        return consulta;
      }

      return {
        select() {
          chamadas.push(chamada);
          return encadear();
        },
        insert(valores: Linha) {
          chamada.operacao = "insert";
          chamada.valores = valores;
          chamadas.push(chamada);
          return thenable({ data: null, error: null });
        },
        update(valores: Linha) {
          chamada.operacao = "update";
          chamada.valores = valores;
          chamadas.push(chamada);
          return encadear();
        },
        delete() {
          chamada.operacao = "delete";
          chamadas.push(chamada);
          return encadear();
        },
      };
    },
  };

  return { cliente: cliente as unknown as SupabaseClient<Database>, chamadas };
}

function linhaDeGasto(org: string, day: string, agent: number, embedding = 0): Linha {
  return {
    organization_id: org,
    day,
    agent_micros: agent,
    embedding_micros: embedding,
    unpriced_runs: 0,
    unpriced_documents: 0,
    updated_at: `${day}T12:00:00Z`,
  };
}

// ---------------------------------------------------------------------------

describe("a leitura do teto (as telas e o motor)", () => {
  it("cada workspace lê o SEU teto, e o do vizinho não vaza", async () => {
    const banco = criarBancoFalso({
      budget_status: [
        {
          organization_id: ORG_A,
          month: "2026-08-01",
          day: "2026-08-21",
          monthly_budget_micros: 20_000_000,
          effective_monthly_micros: 20_000_000,
          month_spent_micros: 3_470_000,
          blocked: false,
          blocked_by: null,
        },
        {
          organization_id: ORG_B,
          month: "2026-08-01",
          day: "2026-08-21",
          monthly_budget_micros: 999_000_000,
          effective_monthly_micros: 999_000_000,
          month_spent_micros: 888_000_000,
          blocked: true,
          blocked_by: "mes",
        },
      ],
    });

    const a = await getBudgetStatus({ organizationId: ORG_A, supabase: banco.cliente });
    expect(a?.monthlyBudgetMicros).toBe(20_000_000);
    expect(a?.monthSpentMicros).toBe(3_470_000);
    expect(a?.blocked).toBe(false);

    // O workspace B está parado e gastou 100 vezes mais — e nada disso
    // apareceu na leitura de A.
    const b = await getBudgetStatus({ organizationId: ORG_B, supabase: banco.cliente });
    expect(b?.blocked).toBe(true);
    expect(b?.monthSpentMicros).toBe(888_000_000);
  });

  it("a leitura SEMPRE manda o workspace — não existe chamada sem ele", async () => {
    const banco = criarBancoFalso({ budget_status: [] });
    await getBudgetStatus({ organizationId: ORG_A, supabase: banco.cliente });

    const chamada = banco.chamadas.find((c) => c.tabela === "rpc:org_ai_budget_status");
    expect(chamada?.filtros).toEqual([["_organization_id", ORG_A]]);
  });

  it("workspace sem linha nenhuma devolve nulo, e não a linha de outro", async () => {
    const banco = criarBancoFalso({
      budget_status: [{ organization_id: ORG_B, month_spent_micros: 5 }],
    });
    expect(await getBudgetStatus({ organizationId: ORG_A, supabase: banco.cliente })).toBeNull();
  });
});

describe("o histórico de gasto", () => {
  it("soma só os dias do PRÓPRIO workspace", async () => {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, "0");

    const banco = criarBancoFalso({
      org_ai_spend: [
        linhaDeGasto(ORG_A, `${ano}-${mes}-01`, 1_000_000, 200_000),
        linhaDeGasto(ORG_A, `${ano}-${mes}-02`, 500_000),
        // A linha do vizinho, plantada no MESMO dia e com valor gritante.
        linhaDeGasto(ORG_B, `${ano}-${mes}-01`, 900_000_000),
      ],
    });

    const historico = await getMonthlySpendHistory({
      organizationId: ORG_A,
      months: 3,
      supabase: banco.cliente,
    });

    expect(historico).toHaveLength(3);
    // O mês corrente vem primeiro, e ele traz 1,0 + 0,2 + 0,5 — sem o vizinho.
    expect(historico[0]?.spentMicros).toBe(1_700_000);
    for (const mesDoHistorico of historico) {
      expect(mesDoHistorico.spentMicros).toBeLessThan(900_000_000);
    }
  });

  it("a consulta carrega o filtro de workspace, sempre", async () => {
    const banco = criarBancoFalso({ org_ai_spend: [] });
    await getMonthlySpendHistory({ organizationId: ORG_A, supabase: banco.cliente });

    const chamada = banco.chamadas.find((c) => c.tabela === "org_ai_spend");
    expect(chamada?.filtros).toContainEqual(["organization_id", ORG_A]);
  });

  it("mês sem gasto nenhum vem com zero, e não some da lista", async () => {
    const banco = criarBancoFalso({ org_ai_spend: [] });
    const historico = await getMonthlySpendHistory({
      organizationId: ORG_A,
      months: 6,
      supabase: banco.cliente,
    });
    expect(historico).toHaveLength(6);
    expect(historico.every((m) => m.spentMicros === 0)).toBe(true);
    // E cada mês é um primeiro dia de mês, do mais novo pro mais antigo.
    expect(historico.every((m) => m.month.endsWith("-01"))).toBe(true);
  });
});

describe("o caminho das FERRAMENTAS (ctx.db)", () => {
  // As duas tabelas entram sozinhas em `OrgScopedTable`, então uma ferramenta
  // de agente consegue pedir as duas. O `ctx.db` é o que garante que ela só
  // enxerga o próprio workspace — a RLS do banco é a primeira camada, esta é a
  // segunda.
  const dadosDosDois = {
    org_ai_limits: [
      { organization_id: ORG_A, monthly_budget_micros: 20_000_000, hard_stop: true },
      { organization_id: ORG_B, monthly_budget_micros: 999_000_000, hard_stop: false },
    ],
    org_ai_spend: [
      linhaDeGasto(ORG_A, "2026-08-21", 3_470_000),
      linhaDeGasto(ORG_B, "2026-08-21", 888_000_000),
    ],
  };

  it("uma ferramenta do workspace A só vê o teto do workspace A", async () => {
    const banco = criarBancoFalso(dadosDosDois);
    const db = createOrgScopedDb(banco.cliente, ORG_A);

    const { data } = await db.from("org_ai_limits").select();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.organization_id).toBe(ORG_A);
    expect(data?.[0]?.monthly_budget_micros).toBe(20_000_000);
  });

  it("uma ferramenta do workspace A só vê o medidor do workspace A", async () => {
    const banco = criarBancoFalso(dadosDosDois);
    const db = createOrgScopedDb(banco.cliente, ORG_A);

    const { data } = await db.from("org_ai_spend").select();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.organization_id).toBe(ORG_A);
  });

  it("gravar pelo ctx.db carimba o workspace da execução, nunca outro", async () => {
    // Na prática o banco recusa a gravação com 42501 (ninguém logado tem
    // permissão de escrita nessas duas tabelas, nem quem administra). Esta
    // prova é da SEGUNDA camada: mesmo que a permissão mudasse, o carimbo
    // continuaria sendo o do workspace da execução.
    const banco = criarBancoFalso(dadosDosDois);
    const db = createOrgScopedDb(banco.cliente, ORG_A);

    await db.from("org_ai_spend").insert({
      day: "2026-08-21",
      agent_micros: 1,
      // Uma ferramenta mal escrita tentando escrever no workspace do vizinho.
      organization_id: ORG_B,
    } as never);

    const gravacao = banco.chamadas.find(
      (c) => c.tabela === "org_ai_spend" && c.operacao === "insert",
    );
    expect(gravacao?.valores?.organization_id).toBe(ORG_A);
  });

  it("apagar pelo ctx.db também é preso ao workspace da execução", async () => {
    const banco = criarBancoFalso(dadosDosDois);
    const db = createOrgScopedDb(banco.cliente, ORG_A);

    await db.from("org_ai_limits").delete();

    const remocao = banco.chamadas.find(
      (c) => c.tabela === "org_ai_limits" && c.operacao === "delete",
    );
    expect(remocao?.filtros).toEqual([["organization_id", ORG_A]]);
  });
});
