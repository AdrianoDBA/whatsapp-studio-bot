/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  MOLDE DE FERRAMENTA — copie este arquivo pra criar a sua                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Ferramenta é uma função que o agente pode PEDIR pra rodar no meio da
 * conversa: "buscar os leads de julho", "criar uma tarefa", "mandar um email".
 * O modelo decide QUANDO usar; este arquivo decide O QUE ela faz.
 *
 * COMO USAR ESTE MOLDE (4 passos)
 * ------------------------------
 * 1. Copie o arquivo pra `lib/agents/tools/minha-ferramenta.ts`.
 * 2. Troque `id`, `label`, `description`, o `inputSchema` e o `execute`.
 * 3. Registre em `lib/agents/tools/index.ts`: um `import` no topo e o nome no
 *    array `TOOL_REGISTRY`. Sem esse passo, a ferramenta não aparece no painel.
 * 4. `npm run verify`.
 *
 * Depois disso ela aparece na lista de ferramentas do agente, no painel, pra
 * marcar. Nenhum passo a mais.
 *
 * ⚠️ ESTE ARQUIVO NÃO ESTÁ NO `TOOL_REGISTRY`, de propósito: ele é molde, não
 * ferramenta de verdade. Copie — não edite este aqui.
 */
import { z } from "zod";
import { defineTool, falhaDeFerramenta } from "../define-tool";

/**
 * O FORMATO DA ENTRADA.
 *
 * É por aqui que o modelo "conversa" com a sua função. Duas regras que fazem
 * toda a diferença na qualidade do agente:
 *
 *   • **`.describe()` em PT-BR em TODO campo.** Esse texto vai junto pro
 *     modelo. Campo sem descrição é campo que ele preenche chutando.
 *   • **Prefira poucos campos e bem óbvios.** Um `filtro: string` genérico faz
 *     o modelo inventar; `situacao: "pendente" | "concluida"` não deixa.
 *
 * E sempre ponha um teto no que pode crescer (`limite`, `max()`): o resultado
 * volta pra conversa, e conversa grande custa dinheiro em todo passo seguinte.
 */
const inputSchema = z.object({
  busca: z
    .string()
    .min(2)
    .max(80)
    .describe("Pedaço do texto que a pessoa quer procurar. Pelo menos 2 letras."),
  limite: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Quantos resultados trazer no máximo (padrão 10, teto 50)."),
});

export const minhaFerramenta = defineTool({
  /** kebab-case ASCII, sem acento. É o nome que o MODELO enxerga. */
  id: "minha-ferramenta",

  /** Rótulo em PT-BR. É o que aparece no painel, pro aluno marcar. */
  label: "Minha ferramenta",

  /**
   * A descrição vai pro MODELO. Diga o que faz **e quando usar** — é isso que
   * faz ele escolher a ferramenta certa. Descrição vaga é o motivo nº 1 de
   * "criei a ferramenta e o agente nunca usa".
   */
  description:
    "Procura registros deste workspace por uma palavra. Use quando a pessoa pedir pra " +
    "encontrar, listar ou conferir alguma coisa pelo nome.",

  inputSchema,

  /**
   * Opcional. Sem isso, qualquer membro do workspace pode usar.
   * Com isso, a ferramenta nem é oferecida ao modelo quando quem mandou rodar
   * não tem o papel. Use em qualquer coisa que gaste dinheiro ou mande
   * mensagem pra fora (email, WhatsApp, cobrança).
   */
  // requiresRole: ["owner", "admin"],

  /**
   * O TRABALHO.
   *
   * Repare no que NÃO tem aqui: nenhum `createClient`, nenhum
   * `organization_id`, nenhum `eq("organization_id", ...)`. O `ctx.db` já vem
   * preso ao workspace da execução — e é por isso que não existe um jeito de
   * esquecer o filtro.
   *
   * 🚫 NUNCA escreva `import { createClient } from "@/lib/supabase/server"`
   *    dentro de uma ferramenta. Existe um teste que quebra o
   *    `npm run verify` se alguém fizer isso.
   */
  async execute(input, ctx) {
    const limite = input.limite ?? 10;

    // Troque `documents` pela SUA tabela (aqui é só pro exemplo compilar).
    // Ela precisa ter `organization_id` — se não tiver, o TypeScript recusa o
    // nome aqui, e está certo.
    // Se a tabela é nova, acrescente o bloco dela em `lib/agents/tool-context.ts`.
    let consulta = ctx.db
      .from("documents")
      .select()
      .order("created_at", { ascending: false })
      .limit(limite);

    // `%` e `_` são curingas no `ilike`: sem escapar, procurar por "100%"
    // viraria "traga tudo".
    const termo = input.busca.replace(/[\\%_]/g, "\\$&");
    consulta = consulta.ilike("title", `%${termo}%`);

    // Faz a consulta desistir junto com a execução, quando a pessoa cancela.
    if (ctx.signal) consulta = consulta.abortSignal(ctx.signal);

    const { data, error } = await consulta;

    if (error) {
      // Erro do banco NUNCA volta cru: nem pro modelo, nem pro rastro que o
      // aluno lê. Jogue uma exceção curta — o motor registra o detalhe
      // técnico com `logError()` e devolve português pro modelo.
      throw new Error(`minha-ferramenta: ${error.code ?? "erro"}`);
    }

    const linhas = data ?? [];

    if (linhas.length === 0) {
      // "Não achei nada" NÃO é exceção: é uma resposta. Devolva assim, que o
      // modelo entende e continua a conversa.
      return falhaDeFerramenta(
        `Não achei nada com "${input.busca}" neste workspace. Tente outra palavra.`,
      );
    }

    // Devolva um objeto simples, com nomes em português: é isso que o modelo
    // vai ler. Mande só o que ele precisa — cada campo a mais é conversa mais
    // cara em todos os passos seguintes.
    return {
      total: linhas.length,
      resultados: linhas.map((linha) => ({
        id: linha.id,
        titulo: linha.title,
        criadoEm: linha.created_at,
      })),
      // `ctx` também tem `organizationSlug`, `userId`, `role`, `runId` e
      // `agentSlug`, se você precisar montar um link ou registrar algo.
    };
  },
});
