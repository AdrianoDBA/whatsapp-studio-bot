/**
 * A PROVA DE ISOLAMENTO ENTRE WORKSPACES.
 *
 * É o teste mais importante de `lib/agents`. Ele responde uma pergunta só:
 *
 *   "Uma ferramenta rodando no workspace A consegue, de algum jeito, enxergar
 *    dado do workspace B?"
 *
 * A resposta precisa ser NÃO mesmo quando quem escreveu a ferramenta tenta —
 * porque num template que o aluno vai copiar, a ferramenta errada é escrita
 * cedo ou tarde.
 *
 * O dublê de banco aqui FILTRA de verdade: ele guarda linhas dos dois
 * workspaces e aplica cada `eq`/`ilike` que a consulta acumulou. Assim o teste
 * prova comportamento, não só "a função foi chamada".
 *
 * O que ele NÃO prova (e não tem como): a RLS do Postgres, que é a primeira
 * camada. Isso é provado contra o banco de verdade — ver a etapa 1.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolCallOptions } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Acoes } from "@/lib/agents/acoes";
import { defineTool, falhaDeFerramenta, isToolFailure } from "@/lib/agents/define-tool";
import type { RunRecorder } from "@/lib/agents/recorder";
import {
  createOrgScopedDb,
  type OrgScopedTable,
  type ToolContext,
} from "@/lib/agents/tool-context";
import { buildToolSet, MAX_TOOL_OUTPUT_CHARS } from "@/lib/agents/tool-runtime";
import { createOrgScopedKnowledge } from "@/lib/knowledge/search";
import type { Database } from "@/types/supabase";

/**
 * Um `ctx.acao` de mentira. `email` ecoa a entrada em `oQueEuFaria` — é o que
 * deixa os testes de `mandar-email` (seção 4) controlar o tamanho da
 * resposta, pra provar o corte de `MAX_TOOL_OUTPUT_CHARS` sem precisar de
 * banco nenhum.
 */
function acaoFalsa(): Acoes {
  return {
    async email(p) {
      return { ok: true, simulado: true, oQueEuFaria: { ...p } };
    },
    async http() {
      return { ok: true, simulado: true, oQueEuFaria: {} };
    },
  };
}

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// Dublê de banco
// ---------------------------------------------------------------------------

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
      const base = dados[tabela] ?? [];
      return {
        data: base.filter((l) => predicados.every((p) => p(l))).slice(0, limite),
        error: null,
      };
    }

    const api = {
      eq(coluna: string, valor: unknown) {
        registro.filtros.push([coluna, valor]);
        predicados.push((l) => l[coluna] === valor);
        return api;
      },
      ilike(coluna: string, padrao: string) {
        const termo = padrao.replaceAll("%", "").replaceAll("\\", "").toLowerCase();
        predicados.push((l) =>
          String(l[coluna] ?? "")
            .toLowerCase()
            .includes(termo),
        );
        return api;
      },
      order() {
        return api;
      },
      limit(n: number) {
        limite = n;
        return api;
      },
      abortSignal() {
        return api;
      },
      select() {
        return api;
      },
      single() {
        return {
          // O construtor de consulta do PostgREST é justamente um objeto com
          // `then`: é o que faz `await consulta` disparar a chamada. O dublê
          // precisa imitar isso pro código sob teste rodar sem mudança nenhuma.
          // biome-ignore lint/suspicious/noThenProperty: imita o PostgREST
          then(onOk: (r: { data: Linha | null; error: null }) => unknown) {
            const { data } = resolver();
            return Promise.resolve(onOk({ data: data[0] ?? null, error: null }));
          },
        };
      },
      // Mesmo motivo do `single` logo acima.
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
    // O dublê só implementa o pedaço da API que o `createOrgScopedDb` usa.
    // Esta é a única asserção de tipo do arquivo, e ela é de teste.
    cliente: cliente as unknown as SupabaseClient<Database>,
    chamadas,
    dados,
  };
}

