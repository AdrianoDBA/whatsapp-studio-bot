/**
 * Onde a ferramenta declarada em código vira uma ferramenta que o AI SDK
 * entrega pro modelo.
 *
 * Duas decisões que valem a pena entender:
 *
 * **1. O contexto chega por closure, não pelo `experimental_context` do SDK.**
 * O AI SDK tem um campo `experimental_context`, mas ele é do tipo `unknown` —
 * usar ele obrigaria toda ferramenta a fazer um `as ToolContext` na primeira
 * linha, o que reabre exatamente o buraco que o `ctx.db` fecha (um `as` errado
 * e a ferramenta passa a falar com o banco sem filtro). Aqui o conjunto de
 * ferramentas é montado uma vez POR EXECUÇÃO, já com o contexto certo dentro.
 *
 * **2. Falha de ferramenta nunca é relançada.** O erro é capturado, registrado
 * com `logError()` e devolvido pro modelo como `{ erro: "…" }` em PT-BR. Se
 * fosse relançado, o AI SDK mandaria o `error.message` do Postgres direto pro
 * modelo e pro log que o aluno lê — vazamento proibido pela regra 6 do
 * CLAUDE.md.
 *
 * ⚠️ FALA COM O BANCO (por tabela, através do `ctx.db` e do gravador de
 * rastro). Não importe de um componente com `"use client"`.
 */
import { type ToolSet, tool } from "ai";
import { logError } from "@/lib/logger";
import { falhaDeFerramenta, isToolFailure } from "./define-tool";
import type { RunRecorder } from "./recorder";
import type { ToolContext } from "./tool-context";
import { getTool } from "./tools";

/**
 * Teto de tamanho da resposta de uma ferramenta.
 *
 * Protege duas coisas ao mesmo tempo: o tamanho da conversa (que tem limite no
 * provedor) e a conta no fim do mês (todo caractere que volta pra conversa é
 * cobrado de novo em cada passo seguinte).
 */
export const MAX_TOOL_OUTPUT_CHARS = 8_000;

export type BuildToolSetResult = {
  /** Pronto pra entregar no `tools` do `generateText`. */
  tools: ToolSet;
  /** Quais ferramentas realmente entraram nesta execução. */
  enabledIds: string[];
  /** Avisos em PT-BR pra tela: id que não existe mais, ferramenta pulada por papel. */
  warnings: string[];
};

export function buildToolSet(params: {
  toolIds: readonly string[];
  ctx: ToolContext;
  recorder: RunRecorder;
}): BuildToolSetResult {
  const { ctx, recorder } = params;

  const tools: ToolSet = {};
  const enabledIds: string[] = [];
  const warnings: string[] = [];
  const jaVistos = new Set<string>();

  for (const id of params.toolIds) {
    if (jaVistos.has(id)) continue;
    jaVistos.add(id);

    const ferramenta = getTool(id);
    if (!ferramenta) {
      warnings.push(
        `A ferramenta "${id}" está marcada neste agente, mas não existe mais no código. ` +
          "Abra o agente e desmarque ela.",
      );
      continue;
    }

    if (ferramenta.requiresRole !== null && !ferramenta.requiresRole.includes(ctx.role)) {
      warnings.push(
        `A ferramenta "${ferramenta.label}" ficou de fora desta execução: ela é só pra ` +
          "quem administra o workspace.",
      );
      continue;
    }

    tools[ferramenta.id] = tool({
      description: ferramenta.description,
      inputSchema: ferramenta.inputSchema,
      execute: async (input: unknown) => {
        const inicio = Date.now();

        if (ctx.signal?.aborted) {
          const cancelada = falhaDeFerramenta("A execução foi cancelada antes desta etapa.");
          await recorder.recordToolStep({
            toolName: ferramenta.id,
            input,
            output: cancelada,
            errorMessage: cancelada.erro,
            durationMs: Date.now() - inicio,
          });
          return cancelada;
        }

        let resultado: unknown;
        try {
          resultado = await ferramenta.run(input, ctx);
        } catch (err) {
          // O detalhe técnico vai SÓ pro registro do servidor. O modelo e o
          // aluno recebem português.
          logError(`agents/tool/${ferramenta.id}`, err);
          resultado = falhaDeFerramenta(
            `A ferramenta "${ferramenta.label}" deu erro e não conseguiu responder. ` +
              "Tente outro caminho ou avise quem cuida do app.",
          );
        }

        // Resposta gigante entope a conversa e multiplica o custo dos passos
        // seguintes. Melhor pedir pro modelo estreitar a busca.
        let tamanho = 0;
        try {
          tamanho = (JSON.stringify(resultado) ?? "").length;
        } catch {
          tamanho = 0;
        }
        if (tamanho > MAX_TOOL_OUTPUT_CHARS) {
          resultado = falhaDeFerramenta(
            `A ferramenta "${ferramenta.label}" devolveu resposta grande demais ` +
              `(${tamanho} caracteres; o limite é ${MAX_TOOL_OUTPUT_CHARS}). ` +
              "Peça um pedaço menor — por exemplo, com um limite de itens ou um filtro.",
          );
        }

        const erro = isToolFailure(resultado) ? resultado.erro : null;

        // O rastro guarda EXATAMENTE o que o modelo recebeu. É o que permite
        // entender depois por que o agente decidiu o que decidiu.
        await recorder.recordToolStep({
          toolName: ferramenta.id,
          input,
          output: resultado,
          errorMessage: erro,
          durationMs: Date.now() - inicio,
        });

        return resultado;
      },
    });

    enabledIds.push(ferramenta.id);
  }

  return { tools, enabledIds, warnings };
}
