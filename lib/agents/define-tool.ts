/**
 * Como uma ferramenta de agente é declarada.
 *
 * "Ferramenta" aqui é uma função que o modelo pode pedir pra rodar no meio da
 * conversa: consultar tarefas, buscar um cliente, mandar um email. O modelo
 * escolhe QUANDO usar; o código decide O QUE ela faz.
 *
 * Três coisas que este arquivo garante, e que não dá pra contornar:
 *
 * 1. **Sem schema, não entra.** Toda ferramenta declara a entrada em Zod, e a
 *    entrada é validada ANTES do código do autor rodar. O modelo erra o
 *    formato o tempo todo — sem isso, o erro apareceria lá dentro, como
 *    "não consegui ler uma propriedade de undefined".
 * 2. **O nome é ASCII kebab-case.** É o nome que vai pro modelo, e Anthropic e
 *    OpenAI recusam a chamada inteira se o nome tiver acento, espaço ou
 *    maiúscula. Erro no carregamento do módulo é melhor que erro em produção.
 * 3. **Falha vira dado, não exceção.** O retorno de erro é
 *    `{ erro: "…" }` — em PT-BR, sem detalhe técnico. O modelo lê e tenta
 *    outra coisa; o aluno lê no rastro e entende.
 *
 * Arquivo PURO: não fala com banco, não lê cookie, dá pra testar no Vitest.
 */
import type { z } from "zod";
import type { ToolContext } from "./tool-context";
import type { OrgRole } from "./types";

/**
 * O formato aceito pra nome de ferramenta: minúsculas ASCII, números e hífen,
 * começando por letra. É o que Anthropic e OpenAI aceitam como nome de tool.
 *
 * O tamanho (2 a 48) é conferido separadamente, pra mensagem de erro ficar
 * específica.
 */
export const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const TOOL_ID_MIN = 2;
const TOOL_ID_MAX = 48;
const TOOL_LABEL_MAX = 60;
const TOOL_DESCRIPTION_MIN = 10;
const TOOL_DESCRIPTION_MAX = 1_000;

/**
 * O que uma ferramenta devolve quando não deu certo.
 *
 * Vira JSON e volta pro modelo como resultado da chamada — por isso a chave é
 * `erro` e o conteúdo é em PT-BR: o modelo lê isso e decide o que fazer, e o
 * mesmo texto aparece no rastro que o aluno abre.
 */
export type ToolFailure = { erro: string };

export function isToolFailure(value: unknown): value is ToolFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "erro" in value &&
    typeof (value as { erro: unknown }).erro === "string"
  );
}

/** Monta a resposta de falha de uma ferramenta. Sempre em PT-BR leigo. */
export function falhaDeFerramenta(mensagem: string): ToolFailure {
  return { erro: mensagem };
}

/**
 * O que o autor de uma ferramenta escreve.
 *
 * Ver `lib/agents/tools/_TEMPLATE_ferramenta.ts` pra um esqueleto pronto pra
 * copiar, e `lib/agents/tools/buscar-na-base.ts` pra um exemplo de verdade.
 */
export type ToolSpec<TSchema extends z.ZodType, TOutput> = {
  /**
   * kebab-case ASCII, sem acento. É o nome que o MODELO enxerga, então
   * escolha algo que descreva a ação: `buscar-na-base`, `criar-lead`.
   */
  id: string;
  /** Rótulo em PT-BR pro painel. Ex.: "Buscar na base de conhecimento". */
  label: string;
  /**
   * Descrição em PT-BR que VAI PRO MODELO. Diga o que ela faz **e quando
   * usar** — é isso que faz o modelo escolher a ferramenta certa na hora
   * certa. Descrição vaga é a causa nº 1 de agente que não chama a ferramenta.
   */
  description: string;
  /**
   * O formato da entrada, em Zod. Todo campo com `.describe()` em PT-BR: o
   * texto do `.describe()` também vai pro modelo.
   */
  inputSchema: TSchema;
  /**
   * `undefined` = qualquer membro do workspace pode usar.
   * Ex.: `["owner", "admin"]` pra uma ferramenta que manda email.
   *
   * Quem confere é o motor, ao montar a execução: ferramenta que a pessoa não
   * pode usar simplesmente não é oferecida ao modelo naquela execução.
   */
  requiresRole?: readonly OrgRole[];
  /**
   * Essa ferramenta AGE (manda email, chama sistema de fora)?
   *
   * ⚠️ ISTO É RÓTULO, NÃO MECANISMO. Quem impede a ação em modo ensaio é o
   * `ctx.acao` (onda 7) — ele simplesmente não age de verdade, não importa o
   * que este campo diga. Se `age` estiver errado (esquecido, ou marcado numa
   * ferramenta que não age), o pior que acontece é a tela não avisar direito
   * pro aluno; a ação em si continua barrada do mesmo jeito.
   *
   * Aceita função da entrada porque a MESMA ferramenta pode só ler numa
   * chamada e agir na outra (ex.: `GET` contra `POST` de uma ferramenta HTTP
   * genérica) — nesse caso o rótulo depende do que o modelo pediu.
   */
  age?: boolean | ((input: z.output<TSchema>) => boolean);
  /**
   * O trabalho em si.
   *
   * Só enxerga o banco por `ctx.db`, que já está preso ao workspace. Devolva
   * um objeto simples (vira JSON pro modelo). Pra sinalizar erro previsto,
   * devolva `falhaDeFerramenta("mensagem em português")`.
   */
  execute: (input: z.output<TSchema>, ctx: ToolContext) => Promise<TOutput>;
};