/**
 * `tasks` saiu do template (Onda "código é o dono" — a demo de tarefas foi
 * embora, e junto foi `consultar-tarefas`). `memberships` está aqui só como
 * tabela org-scoped de exemplo pra provar o isolamento do `ctx.db`: qualquer
 * tabela com `organization_id` serviria, esta é só a mais simples de montar.
 */
function membrosDosDoisWorkspaces(): Record<string, Linha[]> {
  return {
    memberships: [
      {
        id: "a1",
        organization_id: ORG_A,
        user_id: "Segredo do workspace A",
        role: "member",
        created_at: "2026-08-01T00:00:00Z",
      },
      {
        id: "a2",
        organization_id: ORG_A,
        user_id: "Outra coisa do A",
        role: "admin",
        created_at: "2026-08-02T00:00:00Z",
      },
      {
        id: "b1",
        organization_id: ORG_B,
        user_id: "Segredo do workspace B",
        role: "member",
        created_at: "2026-08-03T00:00:00Z",
      },
    ],
  };
}

function ctxDe(
  cliente: SupabaseClient<Database>,
  organizationId: string,
  role: ToolContext["role"] = "member",
): ToolContext {
  return {
    organizationId,
    organizationSlug: organizationId === ORG_A ? "workspace-a" : "workspace-b",
    organizationName: organizationId === ORG_A ? "Workspace A" : "Workspace B",
    userId: "99999999-9999-4999-8999-999999999999",
    role,
    runId: "33333333-3333-4333-8333-333333333333",
    agentSlug: "agente-de-teste",
    triggerKind: "manual",
    signal: undefined,
    db: createOrgScopedDb(cliente, organizationId),
    // A base de conhecimento entrou no `ToolContext` na onda 5. Ela é presa ao
    // MESMO workspace, pelo mesmo motivo do `db`.
    knowledge: createOrgScopedKnowledge(cliente, organizationId),
    // `modo`/`acao` entraram na onda 7. Nenhum teste deste arquivo exercita
    // ação — é só o `db` que importa aqui.
    modo: "real",
    acao: acaoFalsa(),
  };
}

function recorderFalso() {
  const passos: Array<{
    toolName: string;
    input: unknown;
    output: unknown;
    errorMessage: string | null;
  }> = [];
  const recorder: RunRecorder = {
    runId: "33333333-3333-4333-8333-333333333333",
    markModelStepStart() {},
    async recordModelStep() {},
    custoAcumuladoMicros: () => 0,
    async recordToolStep(p) {
      passos.push({
        toolName: p.toolName,
        input: p.input,
        output: p.output,
        errorMessage: p.errorMessage,
      });
    },
    // Nenhum teste deste arquivo passa por `ctx.acao` — este stub existe só
    // pra satisfazer o tipo `RunRecorder` (onda 7).
    async recordAcaoStep() {},
  };
  return { recorder, passos };
}

const opcoesDeChamada: ToolCallOptions = { toolCallId: "call-1", messages: [] };

// ---------------------------------------------------------------------------
// 1. O tipo já barra tabela sem organization_id
// ---------------------------------------------------------------------------

describe("OrgScopedTable — o que dá pra abrir de dentro de uma ferramenta", () => {
  type EhEscopada<T> = T extends OrgScopedTable ? true : false;

  it("aceita tabela que tem organization_id obrigatório e bloco em criarAcessos", () => {
    const agents: EhEscopada<"agents"> = true;
    const memberships: EhEscopada<"memberships"> = true;
    expect([agents, memberships]).toEqual([true, true]);
  });

  it("recusa profiles (não tem a coluna), credentials (a coluna aceita nulo) e tasks (órfã)", () => {
    // Se algum dia profiles/credentials virar `true`, uma ferramenta passaria a
    // conseguir abrir a tabela de chaves — e lá o `select("*")` nem tem
    // permissão de coluna.
    //
    // `tasks` é um caso diferente: ela TEM `organization_id`, mas saiu de
    // `criarAcessos()` junto com a demo de tarefas (Onda "código é o dono") —
    // um `Exclude` explícito em `OrgScopedTable` fecha esse desalinhamento.
    const profiles: EhEscopada<"profiles"> = false;
    const credentials: EhEscopada<"credentials"> = false;
    const organizations: EhEscopada<"organizations"> = false;
    const tasks: EhEscopada<"tasks"> = false;
    expect([profiles, credentials, organizations, tasks]).toEqual([false, false, false, false]);
  });
});

