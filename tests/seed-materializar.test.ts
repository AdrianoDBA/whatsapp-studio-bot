import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";

/**
 * `vi.mock` é hoisted pro topo do arquivo, ANTES de qualquer `const` de nível
 * de módulo — mesmo um declarado textualmente acima. `vi.hoisted` é o jeito
 * do Vitest de dar um valor que sobrevive a esse hoisting (mesmo padrão de
 * `tests/agents-engine-budget.test.ts`).
 */
const { AGENTES_FIXTURE, BASES_FIXTURE, AGENDAMENTOS_FIXTURE, WEBHOOKS_FIXTURE } = vi.hoisted(
  () => ({
    AGENTES_FIXTURE: [
      {
        slug: "assistente",
        name: "Assistente",
        description: "Ajuda o time.",
        systemPrompt: "Você ajuda o time.",
        model: "openai:gpt-4o-mini",
        temperature: 0.7,
        maxSteps: 5,
        maxOutputTokens: 2048,
        tools: [],
      },
    ],
    BASES_FIXTURE: [
      {
        slug: "manual",
        name: "Manual",
        embeddingModel: "openai:text-embedding-3-small",
      },
    ],
    AGENDAMENTOS_FIXTURE: [
      {
        slug: "resumo",
        name: "Resumo",
        agentSlug: "assistente",
        kind: "daily",
        hour: 9,
        minute: 0,
        timezone: "America/Sao_Paulo",
        input: {},
      },
    ],
    WEBHOOKS_FIXTURE: [
      { slug: "entrada", label: "Entrada", agentSlug: "assistente", esperarResposta: false },
    ],
  }),
);

vi.mock("@/lib/seed/registro", () => ({
  AGENTES: AGENTES_FIXTURE,
  BASES: BASES_FIXTURE,
  AGENDAMENTOS: AGENDAMENTOS_FIXTURE,
  WEBHOOKS: WEBHOOKS_FIXTURE,
}));

vi.mock("@/lib/ai/catalog", () => ({
  isKnownModelId: () => true,
  DEFAULT_MODEL_ID: "openai:gpt-4o-mini",
}));

import { materializarWorkspace } from "@/lib/seed/materializar";

type Linha = Record<string, unknown>;
type Operacao = "select" | "insert" | "update";
type ErroFalso = { message: string; code: string };

function erroPadrao(tabela: string, operacao: Operacao): ErroFalso {
  return { message: `erro de mentira em ${tabela}.${operacao}`, code: "XXFAKE" };
}

/**
 * Duplo de banco que FILTRA DE VERDADE — a revisão da rodada 1 apontou que a
 * versão anterior deste duplo tinha `eq`/`in` que jogavam os argumentos fora
 * e devolviam a tabela inteira, o que deixaria passar um `materializarWorkspace`
 * que esquecesse de escopar por `organization_id`. Aqui `eq`/`in` acumulam
 * predicados de verdade e só a interseção deles sai no resultado.
 *
 * `update` também é de verdade: aplica o patch só nas linhas que batem no
 * filtro, por cima da linha existente — não substitui a linha inteira, então
 * um campo que o patch não menciona sobrevive intacto.
 *
 * `forcarErro` aceita um erro CUSTOMIZADO (rodada 2): precisa simular o texto
 * exato de uma violação de RLS ("new row violates row-level security
 * policy...") pra provar que `materializarWorkspace` distingue isso de
 * qualquer outro erro.
 */
