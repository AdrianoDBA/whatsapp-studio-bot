import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { AgentBlueprint } from "@/lib/agents/blueprint";
import type { ScheduleBlueprint, WebhookBlueprint } from "@/lib/automation/blueprint";
import type { KnowledgeBaseBlueprint } from "@/lib/knowledge/blueprint";
import {
  recursoDasBases,
  recursoDosAgendamentos,
  recursoDosAgentes,
  recursoDosWebhooks,
} from "@/lib/seed/materializar";
import type { Recurso } from "@/lib/seed/recurso";
import { colunasNaoClassificadas, materializarRecurso, patchDaLinha } from "@/lib/seed/recurso";
import type { Database, TablesInsert } from "@/types/supabase";

/**
 * O MOLDE, testado direto — não através dos quatro tipos que hoje o usam.
 *
 * Por que isto existe separado de `seed-materializar.test.ts`: aquele arquivo
 * prova que AGENTE, BASE, AGENDAMENTO e WEBHOOK se comportam. Este prova que
 * o MECANISMO se comporta, pra qualquer coisa que alguém declare depois — o
 * CRM, o catálogo de produtos, o que o aluno pedir. Quem for escrever o quinto
 * tipo lê este arquivo pra saber o contrato, sem precisar entender os quatro.
 */

type Linha = Record<string, unknown>;

/**
 * O banco de mentira mais simples que ainda é honesto: guarda linhas, aplica
 * os filtros de verdade (`eq`/`in`) e ANOTA toda chamada. Anotar é o ponto —
 * metade das garantias aqui é sobre o que o materializador NÃO faz.
 */
function bancoFalso(linhasIniciais: Linha[] = []) {
  const linhas = [...linhasIniciais];
  const chamadas: string[] = [];
  /** Cada filtro aplicado, na ordem — é como a gente prova o escopo por workspace. */
  const filtrosAplicados: Array<[string, unknown]> = [];
  const patches: Linha[] = [];
  let erroNoUpdate: { message?: string; code?: string } | null = null;
  let zerarUpdate = false;

  function construir(modo: "select" | "update", patch?: Linha) {
    const filtros: Array<(l: Linha) => boolean> = [];
    function executar() {
      if (modo === "update" && erroNoUpdate) return { data: null, error: erroNoUpdate };
      if (modo === "update" && zerarUpdate) return { data: [], error: null };
      const alvo = linhas.filter((l) => filtros.every((f) => f(l)));
      if (modo === "update" && patch) for (const l of alvo) Object.assign(l, patch);
      return { data: alvo.map((l) => ({ ...l })), error: null };
    }
    const builder = {
      eq(coluna: string, valor: unknown) {
        filtrosAplicados.push([coluna, valor]);
        filtros.push((l) => l[coluna] === valor);
        return builder;
      },
      in(coluna: string, valores: unknown[]) {
        const conjunto = new Set(valores);
        filtrosAplicados.push([coluna, valores]);
        filtros.push((l) => conjunto.has(l[coluna]));
        return builder;
      },
      select: () => Promise.resolve(executar()),
      // biome-ignore lint/suspicious/noThenProperty: imita o thenable do PostgREST
      then: (ok: (v: ReturnType<typeof executar>) => unknown) => Promise.resolve(ok(executar())),
    };
    return builder;
  }

  const api = {
    from(tabela: string) {
      return {
        select(colunas: string) {
          chamadas.push(`select:${tabela}:${colunas}`);
          return construir("select");
        },
        insert(novas: Linha[]) {
          chamadas.push(`insert:${tabela}`);
          const inseridas = novas.map((nova, i) => {
            const linha = { id: `linha-${linhas.length + i + 1}`, ...nova };
            linhas.push(linha);
            return { ...linha };
          });
          return {
            select: () => Promise.resolve({ data: inseridas, error: null }),
            // biome-ignore lint/suspicious/noThenProperty: imita o thenable do PostgREST
            then: (ok: (v: { data: Linha[]; error: null }) => unknown) =>
              Promise.resolve(ok({ data: inseridas, error: null })),
          };
        },
        update(patch: Linha) {
          chamadas.push(`update:${tabela}`);
          patches.push(patch);
          return construir("update", patch);
        },
        delete() {
          throw new Error("o materializador nunca apaga");
        },
      };
    },
  };

  return {
    db: api as unknown as SupabaseClient<Database>,
    linhas,
    chamadas,
    filtrosAplicados,
    patches,
    forcarErroNoUpdate(erro: { message?: string; code?: string }) {
      erroNoUpdate = erro;
    },
    forcarZeroNoUpdate() {
      zerarUpdate = true;
    },
  };
}

