/**
 * GUARDA ESTÁTICA: toda ferramenta cabe no que a PONTE sabe traduzir.
 *
 * O problema que este teste existe pra impedir é o mais chato de diagnosticar
 * do template inteiro, e o contrato do bloco 2 batizou ele assim:
 *
 *     "funciona no painel, falha às 8h da manhã"
 *
 * Pelo painel (e pelo chat), a ferramenta fala com o PostgREST DE VERDADE, que
 * entende tudo. Por uma automação — agendamento ou webhook — não existe ninguém
 * logado: o `ctx.db` continua sendo um cliente do Supabase de verdade, mas o
 * transporte dele é `lib/automation/postgrest-bridge.ts`, que traduz o pedido
 * pra SQL e fala um SUBCONJUNTO.
 *
 * Uma ferramenta que use `.or(...)`, `.textSearch(...)`, `.upsert(...)` ou
 * `.match(...)` roda redondo no `npm run dev`, passa na revisão, e quebra às 8h
 * da manhã dentro do agendamento — quando ninguém está olhando.
 *
 * Então este teste lê o CÓDIGO-FONTE de `lib/agents/tools/`, segue toda cadeia
 * que começa em `ctx.db` e reprova método fora da lista. É feio de propósito,
 * igual `tests/agents-tools-no-raw-client.test.ts`: um teste que lê arquivo
 * chama atenção, e é isso que se quer aqui.
 *
 * ⚠️ Ele cobre as ferramentas DESTE repositório. A ferramenta que o aluno
 * escrever depois também é lida (a pasta é varrida inteira), mas ferramenta que
 * more fora de `lib/agents/tools/` não é — e aí a rede que sobra é a de
 * execução: a ponte estoura com `BridgeUnsupportedError`, o trabalho falha com
 * frase em português e o agendamento é PAUSADO em vez de falhar todo dia calado.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERADORES_DA_PONTE } from "@/lib/automation/postgrest-bridge";
import { semComentarios } from "./helpers/sem-comentarios";

const PASTA_DAS_FERRAMENTAS = join(process.cwd(), "lib", "agents", "tools");

/**
 * Método do supabase-js → o operador que a ponte precisa conhecer.
 *
 * Esta tabela é conferida contra `OPERADORES_DA_PONTE` num teste abaixo: se
 * alguém ENCOLHER a lista da ponte, este arquivo fica vermelho junto, em vez de
 * continuar liberando um filtro que deixou de existir.
 */
const FILTROS: Record<string, (typeof OPERADORES_DA_PONTE)[number]> = {
  eq: "eq",
  neq: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  like: "like",
  ilike: "ilike",
  is: "is",
  in: "in",
  contains: "cs",
  containedBy: "cd",
  not: "not",
};

/** O que monta a consulta. `from` vem do `ctx.db`, o resto do PostgREST. */
const ESTRUTURAIS = [
  "from",
  "select",
  "insert",
  "update",
  "delete",
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
] as const;

/**
 * Métodos que NÃO viram pedido HTTP — são só tipagem ou detalhe do cliente.
 * Passar por eles não muda nada do que a ponte precisa traduzir.
 */
const NEUTROS = ["returns", "overrideTypes", "throwOnError", "abortSignal"] as const;

const ACEITOS = new Set<string>([...Object.keys(FILTROS), ...ESTRUTURAIS, ...NEUTROS]);

/**
 * Por que cada método famoso está de fora — a mensagem que aparece quando o
 * teste reprova. Sem isto, o aluno lê "método não suportado" e não sabe o que
 * fazer no lugar.
 */
const EXPLICACAO: Record<string, string> = {
  or: 'a ponte não junta condição com "ou". Faça duas consultas, ou filtre em JavaScript depois',
  filter:
    "filtro montado como texto não passa pela lista fechada de operadores — use .eq/.in/.ilike",
  match: "não é traduzido — troque por .eq() encadeado, um por coluna",
  upsert: "gravar-ou-atualizar não roda fora da tela — decida entre .insert() e .update()",
  textSearch:
    "busca por texto do Postgres não é traduzida — use .ilike(), ou ctx.knowledge.search()",
  overlaps: "não é traduzido",
  rpc: "ferramenta não chama função do banco direto; a lista da ponte é fechada",
  csv: "a ponte devolve JSON montado pelo próprio Postgres",
  explain: "não é traduzido",
  likeAllOf: "não é traduzido",
  likeAnyOf: "não é traduzido",
  ilikeAllOf: "não é traduzido",
  ilikeAnyOf: "não é traduzido",
  rangeGt: "operador de intervalo não é traduzido",
  rangeGte: "operador de intervalo não é traduzido",
  rangeLt: "operador de intervalo não é traduzido",
  rangeLte: "operador de intervalo não é traduzido",
  rangeAdjacent: "operador de intervalo não é traduzido",
};