function bancoFalso() {
  const tabelas = new Map<string, Linha[]>();
  const chamadas: string[] = [];
  const errosForcados = new Map<string, Map<Operacao, ErroFalso>>();
  const zerarUpdate = new Set<string>();
  /** Toda lista de colunas pedida em cada `.select(...)`, na ordem em que aconteceu, por tabela. */
  const colunasLidas = new Map<string, string[][]>();
  /** Todo objeto passado pra `.update(...)`, na ordem em que aconteceu, por tabela. */
  const patchesAplicados = new Map<string, Linha[]>();

  function linhasDe(tabela: string): Linha[] {
    const linhas = tabelas.get(tabela) ?? [];
    tabelas.set(tabela, linhas);
    return linhas;
  }

  function erroDe(tabela: string, operacao: Operacao): ErroFalso | null {
    return errosForcados.get(tabela)?.get(operacao) ?? null;
  }

  function criarFiltroBuilder(opts: {
    modo: "select" | "update";
    linhas: Linha[];
    patch?: Linha;
    erro: ErroFalso | null;
    zerarLinhas?: boolean;
    /**
     * Colunas pedidas no `.select(...)` (rodada 3): quando presente, a
     * linha devolvida é PROJETADA só nessas colunas — igual o PostgREST de
     * verdade faria. Sem isso, o duplo sempre devolvia a linha inteira,
     * mascarando qualquer coluna esquecida na string do `select` (o mesmo
     * defeito reproduzido no início da rodada 3, com `"status"`).
     */
    projetar?: string[];
  }) {
    const filtros: Array<(l: Linha) => boolean> = [];
    function projetarLinha(l: Linha): Linha {
      if (!opts.projetar) return { ...l };
      const linha: Linha = {};
      for (const coluna of opts.projetar) linha[coluna] = l[coluna];
      return linha;
    }
    /** Roda o filtro (e, no modo update, aplica o patch) — usada tanto por `.select()` quanto por `.then()`. */
    function executar(): { data: Linha[] | null; error: ErroFalso | null } {
      if (opts.erro) return { data: null, error: opts.erro };
      // `zerarLinhas`: imita o `using` da policy filtrando tudo em silêncio
      // (sem `error`) — nenhuma linha bate, nenhum patch é aplicado.
      if (opts.modo === "update" && opts.zerarLinhas) return { data: [], error: null };
      const alvo = opts.linhas.filter((l) => filtros.every((f) => f(l)));
      if (opts.modo === "update") {
        for (const linha of alvo) Object.assign(linha, opts.patch);
      }
      return { data: alvo.map(projetarLinha), error: null };
    }
    const builder = {
      eq(coluna: string, valor: unknown) {
        filtros.push((l) => l[coluna] === valor);
        return builder;
      },
      in(coluna: string, valores: unknown[]) {
        const conjunto = new Set(valores);
        filtros.push((l) => conjunto.has(l[coluna]));
        return builder;
      },
      /**
       * Só existe no modo "select" — imita `.overrideTypes()`/`.returns()`
       * do supabase-js, que são PURAMENTE DE TIPO (confirmado lendo o
       * pacote: o corpo é `return this`), sem efeito nenhum em tempo de
       * execução. O duplo não precisa fazer nada além de devolver a si
       * mesmo, encadeável.
       */
      overrideTypes() {
        return builder;
      },
      /**
       * Só chamada no modo "update" — imita `.select("id")` pedido DEPOIS
       * do `update(...).eq(...)`, que roda o UPDATE de verdade e devolve as
       * linhas afetadas (pra `materializar.ts` conferir `data?.length`).
       */
      select(_colunas?: string) {
        return Promise.resolve(executar());
      },
      // biome-ignore lint/suspicious/noThenProperty: imita o formato thenable do PostgREST — justificativa real, não gambiarra pra passar lint
      then(onFulfilled: (v: { data: Linha[] | null; error: ErroFalso | null }) => unknown) {
        return Promise.resolve(onFulfilled(executar()));
      },
    };
    return builder;
  }

  const api = {
    from(tabela: string) {
      const linhas = linhasDe(tabela);
      return {
        select(colunas?: string) {
          const camposPedidos = colunas
            ?.split(",")
            .map((c) => c.trim())
            .filter(Boolean);
          if (camposPedidos) {
            const anteriores = colunasLidas.get(tabela) ?? [];
            colunasLidas.set(tabela, [...anteriores, camposPedidos]);
          }
          return criarFiltroBuilder({
            modo: "select",
            linhas,
            erro: erroDe(tabela, "select"),
            projetar: camposPedidos,
          });
        },
        insert(novas: Linha[]) {
          chamadas.push(`insert:${tabela}`);
          const erro = erroDe(tabela, "insert");
          if (erro) {
            const resultado = { data: null, error: erro };
            return {
              select: () => Promise.resolve(resultado),
              // biome-ignore lint/suspicious/noThenProperty: imita o formato thenable do PostgREST — justificativa real, não gambiarra pra passar lint
              then: (onFulfilled: (v: typeof resultado) => unknown) =>
                Promise.resolve(onFulfilled(resultado)),
            };
          }
          const inseridas = novas.map((nova) => {
            const linha: Linha = { id: `${tabela}-${linhas.length + 1}`, ...nova };
            linhas.push(linha);
            return { ...linha };
          });
          const resultado: { data: Linha[]; error: null } = { data: inseridas, error: null };
          return {
            select: () => Promise.resolve(resultado),
            // biome-ignore lint/suspicious/noThenProperty: imita o formato thenable do PostgREST — justificativa real, não gambiarra pra passar lint
            then: (onFulfilled: (v: typeof resultado) => unknown) =>
              Promise.resolve(onFulfilled(resultado)),
          };
        },
        update(patch: Linha) {
          chamadas.push(`update:${tabela}`);
          const anteriores = patchesAplicados.get(tabela) ?? [];
          patchesAplicados.set(tabela, [...anteriores, patch]);
          return criarFiltroBuilder({
            modo: "update",
            linhas,
            patch,
            erro: erroDe(tabela, "update"),
            zerarLinhas: zerarUpdate.has(tabela),
          });
        },
        delete() {
          chamadas.push(`delete:${tabela}`);
          throw new Error("o materializador nunca apaga");
        },
      };
    },
  };

  return {
    db: api as unknown as SupabaseClient<Database>,
    tabelas,
    chamadas,
    forcarErro(tabela: string, operacao: Operacao, erro?: ErroFalso) {
      const porOperacao = errosForcados.get(tabela) ?? new Map<Operacao, ErroFalso>();
      porOperacao.set(operacao, erro ?? erroPadrao(tabela, operacao));
      errosForcados.set(tabela, porOperacao);
    },
    /**
     * Simula o `using` da policy filtrando a linha em silêncio — o UPDATE
     * "funciona" (sem `error`), mas bate em ZERO linhas. É o cenário do item
     * 2 da rodada 3: um membro comum roda `npm run semear`; a leitura
     * funciona, mas o `update` não afeta nada, e sem `.select("id")` isso
     * ficaria indistinguível de "1 linha atualizada".
     */
    forcarZeroNoUpdate(tabela: string) {
      zerarUpdate.add(tabela);
    },
    colunasLidas,
    patchesAplicados,
  };
}

let db: SupabaseClient<Database>;
let tabelas: Map<string, Linha[]>;
let chamadas: string[];
let forcarErro: (tabela: string, operacao: Operacao, erro?: ErroFalso) => void;
let forcarZeroNoUpdate: (tabela: string) => void;
let colunasLidas: Map<string, string[][]>;
let patchesAplicados: Map<string, Linha[]>;

beforeEach(() => {
  ({ db, tabelas, chamadas, forcarErro, forcarZeroNoUpdate, colunasLidas, patchesAplicados } =
    bancoFalso());
});