/**
 * Uma "planta" inventada, pra provar que o molde não sabe nada sobre agente.
 * Usa a tabela `agents` só porque `TabelaDeclarada` é uma união fechada das
 * tabelas de verdade — o que está sendo exercitado é o MECANISMO.
 */
type PlantaDeTeste = { slug: string; nome: string };

function recursoDeTeste(
  organizationId: string,
  extras: Partial<Recurso<PlantaDeTeste, "agents">> = {},
): Recurso<PlantaDeTeste, "agents"> {
  return {
    tabela: "agents",
    descricao: "as coisas",
    mensagemAoGravar: "não deu pra gravar as coisas deste workspace",
    mensagemAoAtualizar: "não deu pra atualizar as coisas deste workspace",
    colunas: ["name", "description"],
    colunasDoBanco: ["organization_id", "created_by", "slug"],
    colunasDaPessoa: [],
    apelido: (bp) => bp.slug,
    paraInserir: (bp) =>
      ({
        organization_id: organizationId,
        created_by: "dono-1",
        slug: bp.slug,
        name: bp.nome,
        description: "descrição",
        system_prompt: "oi",
        model: "openai:gpt-4o-mini",
      }) as TablesInsert<"agents">,
    ...extras,
  };
}

describe("patchDaLinha — o recorte que substituiu quatro literais escritos na mão", () => {
  const linha = {
    organization_id: "org-1",
    created_by: "dono-1",
    slug: "x",
    name: "Nome",
    description: "Descrição",
    model: "openai:gpt-4o-mini",
  } as unknown as TablesInsert<"agents">;

  it("leva EXATAMENTE as colunas declaradas — nem uma a mais", () => {
    const patch = patchDaLinha<"agents", "name" | "description">(linha, ["name", "description"]);
    expect(Object.keys(patch).sort()).toEqual(["description", "name"]);
  });

  /**
   * 🔴 A GARANTIA QUE JUSTIFICA ESTE ARQUIVO EXISTIR. `created_by`,
   * `organization_id` e `slug` são colunas do BANCO: reescrever qualquer uma
   * numa re-materialização bate no gatilho de imutabilidade (as duas
   * primeiras) ou orfana a linha (a terceira). Elas estão na linha de INSERT
   * e NÃO podem vazar pro patch.
   */
  it("não deixa vazar coluna do banco pro update, mesmo estando na linha de insert", () => {
    const patch = patchDaLinha<"agents", "name">(linha, ["name"]);
    expect(patch).not.toHaveProperty("created_by");
    expect(patch).not.toHaveProperty("organization_id");
    expect(patch).not.toHaveProperty("slug");
  });

  /**
   * Uma coluna declarada que a linha de insert não preencheu vira `undefined`
   * no patch — e `algoMudou` normaliza `undefined` e `null` pro mesmo lado, de
   * propósito. Sem isso, um campo opcional não preenchido daria "mudou" pra
   * sempre, e todo `npm run semear` emitiria UPDATE à toa.
   */
  it("coluna declarada mas ausente na linha vira undefined, não some do patch", () => {
    const patch = patchDaLinha<"agents", "name" | "temperature">(linha, ["name", "temperature"]);
    expect(Object.keys(patch).sort()).toEqual(["name", "temperature"]);
    expect(patch.temperature).toBeUndefined();
  });
});