// ---------------------------------------------------------------------------
// O leitor de código
// ---------------------------------------------------------------------------

type Chamada = { metodo: string; argumentos: string };

/**
 * Anda pela cadeia `.metodo(...)` a partir de um ponto do texto e devolve o que
 * foi chamado. Para no primeiro caractere que não continua a cadeia (`;`, `,`,
 * fim de bloco), então `const { data } = await consulta;` não vira ruído.
 */
function chamadasDaCadeia(codigo: string, comeco: number): Chamada[] {
  const chamadas: Chamada[] = [];
  let i = comeco;

  while (i < codigo.length) {
    while (i < codigo.length && /\s/.test(codigo[i] as string)) i++;
    if (codigo[i] !== ".") break;
    i++;

    const nome = /^[A-Za-z_$][\w$]*/.exec(codigo.slice(i))?.[0];
    if (!nome) break;
    i += nome.length;

    while (i < codigo.length && /\s/.test(codigo[i] as string)) i++;
    if (codigo[i] !== "(") {
      // Acesso a propriedade (`.data`, `.length`): a cadeia de consulta acabou.
      break;
    }

    const abertura = i;
    i = fimDoParenteses(codigo, i);
    chamadas.push({ metodo: nome, argumentos: codigo.slice(abertura + 1, i - 1) });
  }

  return chamadas;
}