describe("materializarWorkspace", () => {
  it("grava as quatro coisas declaradas", async () => {
    const r = await materializarWorkspace(db, "org-1", "dono-1");
    expect(r).toEqual({
      agentes: 1,
      bases: 1,
      agendamentos: 1,
      webhooks: 1,
      agendamentosPulados: [],
    });
  });

  /**
   * 🔴 A prova que a regra 9 exige das migrations, aplicada a dado: o
   * materializador roda no nascimento do workspace E por comando, então rodar
   * duas vezes é o caso NORMAL, não o excepcional.
   */
  it("rodar duas vezes não duplica nada, e não muda a linha por baixo", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    const antes = {
      agents: structuredClone(tabelas.get("agents")),
      knowledge_bases: structuredClone(tabelas.get("knowledge_bases")),
      schedules: structuredClone(tabelas.get("schedules")),
      webhook_endpoints: structuredClone(tabelas.get("webhook_endpoints")),
    };

    await materializarWorkspace(db, "org-1", "dono-1");

    expect(tabelas.get("agents")).toHaveLength(1);
    expect(tabelas.get("knowledge_bases")).toHaveLength(1);
    expect(tabelas.get("schedules")).toHaveLength(1);
    expect(tabelas.get("webhook_endpoints")).toHaveLength(1);
    expect(tabelas.get("agents")).toEqual(antes.agents);
    expect(tabelas.get("knowledge_bases")).toEqual(antes.knowledge_bases);
    expect(tabelas.get("schedules")).toEqual(antes.schedules);
    expect(tabelas.get("webhook_endpoints")).toEqual(antes.webhook_endpoints);
  });

  /**
   * 🔴 Ruling da rodada 2: só emite UPDATE quando algo mudou de verdade. Sem
   * isso, `set_updated_at` carimbaria toda re-semeadura, e as telas (que
   * ordenam por `updated_at`) mostrariam tudo como "atualizado agora" mesmo
   * sem mudança nenhuma. Prova direta: nenhuma chamada `update:*` na segunda
   * rodada, quando nada no arquivo divergiu do banco.
   */
  it("materializar duas vezes seguidas não emite UPDATE nenhum (nada mudou)", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    chamadas.length = 0;

    await materializarWorkspace(db, "org-1", "dono-1");

    expect(chamadas.some((c) => c.startsWith("update:"))).toBe(false);
  });

  /**
   * 🔴 Item 3 da rodada 3 — O MAIS GRAVE, reproduzido pelo revisor: tirar
   * `"status"` só da string do `select` de `lerAgentesExistentes` (mantendo
   * o patch como estava, em duas listas separadas mantidas na mão) deixava
   * o `tsc` LIMPO (todo campo de `TablesUpdate` é opcional, então a linha
   * seguia atribuível) e os 28 testes da rodada 2 VERDES (o duplo antigo
   * ignorava o argumento do `select` e sempre devolvia a linha inteira). O
   * campo sumido virava `atual.status === undefined` pra sempre,
   * `algoMudou` achava diferença em TODA chamada, e todo `npm run semear`
   * fazia UPDATE em TODA linha.
   *
   * Este teste ataca o fluxo REAL (não uma mutação manual isolada): o duplo
   * agora PROJETA a linha do `select` só nas colunas pedidas de verdade
   * (`colunasLidas`) e grava o `patch` que de fato chegou no `update`
   * (`patchesAplicados`). Se algum dia a lista única (`COLUNAS_DO_*`) for
   * abandonada por duas listas separadas de novo, e elas voltarem a
   * divergir, é ESTE teste — não o compilador — quem avisa.
   */
  /**
   * 🔴 N6 da rodada 4: a versão da rodada 3 só provava METADE da garantia
   * (`patch ⊆ select` — "toda coluna que o patch escreve foi lida"). Isso
   * passa tranquilo quando o patch fica MENOR do que devia: tirar `status:
   * linha.status` do literal de `paraAtualizarAgente` (sem tocar a
   * constante `COLUNAS_DO_AGENTE`) deixava o `tsc` limpo (todo campo de
   * `TablesUpdate` é opcional — um objeto menor ainda é válido) E essa
   * checagem passando (um patch menor ainda é subconjunto). Reproduzido na
   * rodada 4. A garantia de verdade exige os DOIS conjuntos IGUAIS —
   * `patch === select` (menos `id`/`slug`/`run_as`, que nunca entram no
   * patch de propósito).
   */
  describe("as colunas do patch são EXATAMENTE as da constante, não só um subconjunto (fonte única, item 3 + N6)", () => {
    it("agents", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      tabelas.get("agents")![0]!.name = "Nome Velho";
      await materializarWorkspace(db, "org-1", "dono-1");

      const colunasDoArquivo = colunasLidas
        .get("agents")!
        .at(-1)!
        .filter((c) => c !== "id" && c !== "slug");
      const colunasDoPatch = Object.keys(patchesAplicados.get("agents")!.at(-1)!);
      expect(new Set(colunasDoPatch)).toEqual(new Set(colunasDoArquivo));
    });

    it("knowledge_bases", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      tabelas.get("knowledge_bases")![0]!.name = "Nome Velho";
      await materializarWorkspace(db, "org-1", "dono-1");

      const colunasDoArquivo = colunasLidas
        .get("knowledge_bases")!
        .at(-1)!
        .filter((c) => c !== "id" && c !== "slug");
      const colunasDoPatch = Object.keys(patchesAplicados.get("knowledge_bases")!.at(-1)!);
      expect(new Set(colunasDoPatch)).toEqual(new Set(colunasDoArquivo));
    });

    it("schedules (run_as entra na leitura pra prever RLS, mas nunca no patch)", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      tabelas.get("schedules")![0]!.name = "Nome Velho";
      await materializarWorkspace(db, "org-1", "dono-1");

      const colunasDoArquivo = colunasLidas
        .get("schedules")!
        .at(-1)!
        .filter((c) => c !== "id" && c !== "slug" && c !== "run_as");
      const colunasDoPatch = Object.keys(patchesAplicados.get("schedules")!.at(-1)!);
      expect(new Set(colunasDoPatch)).toEqual(new Set(colunasDoArquivo));
    });
  });

  /**
   * 🔴 NUNCA APAGA. É a única operação irreversível que este caminho poderia
   * ter, e o ganho (arrumação) não paga sumir com a base de conhecimento de um
   * cliente porque alguém renomeou um arquivo. O duplo LANÇA em `delete`.
   */
  it("não chama delete em tabela nenhuma", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    expect(chamadas.some((c) => c.startsWith("delete:"))).toBe(false);
  });

  it("prende tudo ao workspace e ao dono", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    for (const tabela of ["agents", "knowledge_bases", "schedules", "webhook_endpoints"]) {
      for (const linha of tabelas.get(tabela)!) {
        expect(linha.organization_id, tabela).toBe("org-1");
      }
    }
    expect(tabelas.get("schedules")![0]!.run_as).toBe("dono-1");
    expect(tabelas.get("webhook_endpoints")![0]!.run_as).toBe("dono-1");
  });

  it("resolve o agente da automação pelo apelido", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    const idDoAgente = tabelas.get("agents")![0]!.id;
    expect(tabelas.get("schedules")![0]!.agent_id).toBe(idDoAgente);
    expect(tabelas.get("webhook_endpoints")![0]!.agent_id).toBe(idDoAgente);
  });

  /**
   * 🔴 MUDOU NA TASK 8, RODADA 2: `webhook_endpoints` nasce `is_active: true`
   * agora — antes deste teste exigia `false` nos dois, igual ao agendamento.
   *
   * `schedules` continua nascendo `false`: só ele tem tela de liga/desliga
   * (`ligarDesligarAgendamentoAction`), então `false` é uma trava de verdade,
   * com chave. `webhook_endpoints` NÃO TEM ESSA TELA — exigir `false` faria
   * todo webhook materializado nascer inalcançável PRA SEMPRE, porque nada no
   * produto liga essa coluna de volta pra webhook. O webhook já nasce
   * inutilizável de outro jeito (token sorteado e descartado, ver
   * `webhookParaInsert`), então não precisa dessa terceira trava sem chave.
   * Ver `lib/automation/CLAUDE.md`, regra 15.
   */
  it("agendamento nasce desligado; webhook nasce ligado — o token descartado é a trava dele", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    expect(tabelas.get("schedules")![0]!.is_active).toBe(false);
    expect(tabelas.get("webhook_endpoints")![0]!.is_active).toBe(true);
  });

  /**
   * Pedido explícito do coordenador na rodada 2 da Task 8: confirmar, no
   * caminho de ponta a ponta (`materializarWorkspace`, não só
   * `webhookParaInsert` isolado), que o webhook materializado nasce
   * `is_active: true` e que `modo` continua de fora do insert — quem decide
   * `modo` é o padrão do banco (`'ensaio'`), nunca o arquivo nem a
   * materialização.
   */
  it("webhook materializado nasce is_active: true, e a linha não carrega a coluna modo", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    const linha = tabelas.get("webhook_endpoints")![0]! as Record<string, unknown>;
    expect(linha.is_active).toBe(true);
    expect(Object.keys(linha)).not.toContain("modo");
  });

  /**
   * 🔴 O furo do token que gira sozinho: `webhookParaInsert` sorteia um token
   * novo a cada chamada. Um caminho que reescrevesse a linha existente
   * trocaria o segredo de um endpoint que sistemas de fora já estão
   * chamando. `webhook_endpoints` fica INSERT-ONLY por causa disso — nunca
   * entra no ramo de `update`.
   */
  it("não troca o segredo de um webhook que já existe", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    const antes = tabelas.get("webhook_endpoints")![0]!.token_hash;
    await materializarWorkspace(db, "org-1", "dono-1");
    expect(tabelas.get("webhook_endpoints")![0]!.token_hash).toBe(antes);
  });

  /**
   * 🔴 C2 da revisão: `created_by` é imutável por gatilho em `agents`
   * (`freeze_org_and_creator`). Se `materializarWorkspace` tentasse
   * reescrever essa coluna no `update`, re-semear com um `ownerId` diferente
   * do dono original quebraria — e nenhuma tela conserta uma coluna imutável
   * de propósito. `agents` não tem checagem de `run_as` (só `has_org_role`),
   * então o UPDATE dispara normalmente mesmo com `ownerId` trocado — é
   * exatamente esse caso que prova a proteção de `created_by`.
   */
  it("re-materializar (com mudança de verdade) e outro ownerId não mexe em created_by do agente", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    const criadoPorAgente = tabelas.get("agents")![0]!.created_by;
    tabelas.get("agents")![0]!.name = "Nome Velho";

    await materializarWorkspace(db, "org-1", "outro-dono");

    expect(chamadas).toContain("update:agents");
    expect(tabelas.get("agents")![0]!.created_by).toBe(criadoPorAgente);
    expect(tabelas.get("agents")![0]!.name).toBe("Assistente");
    // Belt-and-suspenders (rodada 4): também por dentro do patch, não só por
    // valor — aqui já era observável por valor (`ownerId` diferente do
    // `created_by` original), mas confirmar a chave ausente é grátis.
    expect(Object.keys(patchesAplicados.get("agents")!.at(-1)!)).not.toContain("created_by");
  });

  /**
   * 🔴 C2 nos agendamentos + N7 da rodada 4: com o MESMO `ownerId` de quem
   * roda (pra passar pela previsão de RLS do N1 e o UPDATE de fato
   * disparar), `created_by` continua intocado — ele nunca entra em
   * `AtualizacaoDeAgendamento`.
   *
   * A rodada 3 escrevia este teste com `ownerId === created_by === run_as`
   * o tempo todo — a revisão da rodada 4 apontou (e reproduziu) que isso
   * torna a escrita de `created_by` INOBSERVÁVEL POR VALOR: se o código
   * reescrevesse `created_by` pro `ownerId` de quem chamou, o valor
   * resultante seria IDÊNTICO ao que já estava lá, e o teste passaria do
   * mesmo jeito. Aqui plantamos `created_by = "quem-criou-antes"` ANTES da
   * segunda chamada — simulando a linha ter sido criada por outra pessoa
   * (o caso de verdade que o gatilho `freeze_org_and_creator` existe pra
   * cobrir) — pra que uma eventual escrita de `created_by` produza um valor
   * DIFERENTE, detectável. `run_as` continua "dono-1" de propósito (pra não
   * disparar a previsão do N1, que é outro mecanismo, já coberto em outro
   * teste). Some com isso: também checamos direto no `patch` que chegou no
   * `update` (`patchesAplicados`, construída nesta mesma rodada) que nem
   * `created_by` nem `run_as` aparecem nas chaves — prova estrutural, não só
   * por valor, e a única forma de provar `run_as` (que É reescrito com o
   * MESMO valor de `ownerId` sempre que o UPDATE dispara — nunca dá pra
   * distinguir por valor).
   */
  it("re-materializar (com mudança de verdade, mesmo ownerId) não mexe em created_by nem run_as do agendamento", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    tabelas.get("schedules")![0]!.created_by = "quem-criou-antes";
    tabelas.get("schedules")![0]!.name = "Nome Velho";

    const r = await materializarWorkspace(db, "org-1", "dono-1");

    expect(chamadas).toContain("update:schedules");
    expect(tabelas.get("schedules")![0]!.created_by).toBe("quem-criou-antes");
    expect(tabelas.get("schedules")![0]!.run_as).toBe("dono-1");
    expect(tabelas.get("schedules")![0]!.name).toBe("Resumo");
    expect(r.agendamentosPulados).toEqual([]);

    const patch = patchesAplicados.get("schedules")!.at(-1)!;
    expect(Object.keys(patch)).not.toContain("created_by");
    expect(Object.keys(patch)).not.toContain("run_as");
  });

  /**
   * 🔴 C3 da revisão + N2 da rodada 2 — ATUALIZADO na rodada de conserto 1 da
   * Task 9: só `is_active` e `modo` continuam da PESSOA (a tela). `entrega`
   * SAIU dessa lista: até ali era protegida aqui pelo mesmo motivo — só a
   * extinta tela de criação sabia setá-la —, mas sem tela (e sem `entrega`
   * no arquivo) `entrega` ficava permanentemente inalcançável, pra criar ou
   * editar. `entrega` é CONFIGURAÇÃO (o que o trabalho FAZ), não decisão
   * operacional, então virou coluna do ARQUIVO — entra em
   * `COLUNAS_DO_AGENDAMENTO` e passa a ser re-materializada, igual `name`.
   * Este teste simula uma linha com `entrega` setada por fora (a pessoa
   * mexeu direto no banco, ou é resíduo de quando a tela existia) e prova
   * que `npm run semear` a sobrescreve com o que o arquivo declara — aqui,
   * `{ tipo: "nenhuma" }`, porque `AGENDAMENTOS_FIXTURE` não declara
   * `entrega`. `is_active`/`modo` continuam intocados; `run_as` fica coberto
   * no teste seguinte, porque mexer nele muda o resultado da previsão do N1
   * (é ele quem decide se o UPDATE roda ou é pulado, não só mais um campo
   * protegido).
   */
  it("re-materializar (mesmo ownerId, mudança de verdade) não desliga automação, mas agora SOBRESCREVE entrega (virou coluna do arquivo)", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    const linha = tabelas.get("schedules")![0]!;
    linha.is_active = true;
    linha.modo = "real";
    linha.entrega = { tipo: "email" };
    linha.name = "Nome Velho";

    const r = await materializarWorkspace(db, "org-1", "dono-1");

    expect(chamadas).toContain("update:schedules");
    expect(tabelas.get("schedules")![0]!.name).toBe("Resumo");
    expect(tabelas.get("schedules")![0]!.is_active).toBe(true);
    expect(tabelas.get("schedules")![0]!.modo).toBe("real");
    expect(tabelas.get("schedules")![0]!.entrega).toEqual({ tipo: "nenhuma" });
    expect(r.agendamentosPulados).toEqual([]);
  });

  /**
   * 🔴 N1 (rodada 3), o mecanismo PRINCIPAL: quando uma pessoa reatribui
   * "quem roda" pela tela (`run_as` passa a ser outra pessoa) e depois o
   * DONO ORIGINAL roda `npm run semear`, a previsão (`atual.run_as !==
   * ownerId`) pula o agendamento ANTES de tentar o UPDATE — nem `name` é
   * atualizado, mesmo tendo mudado de verdade no arquivo. É o preço de não
   * afrouxar a RLS: o UPDATE só volta a rodar quando quem re-semeia é a
   * pessoa apontada em `run_as` (ou alguém reatribui de volta, pela tela).
   */
  it("run_as reatribuído pela tela pula o agendamento inteiro quando quem re-semeia é o dono original", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    const linha = tabelas.get("schedules")![0]!;
    linha.run_as = "outra-pessoa";
    linha.name = "Nome Velho";

    const r = await materializarWorkspace(db, "org-1", "dono-1");

    expect(chamadas.some((c) => c.startsWith("update:schedules"))).toBe(false);
    expect(tabelas.get("schedules")![0]!.name).toBe("Nome Velho");
    expect(tabelas.get("schedules")![0]!.run_as).toBe("outra-pessoa");
    expect(r.agendamentosPulados).toEqual(["resumo"]);
  });

  /**
   * 🔴 A prova de que `resultado.webhooks` não "mente" na segunda chamada: o
   * campo conta os que já existem MAIS os que acabaram de nascer, não só os
   * recém-inseridos — senão qualquer chamada depois da primeira reportaria 0
   * webhooks, mesmo com o único webhook declarado vivo e saudável.
   */
  it("resultado.webhooks conta o que já existe, não só o recém-inserido", async () => {
    const r1 = await materializarWorkspace(db, "org-1", "dono-1");
    expect(r1.webhooks).toBe(1);
    const r2 = await materializarWorkspace(db, "org-1", "dono-1");
    expect(r2.webhooks).toBe(1);
  });

  /**
   * 🔴 A outra metade de "nunca apaga", que o `beforeEach` (banco sempre
   * vazio) nunca exercitava: uma linha que já estava lá ANTES desta
   * materialização — órfã por ter nascido à mão (`slug: null`) ou por ter
   * ficado pra trás quando alguém tirou a declaração do arquivo (apelido que
   * não existe mais) — sobrevive IDÊNTICA. Estendido na rodada 2 pra cobrir
   * `knowledge_bases` e `webhook_endpoints` também, não só `agents`/`schedules`.
   */
  it("nunca toca em linha pré-existente que o arquivo não reconhece (órfã ou abandonada), nas quatro tabelas", async () => {
    const linhaOrfaDeAgente: Linha = {
      id: "agents-pre-1",
      organization_id: "org-1",
      created_by: "alguem",
      slug: "criado-a-mao",
      name: "Feito pelo painel",
      description: null,
      system_prompt: "x",
      model: "openai:gpt-4o-mini",
      temperature: 1,
      max_steps: 3,
      max_output_tokens: 512,
      tools: [],
      status: "active",
    };
    const baseOrfa: Linha = {
      id: "kb-pre-1",
      organization_id: "org-1",
      created_by: "alguem",
      slug: "criado-a-mao-kb",
      name: "Base feita pelo painel",
      description: null,
      embedding_model: "openai:text-embedding-3-small",
    };
    const linhaOrfaDeAgendamento: Linha = {
      id: "schedules-pre-1",
      organization_id: "org-1",
      agent_id: "algum-agente",
      run_as: "alguem",
      created_by: "alguem",
      slug: null,
      name: "Criado pela tela",
      kind: "daily",
      hour: 3,
      minute: 0,
      timezone: "America/Sao_Paulo",
      input: {},
      is_active: true,
      modo: "real",
    };
    const linhaAbandonada: Linha = {
      id: "schedules-pre-2",
      organization_id: "org-1",
      agent_id: "algum-agente",
      run_as: "alguem",
      created_by: "alguem",
      slug: "nao-existe-mais-no-arquivo",
      name: "Removido do código",
      kind: "daily",
      hour: 4,
      minute: 0,
      timezone: "America/Sao_Paulo",
      input: {},
      is_active: true,
      modo: "real",
    };
    const webhookOrfao: Linha = {
      id: "webhook-pre-1",
      organization_id: "org-1",
      agent_id: "algum-agente",
      run_as: "alguem",
      created_by: "alguem",
      slug: null,
      label: "Criado pela tela",
      token_hash: "hash-velho",
      token_prefix: "pre_velho",
      is_active: true,
      esperar_resposta: true,
      modo: "real",
    };
    const webhookAbandonado: Linha = {
      id: "webhook-pre-2",
      organization_id: "org-1",
      agent_id: "algum-agente",
      run_as: "alguem",
      created_by: "alguem",
      slug: "nao-existe-mais-webhook",
      label: "Removido do código",
      token_hash: "hash-velho-2",
      token_prefix: "pre_velho2",
      is_active: true,
      esperar_resposta: true,
      modo: "real",
    };
    tabelas.set("agents", [linhaOrfaDeAgente]);
    tabelas.set("knowledge_bases", [baseOrfa]);
    tabelas.set("schedules", [linhaOrfaDeAgendamento, linhaAbandonada]);
    tabelas.set("webhook_endpoints", [webhookOrfao, webhookAbandonado]);
    const antes = {
      agents: structuredClone(tabelas.get("agents")),
      knowledge_bases: structuredClone(tabelas.get("knowledge_bases")),
      schedules: structuredClone(tabelas.get("schedules")),
      webhook_endpoints: structuredClone(tabelas.get("webhook_endpoints")),
    };

    await materializarWorkspace(db, "org-1", "dono-1");

    // As pré-existentes continuam lá, intocadas...
    for (const linha of antes.agents!) expect(tabelas.get("agents")).toContainEqual(linha);
    for (const linha of antes.knowledge_bases!)
      expect(tabelas.get("knowledge_bases")).toContainEqual(linha);
    for (const linha of antes.schedules!) expect(tabelas.get("schedules")).toContainEqual(linha);
    for (const linha of antes.webhook_endpoints!)
      expect(tabelas.get("webhook_endpoints")).toContainEqual(linha);
    // ...e a declarada de verdade entrou do lado delas, sem sobrescrever nada.
    expect(tabelas.get("agents")).toHaveLength(2);
    expect(tabelas.get("knowledge_bases")).toHaveLength(2);
    expect(tabelas.get("schedules")).toHaveLength(3);
    expect(tabelas.get("webhook_endpoints")).toHaveLength(3);
  });

  /**
   * 🔴 N5 da rodada 2: falta o caso de órfã com o MESMO apelido em OUTRA
   * organização. Se a leitura de "quem já existe" não escopasse por
   * `organization_id`, o materializador de `org-1` acharia essa linha de
   * `org-2` "já existente" e nem tentaria inserir a própria — e pior,
   * poderia tentar atualizar a linha errada.
   */
  it("nunca reaproveita linha de OUTRA organização com o mesmo apelido", async () => {
    const linhaDeOutraOrg: Linha = {
      id: "agents-outra-org-1",
      organization_id: "org-2",
      created_by: "dono-2",
      slug: "assistente",
      name: "Assistente de outra empresa",
      description: null,
      system_prompt: "outro prompt",
      model: "openai:gpt-4o-mini",
      temperature: 1,
      max_steps: 3,
      max_output_tokens: 512,
      tools: [],
      status: "active",
    };
    tabelas.set("agents", [linhaDeOutraOrg]);

    const r = await materializarWorkspace(db, "org-1", "dono-1");

    expect(r.agentes).toBe(1);
    const agentesOrg1 = tabelas.get("agents")!.filter((l) => l.organization_id === "org-1");
    expect(agentesOrg1).toHaveLength(1);
    expect(agentesOrg1[0]!.name).toBe("Assistente");
    expect(tabelas.get("agents")!.find((l) => l.id === "agents-outra-org-1")).toEqual(
      linhaDeOutraOrg,
    );
  });

  /**
   * 🔴 Prova que `eq("organization_id", ...)` filtra de verdade na LEITURA —
   * a versão anterior deste duplo o ignorava, o que deixaria dois workspaces
   * compartilharem a MESMA linha de agente (e, pior, o mesmo `agent_id` num
   * agendamento/webhook do workspace errado).
   */
  it("materializa dois workspaces sem misturar linha nem agent_id entre eles", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    await materializarWorkspace(db, "org-2", "dono-2");

    const agentesOrg1 = tabelas.get("agents")!.filter((l) => l.organization_id === "org-1");
    const agentesOrg2 = tabelas.get("agents")!.filter((l) => l.organization_id === "org-2");
    expect(agentesOrg1).toHaveLength(1);
    expect(agentesOrg2).toHaveLength(1);
    expect(tabelas.get("agents")).toHaveLength(2);
    expect(agentesOrg1[0]!.id).not.toBe(agentesOrg2[0]!.id);

    const scheduleOrg1 = tabelas.get("schedules")!.find((l) => l.organization_id === "org-1")!;
    const scheduleOrg2 = tabelas.get("schedules")!.find((l) => l.organization_id === "org-2")!;
    expect(scheduleOrg1.agent_id).toBe(agentesOrg1[0]!.id);
    expect(scheduleOrg2.agent_id).toBe(agentesOrg2[0]!.id);
    expect(scheduleOrg1.agent_id).not.toBe(scheduleOrg2.agent_id);
  });

  /**
   * 🔴 N4 da rodada 2: o duplo antigo filtrava na LEITURA, mas nada provava
   * que o UPDATE também escopa por `organization_id` — apagar esse `.eq(...)`
   * das três chamadas de update deixava a suíte inteira verde. Aqui, forçar
   * uma mudança de verdade em `org-1` e confirmar que `org-2` (mesmo apelido)
   * não é tocado fecha esse buraco pras três tabelas que atualizam.
   */
  it("UPDATE de arquivo nunca escapa pro workspace errado (duas organizações, mesmo apelido)", async () => {
    await materializarWorkspace(db, "org-1", "dono-1");
    await materializarWorkspace(db, "org-2", "dono-2");

    for (const tabela of ["agents", "knowledge_bases", "schedules"]) {
      tabelas.get(tabela)!.find((l) => l.organization_id === "org-1")!.name = "Nome Velho";
    }
    const org2Antes = {
      agents: structuredClone(tabelas.get("agents")!.find((l) => l.organization_id === "org-2")),
      knowledge_bases: structuredClone(
        tabelas.get("knowledge_bases")!.find((l) => l.organization_id === "org-2"),
      ),
      schedules: structuredClone(
        tabelas.get("schedules")!.find((l) => l.organization_id === "org-2"),
      ),
    };

    await materializarWorkspace(db, "org-1", "dono-1");

    expect(tabelas.get("agents")!.find((l) => l.organization_id === "org-1")!.name).toBe(
      "Assistente",
    );
    expect(tabelas.get("knowledge_bases")!.find((l) => l.organization_id === "org-1")!.name).toBe(
      "Manual",
    );
    expect(tabelas.get("schedules")!.find((l) => l.organization_id === "org-1")!.name).toBe(
      "Resumo",
    );
    expect(tabelas.get("agents")!.find((l) => l.organization_id === "org-2")).toEqual(
      org2Antes.agents,
    );
    expect(tabelas.get("knowledge_bases")!.find((l) => l.organization_id === "org-2")).toEqual(
      org2Antes.knowledge_bases,
    );
    expect(tabelas.get("schedules")!.find((l) => l.organization_id === "org-2")).toEqual(
      org2Antes.schedules,
    );
  });

  describe("N1: RLS pode pular um agendamento sem derrubar a materialização (decisão do dono do produto)", () => {
    /**
     * 🔴 A policy `admins update schedules` tem `with check (... and
     * auth.uid() = run_as ...)`. Como `run_as` nunca é escrito por
     * `materializarWorkspace`, quem roda a materialização em nome de um
     * `ownerId` diferente do `run_as` gravado toma "new row violates
     * row-level security policy". PULA a linha, segue com as outras, RELATA.
     */
    it("UPDATE recusado por RLS pula o agendamento, relata o apelido, e as outras categorias seguem normais", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      tabelas.get("schedules")![0]!.name = "Nome Velho"; // força o UPDATE a disparar
      forcarErro("schedules", "update", {
        message: 'new row violates row-level security policy for table "schedules"',
        code: "42501",
      });

      const r = await materializarWorkspace(db, "org-1", "dono-1");

      expect(r.agendamentosPulados).toEqual(["resumo"]);
      expect(tabelas.get("schedules")![0]!.name).toBe("Nome Velho"); // ficou como estava — não foi tocado
      expect(r.agentes).toBe(1);
      expect(r.bases).toBe(1);
      expect(r.webhooks).toBe(1);
    });

    it("erro de UPDATE que NÃO é RLS continua sendo falha de verdade (não vira 'pulado')", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      tabelas.get("schedules")![0]!.name = "Nome Velho";
      forcarErro("schedules", "update"); // erro genérico de mentira, sem o texto de RLS

      await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
        /^não deu pra atualizar os agendamentos deste workspace$/,
      );
    });

    /**
     * 🔴 Item 2 da rodada 3: `.update()` sem `.select()` mente — o PostgREST
     * devolve 204 sem corpo tanto pra "1 linha atualizada" quanto pra
     * "nenhuma linha bateu no `using` da policy" (ex.: um MEMBRO COMUM,
     * sem `has_org_role`, rodando `npm run semear`). Sem `error` nenhum,
     * `run_as` batendo (a previsão do N1 não pega este caso — ele é sobre
     * OUTRO motivo de recusa), só `data?.length !== 1` denuncia. Mesma
     * família do N1: pulado, relatado, não derruba.
     */
    it("UPDATE que bate em zero linhas sem erro (ex.: quem re-semeia não é admin/owner) também vira 'pulado'", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      tabelas.get("schedules")![0]!.name = "Nome Velho";
      forcarZeroNoUpdate("schedules");

      const r = await materializarWorkspace(db, "org-1", "dono-1");

      expect(r.agendamentosPulados).toEqual(["resumo"]);
      expect(tabelas.get("schedules")![0]!.name).toBe("Nome Velho");
    });

    /**
     * 🔴 Menor da rodada 4: `run_as` pode ser `null` — a pessoa que rodava o
     * agendamento saiu do workspace (`run_as uuid references auth.users(id)
     * on delete set null`). `null !== ownerId` é sempre verdade, então cai
     * no mesmo "pula" do caso comum — comportamento CORRETO, não um bug
     * separado —, mas sem teste isso ficava só afirmado no comentário.
     */
    it("run_as nulo (a pessoa saiu do workspace) também pula, sem lançar", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      const linha = tabelas.get("schedules")![0]!;
      linha.run_as = null;
      linha.name = "Nome Velho";

      const r = await materializarWorkspace(db, "org-1", "dono-1");

      expect(r.agendamentosPulados).toEqual(["resumo"]);
      expect(tabelas.get("schedules")![0]!.name).toBe("Nome Velho");
      expect(tabelas.get("schedules")![0]!.run_as).toBeNull();
    });

    /**
     * 🔴 Menor da rodada 4: `ehViolacaoDeRls` exige `code === "42501"` E o
     * texto — nenhum teste conferia que as DUAS condições eram exigidas
     * (em vez de só uma). Os dois casos abaixo têm só METADE do par: o
     * texto certo com outro código, e o código certo com outro texto. Nos
     * dois, `ehViolacaoDeRls` deve recusar classificar como RLS — e o erro
     * vira falha de verdade, não "pulado".
     */
    it("cinto-e-suspensórios NÃO classifica como RLS quando só o TEXTO bate (código diferente)", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      tabelas.get("schedules")![0]!.name = "Nome Velho";
      forcarErro("schedules", "update", {
        message: 'new row violates row-level security policy for table "schedules"',
        code: "23505", // texto de RLS, mas código de outra família (unique violation)
      });

      await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
        /^não deu pra atualizar os agendamentos deste workspace$/,
      );
    });

    it("cinto-e-suspensórios NÃO classifica como RLS quando só o CÓDIGO bate (texto diferente)", async () => {
      await materializarWorkspace(db, "org-1", "dono-1");
      tabelas.get("schedules")![0]!.name = "Nome Velho";
      forcarErro("schedules", "update", {
        message: "permission denied for column token_hash", // 42501 de verdade, mas não é RLS
        code: "42501",
      });

      await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
        /^não deu pra atualizar os agendamentos deste workspace$/,
      );
    });
  });

  describe("erros viram mensagem leiga, nunca texto de Postgres (regra 6)", () => {
    describe("agents", () => {
      it("falha ao conferir quem já existe", async () => {
        forcarErro("agents", "select");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra conferir os agentes já existentes deste workspace$/,
        );
      });

      it("falha ao gravar quem está faltando", async () => {
        forcarErro("agents", "insert");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra gravar os agentes deste workspace$/,
        );
      });

      it("falha ao atualizar quem já existe", async () => {
        await materializarWorkspace(db, "org-1", "dono-1");
        tabelas.get("agents")![0]!.name = "Nome Velho";
        forcarErro("agents", "update");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra atualizar os agentes deste workspace$/,
        );
      });

      /**
       * 🔴 Item 2 da rodada 3, ramo AGENTS: sem "pulado" pra agentes (esse
       * conceito só existe em agendamentos, por causa do N1) — zero linhas
       * batendo no UPDATE sem `error` vira FALHA de verdade, igual a
       * qualquer outro erro de escrita.
       */
      it("UPDATE que bate em zero linhas sem erro vira falha de verdade (sem 'pulado' pra agentes)", async () => {
        await materializarWorkspace(db, "org-1", "dono-1");
        tabelas.get("agents")![0]!.name = "Nome Velho";
        forcarZeroNoUpdate("agents");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra atualizar os agentes deste workspace$/,
        );
      });
    });

    describe("knowledge_bases", () => {
      it("falha ao conferir quem já existe", async () => {
        forcarErro("knowledge_bases", "select");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra conferir as bases de conhecimento já existentes deste workspace$/,
        );
      });

      it("falha ao gravar quem está faltando, com a instrução da regra 10-I", async () => {
        forcarErro("knowledge_bases", "insert");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /crie outra base, com outro apelido, e suba os arquivos de novo/,
        );
      });

      it("falha ao atualizar quem já existe, com a instrução da regra 10-I", async () => {
        await materializarWorkspace(db, "org-1", "dono-1");
        tabelas.get("knowledge_bases")![0]!.name = "Nome Velho";
        forcarErro("knowledge_bases", "update");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /crie outra base, com outro apelido, e suba os arquivos de novo/,
        );
      });

      it("UPDATE que bate em zero linhas sem erro vira falha de verdade (sem 'pulado' pra bases)", async () => {
        await materializarWorkspace(db, "org-1", "dono-1");
        tabelas.get("knowledge_bases")![0]!.name = "Nome Velho";
        forcarZeroNoUpdate("knowledge_bases");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /crie outra base, com outro apelido, e suba os arquivos de novo/,
        );
      });
    });

    describe("schedules", () => {
      it("falha ao conferir quem já existe", async () => {
        forcarErro("schedules", "select");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra conferir os agendamentos já existentes deste workspace$/,
        );
      });

      it("falha ao gravar quem está faltando", async () => {
        forcarErro("schedules", "insert");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra gravar os agendamentos deste workspace$/,
        );
      });

      // O caso "falha ao atualizar" (não-RLS) está coberto no describe de N1
      // acima, junto com o caso RLS que ele precisa se distinguir.
    });

    describe("webhook_endpoints (insert-only, sem ramo de update)", () => {
      it("falha ao conferir quem já existe", async () => {
        forcarErro("webhook_endpoints", "select");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra conferir os webhooks já existentes deste workspace$/,
        );
      });

      it("falha ao gravar quem está faltando", async () => {
        forcarErro("webhook_endpoints", "insert");
        await expect(materializarWorkspace(db, "org-1", "dono-1")).rejects.toThrow(
          /^não deu pra gravar os webhooks deste workspace$/,
        );
      });
    });
  });

  /**
   * 🔴 N5 da rodada 2: os `logError` de apelido não resolvido tinham entrado
   * sem teste nenhum — texto sem teste regride calado. Precisa de um registro
   * ONDE `AGENTES` não contém o apelido que `AGENDAMENTOS`/`WEBHOOKS`
   * referenciam, o que exige remontar o módulo com outro mock (o mock do
   * topo do arquivo é fixo e usado por todos os outros testes).
   */
  describe("apelido de agente não resolvido é descartado e logado, nunca calado", () => {
    async function materializarSemAgenteResolvido() {
      vi.resetModules();
      vi.doMock("@/lib/seed/registro", () => ({
        AGENTES: [],
        BASES: [],
        AGENDAMENTOS: AGENDAMENTOS_FIXTURE,
        WEBHOOKS: WEBHOOKS_FIXTURE,
      }));
      vi.doMock("@/lib/ai/catalog", () => ({
        isKnownModelId: () => true,
        DEFAULT_MODEL_ID: "openai:gpt-4o-mini",
      }));
      const { materializarWorkspace: materializarDeNovo } = await import("@/lib/seed/materializar");
      const { db: dbLocal } = bancoFalso();
      return materializarDeNovo(dbLocal, "org-1", "dono-1");
    }

    it("agendamento e webhook sem agente resolvido não entram no banco, e o motivo fica no log", async () => {
      const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const r = await materializarSemAgenteResolvido();
        expect(r.agentes).toBe(0);
        expect(r.agendamentos).toBe(0);
        expect(r.webhooks).toBe(0);
        const linhasLogadas = espiao.mock.calls.map((args) => String(args[0]));
        expect(linhasLogadas.some((l) => l.includes("seed.agendamentos.apelido"))).toBe(true);
        expect(linhasLogadas.some((l) => l.includes("seed.webhooks.apelido"))).toBe(true);
      } finally {
        espiao.mockRestore();
        vi.resetModules();
      }
    });
  });
});