describe("materializarRecurso — o contrato, pra qualquer tipo de coisa declarada", () => {
  it("lista vazia não encosta no banco", async () => {
    const { db, chamadas } = bancoFalso();
    const r = await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), []);
    expect(chamadas).toEqual([]);
    expect(r.tocados).toBe(0);
  });

  it("o que falta nasce, e o id volta no mapa", async () => {
    const { db, linhas } = bancoFalso();
    const r = await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [
      { slug: "um", nome: "Um" },
    ]);
    expect(linhas).toHaveLength(1);
    expect(r.tocados).toBe(1);
    expect(r.idPorApelido.get("um")).toBe("linha-1");
  });

  it("rodar duas vezes não duplica nem emite UPDATE (nada mudou)", async () => {
    const { db, linhas, chamadas } = bancoFalso();
    const plantas = [{ slug: "um", nome: "Um" }];
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), plantas);
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), plantas);
    expect(linhas).toHaveLength(1);
    expect(chamadas.filter((c) => c.startsWith("update:"))).toEqual([]);
  });

  it("mudou no arquivo, atualiza — só as colunas declaradas", async () => {
    const { db, linhas, patches } = bancoFalso();
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [{ slug: "um", nome: "Um" }]);
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [
      { slug: "um", nome: "Outro" },
    ]);
    expect(linhas[0]!.name).toBe("Outro");
    expect(Object.keys(patches[0]!).sort()).toEqual(["description", "name"]);
  });

  /**
   * 🔴 REGRA 1 DO CLAUDE.md, no mecanismo. Antes desta função existir, o
   * `.eq("organization_id", ...)` estava escrito quatro vezes — esquecer numa
   * cópia era ler (ou escrever) linha de outro workspace, e nada acusaria.
   */
  it("toda leitura e toda escrita ficam presas ao workspace", async () => {
    const { db, filtrosAplicados } = bancoFalso();
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [{ slug: "um", nome: "Um" }]);
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [
      { slug: "um", nome: "Outro" },
    ]);
    const porOrg = filtrosAplicados.filter(([coluna]) => coluna === "organization_id");
    expect(porOrg.length).toBeGreaterThanOrEqual(3); // 2 leituras + 1 update
    for (const [, valor] of porOrg) expect(valor).toBe("org-1");
  });

  it("nunca enxerga linha de outro workspace com o mesmo apelido", async () => {
    const { db, linhas } = bancoFalso([
      { id: "de-outro", organization_id: "org-2", slug: "um", name: "Do vizinho" },
    ]);
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [{ slug: "um", nome: "Um" }]);
    expect(linhas).toHaveLength(2);
    expect(linhas.find((l) => l.id === "de-outro")!.name).toBe("Do vizinho");
  });

  it("soInsere nasce e nunca mais reescreve", async () => {
    const { db, chamadas, linhas } = bancoFalso();
    const recurso = recursoDeTeste("org-1", { soInsere: true, colunas: [] });
    await materializarRecurso(db, "org-1", recurso, [{ slug: "um", nome: "Um" }]);
    await materializarRecurso(db, "org-1", recurso, [{ slug: "um", nome: "MUDOU" }]);
    expect(chamadas.filter((c) => c.startsWith("update:"))).toEqual([]);
    expect(linhas[0]!.name).toBe("Um");
  });

  it("vaiSerRecusado pula antes de tentar, e relata o apelido", async () => {
    const { db, chamadas } = bancoFalso();
    const recurso = recursoDeTeste("org-1");
    await materializarRecurso(db, "org-1", recurso, [{ slug: "um", nome: "Um" }]);

    const comPrevisao = recursoDeTeste("org-1", {
      vaiSerRecusado: () => true,
      pularQuandoRecusado: true,
    });
    const r = await materializarRecurso(db, "org-1", comPrevisao, [{ slug: "um", nome: "Outro" }]);
    expect(r.pulados).toEqual(["um"]);
    expect(r.tocados).toBe(0);
    expect(chamadas.filter((c) => c.startsWith("update:"))).toEqual([]);
  });

  /**
   * UPDATE que bate em ZERO linhas sem erro nenhum é o `using` da policy
   * filtrando em silêncio. Sem `pularQuandoRecusado`, isso é falha de verdade
   * — nunca "deu tudo certo".
   */
  it("update que bate em zero linhas sem erro é falha, não sucesso calado", async () => {
    const { db, forcarZeroNoUpdate } = bancoFalso();
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [{ slug: "um", nome: "Um" }]);
    forcarZeroNoUpdate();
    await expect(
      materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [{ slug: "um", nome: "Outro" }]),
    ).rejects.toThrow(/^não deu pra atualizar as coisas deste workspace$/);
  });

  it("com pularQuandoRecusado, zero linhas vira pulado em vez de falha", async () => {
    const { db, forcarZeroNoUpdate } = bancoFalso();
    const recurso = recursoDeTeste("org-1", { pularQuandoRecusado: true });
    await materializarRecurso(db, "org-1", recurso, [{ slug: "um", nome: "Um" }]);
    forcarZeroNoUpdate();
    const r = await materializarRecurso(db, "org-1", recurso, [{ slug: "um", nome: "Outro" }]);
    expect(r.pulados).toEqual(["um"]);
  });

  /**
   * O cinto-e-suspensórios exige CÓDIGO e TEXTO. Erro que não é da regra de
   * segurança continua sendo falha alta mesmo com `pularQuandoRecusado` —
   * senão um defeito de verdade viraria "pulado" e ninguém olharia.
   */
  it("erro que NÃO é da regra de segurança continua derrubando, mesmo podendo pular", async () => {
    const { db, forcarErroNoUpdate } = bancoFalso();
    const recurso = recursoDeTeste("org-1", { pularQuandoRecusado: true });
    await materializarRecurso(db, "org-1", recurso, [{ slug: "um", nome: "Um" }]);
    forcarErroNoUpdate({ code: "23505", message: "duplicate key value" });
    await expect(
      materializarRecurso(db, "org-1", recurso, [{ slug: "um", nome: "Outro" }]),
    ).rejects.toThrow(/^não deu pra atualizar as coisas deste workspace$/);
  });

  it("a leitura pede as colunas declaradas mais as de só leitura", async () => {
    const { db, chamadas } = bancoFalso();
    const recurso = recursoDeTeste("org-1", { colunasSoDeLeitura: ["created_by"] });
    await materializarRecurso(db, "org-1", recurso, [{ slug: "um", nome: "Um" }]);
    const leitura = chamadas.find((c) => c.startsWith("select:agents:"))!;
    expect(leitura).toContain("id");
    expect(leitura).toContain("slug");
    expect(leitura).toContain("name");
    expect(leitura).toContain("description");
    expect(leitura).toContain("created_by");
  });

  it("nunca apaga", async () => {
    const { db, chamadas } = bancoFalso();
    await materializarRecurso(db, "org-1", recursoDeTeste("org-1"), [{ slug: "um", nome: "Um" }]);
    expect(chamadas.some((c) => c.startsWith("delete:"))).toBe(false);
  });
});