/** Índice logo DEPOIS do `)` que fecha o `(` de `inicio`. Pula texto entre aspas. */
function fimDoParenteses(codigo: string, inicio: number): number {
  let nivel = 0;
  let i = inicio;

  while (i < codigo.length) {
    const c = codigo[i];

    if (c === '"' || c === "'" || c === "`") {
      i = fimDaString(codigo, i);
      continue;
    }
    if (c === "(") nivel++;
    if (c === ")") {
      nivel--;
      if (nivel === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** Índice logo DEPOIS da aspa que fecha. Respeita a barra invertida. */
function fimDaString(codigo: string, inicio: number): number {
  const aspa = codigo[inicio];
  let i = inicio + 1;
  while (i < codigo.length) {
    if (codigo[i] === "\\") {
      i += 2;
      continue;
    }
    if (codigo[i] === aspa) return i + 1;
    i++;
  }
  return i;
}

/**
 * Toda chamada de consulta de um arquivo: as que começam direto em `ctx.db` e
 * as que começam numa variável que recebeu o `ctx.db` (`let consulta = ctx.db`
 * … `consulta = consulta.eq(...)`, que é como a ferramenta de exemplo escreve).
 */
function chamadasDoArquivo(fonte: string): Chamada[] {
  const codigo = semComentarios(fonte);
  const chamadas: Chamada[] = [];

  const variaveis = new Set<string>();
  for (const m of codigo.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?ctx\.db\b/g,
  )) {
    variaveis.add(m[1] as string);
  }

  for (const m of codigo.matchAll(/ctx\.db\b/g)) {
    chamadas.push(...chamadasDaCadeia(codigo, (m.index ?? 0) + "ctx.db".length));
  }

  for (const nome of variaveis) {
    const re = new RegExp(`(?<![\\w$.])${nome}(?=\\s*\\.)`, "g");
    for (const m of codigo.matchAll(re)) {
      chamadas.push(...chamadasDaCadeia(codigo, (m.index ?? 0) + nome.length));
    }
  }

  return chamadas;
}

function arquivosDeFerramenta(): string[] {
  return readdirSync(PASTA_DAS_FERRAMENTAS, { recursive: true, encoding: "utf8" }).filter(
    (nome) => nome.endsWith(".ts") && nome !== "index.ts",
  );
}

// ---------------------------------------------------------------------------
// Os testes
// ---------------------------------------------------------------------------

describe("lib/agents/tools — toda ferramenta cabe no subconjunto da ponte", () => {
  it("a pasta tem ferramenta pra conferir (senão este teste não prova nada)", () => {
    expect(arquivosDeFerramenta().length).toBeGreaterThan(0);
  });

  it.each(arquivosDeFerramenta())("%s só usa método que a ponte traduz", (nome) => {
    const fonte = readFileSync(join(PASTA_DAS_FERRAMENTAS, nome), "utf8");

    for (const { metodo, argumentos } of chamadasDoArquivo(fonte)) {
      const motivo =
        EXPLICACAO[metodo] ?? "não está na lista que lib/automation/postgrest-bridge.ts traduz";

      expect(
        ACEITOS.has(metodo),
        `${nome} usa .${metodo}() no ctx.db — ${motivo}. ` +
          "Isso funciona no painel e QUEBRA na automação (ver regra 9 de lib/agents/CLAUDE.md).",
      ).toBe(true);

      // `select("*, outra_tabela(coluna)")` é embed do PostgREST: a ponte lê uma
      // tabela por vez, então isso viraria coluna inexistente no SQL.
      if (metodo === "select" && argumentos.includes("(")) {
        expect(
          false,
          `${nome} pede tabela embutida no select() — a ponte lê uma tabela por vez. ` +
            "Faça duas consultas.",
        ).toBe(true);
      }
    }
  });

  /**
   * ⚠️ Hoje quem sustenta esta prova é `_TEMPLATE_ferramenta.ts`, não uma
   * ferramenta registrada: nenhuma das duas do `TOOL_REGISTRY` toca `ctx.db`
   * mais (`buscar-na-base` usa `ctx.knowledge`, `mandar-email` usa
   * `ctx.acao` — ver a Onda "código é o dono", que apagou `consultar-tarefas`,
   * a última que tocava). É escolha deliberada, não acidente: o exemplo
   * trabalhado de `ctx.db` mora no molde — é ele que o aluno e o Claude Code
   * olham pra escrever ferramenta nova — e o molde ENTRA nesta varredura
   * (`arquivosDeFerramenta()` só exclui `index.ts`, não `_TEMPLATE_*`).
   */
  it("alguma ferramenta encosta em ctx.db (o leitor está achando algo, não passando calado)", () => {
    const total = arquivosDeFerramenta()
      .map((nome) => chamadasDoArquivo(readFileSync(join(PASTA_DAS_FERRAMENTAS, nome), "utf8")))
      .reduce((soma, c) => soma + c.length, 0);

    expect(total).toBeGreaterThan(0);
  });
});

describe("o leitor de código funciona (senão o teste acima passa por engano)", () => {
  it("acha a cadeia escrita em várias linhas, com a variável no meio", () => {
    const fonte = `
      let consulta = ctx.db
        .from("tasks")
        .select()
        .order("created_at", { ascending: false })
        .limit(limite);
      if (input.situacao) consulta = consulta.eq("status", "done");
      const { data } = await consulta;
    `;
    const metodos = chamadasDoArquivo(fonte).map((c) => c.metodo);
    expect(metodos).toContain("from");
    expect(metodos).toContain("select");
    expect(metodos).toContain("order");
    expect(metodos).toContain("limit");
    expect(metodos).toContain("eq");
    expect(metodos).not.toContain("data");
  });

  it("reprova .or() — é o caso que estraga a automação", () => {
    const metodos = chamadasDoArquivo(
      'const c = ctx.db.from("tasks").select().or("status.eq.done,status.eq.doing");',
    ).map((m) => m.metodo);

    expect(metodos).toContain("or");
    expect(metodos.every((m) => ACEITOS.has(m))).toBe(false);
  });

  it("não confunde texto entre aspas com o fim da cadeia", () => {
    // O parêntese está DENTRO do texto procurado, e o texto está entre crases:
    // as duas coisas que fariam um leitor ingênuo achar que a cadeia acabou.
    const metodos = chamadasDoArquivo(
      'ctx.db.from("tasks").select().ilike("title", `%urgente (mesmo)%`).limit(5);',
    ).map((m) => m.metodo);

    expect(metodos).toEqual(["from", "select", "ilike", "limit"]);
  });

  it("ignora o que está dentro de comentário", () => {
    const metodos = chamadasDoArquivo(
      '// ctx.db.from("tasks").upsert({});\n/* ctx.db.from("x").or("a"); */\n',
    ).map((m) => m.metodo);

    expect(metodos).toEqual([]);
  });
});

describe("a lista deste teste continua batendo com a da ponte", () => {
  it("todo filtro liberado aqui existe em OPERADORES_DA_PONTE", () => {
    for (const operador of Object.values(FILTROS)) {
      expect(OPERADORES_DA_PONTE).toContain(operador);
    }
  });

  it("todo operador da ponte tem um método correspondente liberado aqui", () => {
    const cobertos = new Set<string>(Object.values(FILTROS));
    for (const operador of OPERADORES_DA_PONTE) {
      expect(cobertos.has(operador), `o operador "${operador}" da ponte não tem método aqui`).toBe(
        true,
      );
    }
  });
});