// ---------------------------------------------------------------------------
// 2. O isolamento em si
// ---------------------------------------------------------------------------

describe("ctx.db — isolamento entre workspaces", () => {
  it("leitura no workspace A não devolve NENHUMA linha do workspace B", async () => {
    const { cliente } = criarSupabaseFalso(membrosDosDoisWorkspaces());
    const db = createOrgScopedDb(cliente, ORG_A);

    const { data } = await db.from("memberships").select();

    expect(data?.map((l) => l.id).sort()).toEqual(["a1", "a2"]);
    expect(JSON.stringify(data)).not.toContain("workspace B");
  });

  it("o filtro de workspace vai na consulta mesmo sem ninguém pedir", async () => {
    const { cliente, chamadas } = criarSupabaseFalso(membrosDosDoisWorkspaces());
    await createOrgScopedDb(cliente, ORG_A).from("memberships").select();

    expect(chamadas[0]?.filtros).toContainEqual(["organization_id", ORG_A]);
  });

  it("a ferramenta NÃO consegue trocar o workspace: filtro só se acumula", async () => {
    const { cliente, chamadas } = criarSupabaseFalso(membrosDosDoisWorkspaces());
    const db = createOrgScopedDb(cliente, ORG_A);

    // Uma ferramenta mal escrita (ou mal-intencionada) tentando alcançar o
    // workspace B. O PostgREST ACUMULA filtro: o `eq` de cima continua lá, e
    // "organization_id = A e organization_id = B" não casa com nada.
    const { data } = await db.from("memberships").select().eq("organization_id", ORG_B);

    expect(data).toEqual([]);
    expect(chamadas[0]?.filtros).toEqual([
      ["organization_id", ORG_A],
      ["organization_id", ORG_B],
    ]);
  });

  it("gravação tem o organization_id escrito por cima, não o que a ferramenta mandou", async () => {
    const { cliente, chamadas } = criarSupabaseFalso({ memberships: [] });
    const db = createOrgScopedDb(cliente, ORG_A);

    // O TypeScript já recusa `organization_id` aqui (o parâmetro é um
    // `Omit<…, "organization_id">`). A asserção existe pra provar que, mesmo
    // furando a checagem em tempo de compilação, o valor é sobrescrito.
    const valores = { user_id: "tentativa", organization_id: ORG_B } as unknown as {
      user_id: string;
    };
    await db.from("memberships").insert(valores);

    expect(chamadas[0]?.operacao).toBe("insert");
    expect(chamadas[0]?.valores?.organization_id).toBe(ORG_A);
  });

  it("alteração e exclusão também saem presas ao workspace", async () => {
    const { cliente, chamadas } = criarSupabaseFalso(membrosDosDoisWorkspaces());
    const db = createOrgScopedDb(cliente, ORG_A);

    await db.from("memberships").update({ role: "admin" }).eq("id", "b1");
    await db.from("memberships").delete().eq("id", "b1");

    expect(chamadas[0]?.filtros).toContainEqual(["organization_id", ORG_A]);
    expect(chamadas[1]?.filtros).toContainEqual(["organization_id", ORG_A]);
  });

  it("recusa montar o acesso quando o workspace não é um id válido", () => {
    const { cliente } = criarSupabaseFalso({ memberships: [] });
    expect(() => createOrgScopedDb(cliente, "")).toThrow(/organizationId/);
    expect(() => createOrgScopedDb(cliente, "'; drop table memberships; --")).toThrow(
      /organizationId/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Uma ferramenta de verdade, rodando nos dois workspaces
// ---------------------------------------------------------------------------

/**
 * Ferramenta local SÓ DESTE ARQUIVO — não entra no `TOOL_REGISTRY`.
 *
 * A demo de tarefas saiu do template (Onda "código é o dono"), e junto foi
 * `consultar-tarefas` — a ferramenta que este describe testava. Hoje nenhuma
 * ferramenta do registro toca `ctx.db` diretamente (`buscar-na-base` usa
 * `ctx.knowledge`, `mandar-email` usa `ctx.acao`), então o teste mais
 * importante desta pasta — isolamento por workspace pela pilha inteira:
 * Zod → `ctx.db` → filtro acumulado — precisa da própria ferramenta local
 * pra continuar provando isso contra um `ToolSpec.run()` de verdade.
 */
const ferramentaDeConsulta = defineTool({
  id: "consulta-de-teste",
  label: "Consulta de teste",
  description: "Ferramenta de teste que lista membros do workspace, só pra provar isolamento.",
  inputSchema: z.object({
    busca: z
      .string()
      .min(2)
      .max(80)
      .optional()
      .describe("Pedaço do texto que a pessoa quer procurar."),
  }),
  async execute(input, ctx) {
    let consulta = ctx.db.from("memberships").select();
    if (input.busca) {
      const termo = input.busca.replace(/[\\%_]/g, "\\$&");
      consulta = consulta.ilike("user_id", `%${termo}%`);
    }
    const { data, error } = await consulta;
    if (error) throw new Error(`consulta-de-teste: ${error.code ?? "erro"}`);
    const linhas = data ?? [];
    if (linhas.length === 0) {
      return falhaDeFerramenta("Não achei nenhum membro com esses filtros neste workspace.");
    }
    return { total: linhas.length, membros: linhas };
  },
});

describe("consulta-de-teste — a mesma ferramenta em dois workspaces", () => {
  it("no workspace A vê só o que é do A; no B, só o que é do B", async () => {
    const { cliente } = criarSupabaseFalso(membrosDosDoisWorkspaces());

    const noA = await ferramentaDeConsulta.run({}, ctxDe(cliente, ORG_A));
    const noB = await ferramentaDeConsulta.run({}, ctxDe(cliente, ORG_B));

    expect(JSON.stringify(noA)).toContain("Segredo do workspace A");
    expect(JSON.stringify(noA)).not.toContain("Segredo do workspace B");

    expect(JSON.stringify(noB)).toContain("Segredo do workspace B");
    expect(JSON.stringify(noB)).not.toContain("Segredo do workspace A");
  });

  it("procurar pelo texto exato de um membro do outro workspace não acha nada", async () => {
    const { cliente } = criarSupabaseFalso(membrosDosDoisWorkspaces());

    const resultado = await ferramentaDeConsulta.run(
      { busca: "Segredo do workspace B" },
      ctxDe(cliente, ORG_A),
    );

    expect(isToolFailure(resultado)).toBe(true);
    expect(JSON.stringify(resultado)).not.toContain("b1");
  });

  it("entrada fora do formato volta como erro em português, sem exceção", async () => {
    const { cliente } = criarSupabaseFalso(membrosDosDoisWorkspaces());

    const resultado = await ferramentaDeConsulta.run({ busca: "a" }, ctxDe(cliente, ORG_A));

    expect(isToolFailure(resultado)).toBe(true);
    expect(isToolFailure(resultado) ? resultado.erro : "").toContain("Consulta de teste");
  });
});

// ---------------------------------------------------------------------------
// 4. buildToolSet — papel, id inexistente e teto de resposta
// ---------------------------------------------------------------------------

const ferramentaSoDeAdmin = defineTool({
  id: "so-admin",
  label: "Só admin",
  description: "Ferramenta de teste que só quem administra o workspace pode usar.",
  inputSchema: z.object({}),
  requiresRole: ["owner", "admin"],
  async execute() {
    return { ok: true };
  },
});

describe("buildToolSet — quem entra na execução", () => {
  it("id que não existe mais vira aviso em português, não erro", () => {
    const { cliente } = criarSupabaseFalso({ memberships: [] });
    const { recorder } = recorderFalso();

    const r = buildToolSet({
      toolIds: ["buscar-na-base", "ferramenta-que-foi-apagada"],
      ctx: ctxDe(cliente, ORG_A),
      recorder,
    });

    expect(r.enabledIds).toEqual(["buscar-na-base"]);
    expect(r.warnings.join(" ")).toContain("ferramenta-que-foi-apagada");
  });

  it("ferramenta de admin nem é oferecida ao modelo quando quem roda é membro comum", async () => {
    const { cliente } = criarSupabaseFalso({ memberships: [] });
    const { recorder } = recorderFalso();
    const ctx = ctxDe(cliente, ORG_A, "member");

    const r = buildToolSet({ toolIds: [], ctx, recorder });
    // A ferramenta de teste não está no registro global, então este caso é
    // provado direto no `run`, que repete a checagem (cinto e suspensório).
    expect(r.enabledIds).toEqual([]);

    const negada = await ferramentaSoDeAdmin.run({}, ctx);
    expect(isToolFailure(negada)).toBe(true);

    const permitida = await ferramentaSoDeAdmin.run({}, ctxDe(cliente, ORG_A, "admin"));
    expect(isToolFailure(permitida)).toBe(false);
  });

  // As duas próximas usam `mandar-email` (não `buscar-na-base`): é a ÚNICA
  // ferramenta do registro cuja resposta este arquivo consegue controlar sem
  // banco nenhum — `acaoFalsa()`, lá em cima, ecoa a entrada de volta. Por
  // `requiresRole`, o `ctx` das duas precisa ser "admin".

  it("resposta gigante de ferramenta vira pedido de recorte, e o passo fica no rastro", async () => {
    const { cliente } = criarSupabaseFalso({});
    const { recorder, passos } = recorderFalso();

    const conjunto = buildToolSet({
      toolIds: ["mandar-email"],
      ctx: ctxDe(cliente, ORG_A, "admin"),
      recorder,
    });

    const executar = conjunto.tools["mandar-email"]?.execute;
    expect(executar).toBeDefined();
    const resultado = await executar?.(
      { para: ["destino@exemplo.com"], assunto: "Assunto", corpo: "t".repeat(9000) },
      opcoesDeChamada,
    );

    expect(isToolFailure(resultado)).toBe(true);
    expect(isToolFailure(resultado) ? resultado.erro : "").toContain(String(MAX_TOOL_OUTPUT_CHARS));
    expect(passos).toHaveLength(1);
    expect(passos[0]?.toolName).toBe("mandar-email");
    expect(passos[0]?.errorMessage).not.toBeNull();
  });

  it("o passo do rastro guarda exatamente o que o modelo recebeu", async () => {
    const { cliente } = criarSupabaseFalso({});
    const { recorder, passos } = recorderFalso();

    const conjunto = buildToolSet({
      toolIds: ["mandar-email"],
      ctx: ctxDe(cliente, ORG_A, "admin"),
      recorder,
    });

    const executar = conjunto.tools["mandar-email"]?.execute;
    const resultado = await executar?.(
      { para: ["destino@exemplo.com"], assunto: "Assunto", corpo: "Corpo de teste" },
      opcoesDeChamada,
    );

    expect(passos).toHaveLength(1);
    expect(passos[0]?.output).toEqual(resultado);
    expect(passos[0]?.errorMessage).toBeNull();
    // Prova que o rastro guarda o valor de VERDADE, não um resumo: o corpo
    // que mandamos aparece inteiro no que foi gravado.
    expect(JSON.stringify(passos[0]?.output)).toContain("Corpo de teste");
  });
});