/**
 * 🔴 A GUARDA DE OMISSÃO — o teste que fecha a classe de defeito que este
 * mecanismo já produziu DUAS vezes.
 *
 * Toda coluna que o INSERT de um recurso escreve tem que estar classificada:
 * do arquivo (reescrita toda materialização), só ao nascer, do banco
 * (identidade/autoria) ou da pessoa (quem opera). Uma coluna nova que ninguém
 * classificou reprova aqui, COM O NOME DELA — em vez de virar comportamento
 * silencioso que só aparece meses depois, contra banco de verdade.
 *
 * Os dois defeitos que isto teria pego:
 *   • `created_by` sumido do insert da base (a policy exigia; nenhuma base
 *     conseguia nascer, e a suíte ficava verde);
 *   • `status` faltando nas colunas do agente (a tela prometia
 *     `status: "archived"` como o único jeito de aposentar um agente).
 */
describe("toda coluna que o INSERT escreve está classificada, nos quatro tipos", () => {
  const ORG = "org-1";
  const DONO = "dono-1";
  const IDS = new Map([["assistente", "agente-1"]]);

  const AGENTE: AgentBlueprint = {
    slug: "assistente",
    name: "Assistente",
    description: "Ajuda o time.",
    systemPrompt: "Você ajuda o time.",
    model: "openai:gpt-5.4-mini",
    temperature: 0.7,
    maxSteps: 5,
    maxOutputTokens: 2048,
    tools: [],
  };

  const BASE: KnowledgeBaseBlueprint = {
    slug: "politicas",
    name: "Políticas",
    description: "Regras internas.",
    embeddingModel: "openai:text-embedding-3-small",
  };

  const AGENDAMENTO: ScheduleBlueprint = {
    slug: "resumo-diario",
    name: "Resumo diário",
    agentSlug: "assistente",
    kind: "daily",
    hour: 9,
    minute: 0,
    timezone: "America/Sao_Paulo",
    input: { pedido: "resuma o dia" },
  };

  const WEBHOOK: WebhookBlueprint = {
    slug: "formulario",
    label: "Formulário do site",
    agentSlug: "assistente",
    esperarResposta: false,
  };

  it.each([
    ["agentes", () => colunasNaoClassificadas(recursoDosAgentes(ORG, DONO), AGENTE)],
    ["bases", () => colunasNaoClassificadas(recursoDasBases(ORG, DONO), BASE)],
    [
      "agendamentos",
      () => colunasNaoClassificadas(recursoDosAgendamentos(ORG, DONO, IDS), AGENDAMENTO),
    ],
    ["webhooks", () => colunasNaoClassificadas(recursoDosWebhooks(ORG, DONO, IDS), WEBHOOK)],
  ])("%s", (_nome, conferir) => {
    const { soltas, classificadasAtoa } = conferir();
    expect(
      soltas,
      `coluna(s) que o INSERT escreve e ninguém classificou: ${soltas.join(", ")}`,
    ).toEqual([]);
    expect(
      classificadasAtoa,
      `classificada(s) mas o INSERT não escreve — a classificação envelheceu: ${classificadasAtoa.join(", ")}`,
    ).toEqual([]);
  });
});