/**
 * O que o registro guarda.
 *
 * Repare que o tipo da entrada foi APAGADO aqui de propósito. Sem isso, um
 * array com ferramentas de entradas diferentes não teria tipo comum, e a saída
 * seria `any` ou `@ts-expect-error` — os dois proibidos. O genérico vive só
 * dentro do `defineTool`, onde ele importa; do lado de fora, quem valida a
 * entrada é o `run`.
 */
export type RegisteredTool = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  /** `null` = qualquer membro pode usar. */
  readonly requiresRole: readonly OrgRole[] | null;
  /**
   * Rótulo de `ToolSpec.age`, propagado — não CALCULADO aqui, só carregado
   * adiante. O tipo perde o genérico `TSchema` (mesmo motivo do resto deste
   * tipo): a função, quando existe, já vem embrulhada pra aceitar `unknown`
   * e fazer o cast por dentro, do mesmo jeito que `run` faz com `execute`.
   *
   * ⚠️ Sem esta propagação, `age: true` numa ferramenta COMPILA, passa no
   * lint, e não chega a lugar nenhum — quem descreveu a ferramenta acha que
   * marcou o rótulo e a tela nunca vê o valor.
   */
  readonly age: boolean | ((input: unknown) => boolean) | undefined;
  /**
   * Valida a entrada com o `inputSchema` e só então chama o `execute` do
   * autor. Entrada fora do formato volta como `{ erro: … }` — sem exceção,
   * porque quem errou foi o modelo, e ele consegue tentar de novo.
   */
  readonly run: (rawInput: unknown, ctx: ToolContext) => Promise<unknown>;
};

function exigir(condicao: boolean, mensagem: string): void {
  if (!condicao) {
    // Erro de programação, não de usuário: acontece no carregamento do módulo,
    // ou seja, no `npm run dev` / no build, nunca na frente do aluno.
    throw new Error(`defineTool: ${mensagem}`);
  }
}

/**
 * Declara uma ferramenta.
 *
 * As checagens de nome/rótulo/descrição rodam no CARREGAMENTO do módulo (é
 * chamada no topo do arquivo da ferramenta), então um erro aqui aparece na
 * hora em que o registro é importado — não meia hora depois, no meio de uma
 * execução.
 */
export function defineTool<TSchema extends z.ZodType, TOutput>(
  spec: ToolSpec<TSchema, TOutput>,
): RegisteredTool {
  const { id, label, description, inputSchema, requiresRole, age, execute } = spec;

  exigir(typeof id === "string" && id.length >= TOOL_ID_MIN, `id curto demais: "${id}"`);
  exigir(id.length <= TOOL_ID_MAX, `id longo demais (máximo ${TOOL_ID_MAX}): "${id}"`);
  exigir(
    TOOL_ID_PATTERN.test(id),
    `id "${id}" fora do formato. Use minúsculas ASCII, números e hífen ` +
      `(ex.: "buscar-na-base"). Acento, espaço e maiúscula fazem o provedor ` +
      "recusar a chamada inteira.",
  );
  exigir(label.trim().length > 0, `a ferramenta "${id}" está sem label`);
  exigir(
    label.length <= TOOL_LABEL_MAX,
    `label da ferramenta "${id}" longo demais (máximo ${TOOL_LABEL_MAX})`,
  );
  exigir(
    description.trim().length >= TOOL_DESCRIPTION_MIN,
    `a descrição da ferramenta "${id}" está curta demais. É ela que o modelo lê ` +
      "pra decidir quando usar a ferramenta.",
  );
  exigir(
    description.length <= TOOL_DESCRIPTION_MAX,
    `descrição da ferramenta "${id}" longa demais (máximo ${TOOL_DESCRIPTION_MAX})`,
  );

  const papeis = requiresRole && requiresRole.length > 0 ? [...requiresRole] : null;

  return {
    id,
    label,
    description,
    inputSchema,
    requiresRole: papeis,
    // A função (quando `age` é uma) embrulha o cast pro `z.output<TSchema>`
    // aqui dentro — o mesmo padrão do `run`, logo abaixo — porque o tipo
    // genérico não sobrevive fora do `defineTool`.
    age: typeof age === "function" ? (input: unknown) => age(input as z.output<TSchema>) : age,
    async run(rawInput: unknown, ctx: ToolContext): Promise<unknown> {
      // Cinto e suspensório: o motor já filtra por papel ao montar a execução
      // (`buildToolSet`). Esta segunda checagem existe pra ferramenta chamada
      // por outro caminho — teste, fila da onda 4 — não escapar da regra.
      if (papeis !== null && !papeis.includes(ctx.role)) {
        return falhaDeFerramenta(
          `Você não tem permissão pra usar "${label}" neste workspace. ` +
            "Peça pra quem administra o workspace.",
        );
      }

      const parsed = inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        const problemas = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "entrada"}: ${i.message}`)
          .join("; ");
        return falhaDeFerramenta(
          `A ferramenta "${label}" foi chamada com dados fora do formato (${problemas}). ` +
            "Tente de novo com os campos certos.",
        );
      }

      return await execute(parsed.data as z.output<TSchema>, ctx);
    },
  };
}
