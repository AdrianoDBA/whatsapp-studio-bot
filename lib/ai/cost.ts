/**
 * Quanto custou — em micro-dólares INTEIROS.
 *
 * POR QUE INTEIRO
 * ---------------
 * `0.1 + 0.2` em JavaScript dá `0.30000000000000004`. Somar milhares de
 * execuções assim faz o total do mês não bater com nada, e "o app está me
 * cobrando errado" é o pior tipo de bug pra um leigo diagnosticar. Então
 * dinheiro é inteiro em micro-dólares, do catálogo até
 * `agent_runs.cost_micros` (que é `bigint` no banco).
 *
 *   US$ 1,00 = 1_000_000 micro-dólares
 *   US$ 0,0042 = 4_200 micro-dólares
 *
 * ARREDONDA PRA CIMA, dos dois lados. A estimativa que a plataforma mostra
 * nunca pode ser MENOR que a conta que vai chegar: melhor o aluno se
 * surpreender pra baixo.
 *
 * ⚠️ Formatar dinheiro pra tela NÃO é trabalho deste arquivo. Isso mora em
 * `lib/format.ts`, num lugar só. Aqui só se calcula.
 *
 * Arquivo PURO: dá pra testar direto no Vitest.
 */
import { getModel } from "./catalog";
import type { CostBreakdown, ModelCatalogEntry, ModelId, TokenCounts } from "./types";

const MICROS_POR_MILHAO = 1_000_000;

/** Só os campos de preço da ficha do modelo. */
export type ModelPricingFields = Pick<
  ModelCatalogEntry,
  "inputMicrosPerMillion" | "outputMicrosPerMillion" | "longContextPricing"
>;

/** `tokens * preçoPorMilhão / 1M`, sempre pra cima e sempre inteiro. */
function micros(tokens: number, microsPorMilhao: number): number {
  if (tokens <= 0 || microsPorMilhao <= 0) return 0;
  return Math.ceil((tokens * microsPorMilhao) / MICROS_POR_MILHAO);
}

/**
 * Calcula o custo de uma execução.
 *
 * Sobre a FAIXA CARA (`longContextPricing`): quando o modelo cobra mais acima
 * de um tamanho de prompt, o preço mais caro vale pra execução INTEIRA —
 * entrada E saída —, não só pros tokens que passaram do limite. É assim que os
 * provedores cobram, e fingir o contrário faria a estimativa sair por baixo.
 *
 * Sobre `exact: false`: acontece quando o provedor não mandou algum contador de
 * token. O contador que faltou entra como zero, então o valor é um PISO, não a
 * verdade — a tela precisa dizer "aproximado" quando isso vier false.
 */
export function calcCostMicros(input: {
  entry: ModelPricingFields;
  tokens: TokenCounts;
}): CostBreakdown {
  const { entry, tokens } = input;

  const temEntrada = Number.isFinite(tokens.input);
  const temSaida = Number.isFinite(tokens.output);
  const entrada = temEntrada ? Math.max(0, Math.trunc(tokens.input ?? 0)) : 0;
  const saida = temSaida ? Math.max(0, Math.trunc(tokens.output ?? 0)) : 0;

  const faixa = entry.longContextPricing;
  const longContextApplied = faixa !== undefined && entrada > faixa.thresholdTokens;

  const inputMicros = longContextApplied
    ? micros(entrada, faixa.inputMicrosPerMillion)
    : micros(entrada, entry.inputMicrosPerMillion);
  const outputMicros = longContextApplied
    ? micros(saida, faixa.outputMicrosPerMillion)
    : micros(saida, entry.outputMicrosPerMillion);

  return {
    inputMicros,
    outputMicros,
    totalMicros: inputMicros + outputMicros,
    exact: temEntrada && temSaida,
    longContextApplied,
  };
}

/**
 * Mesmo cálculo, partindo do identificador do modelo.
 *
 * Devolve null quando o modelo não está no catálogo — e aí `cost_micros` grava
 * NULL no banco, que a tela lê como "preço desconhecido". NUNCA grave 0: zero
 * é "custou zero mesmo", e mostrar "US$ 0,0000" pra uma execução que custou
 * dinheiro é mentir pro aluno.
 */
export function calcCostMicrosById(modelId: ModelId, tokens: TokenCounts): CostBreakdown | null {
  const entry = getModel(modelId);
  if (!entry) return null;
  return calcCostMicros({ entry, tokens });
}

/** Acha um número dentro de um campo que pode ter vindo como texto. */
function comoNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * O custo REAL que o provedor informou, quando ele informa.
 *
 * O OpenRouter devolve, junto com a contagem de tokens, quanto aquela chamada
 * consumiu de crédito (`cost`, onde 1 crédito = US$ 1). Quando esse número
 * vem, ele vale MAIS que a nossa tabela de preço: verdade do provedor ganha de
 * preço decorado, e é a rede de segurança pra quando o preço do catálogo
 * envelhece.
 *
 * Aceita tanto o objeto `usage` inteiro quanto o `usage.raw` de dentro dele —
 * o AI SDK guarda a resposta crua do provedor em `usage.raw`, e nem todo
 * chamador desembrulha antes.
 *
 * BEST-EFFORT: nunca lança. Devolve null quando não veio nada aproveitável.
 */
export function extractProviderCostMicros(rawUsage: unknown): number | null {
  if (!ehObjeto(rawUsage)) return null;

  const direto = comoNumero(rawUsage.cost);
  const aninhado = ehObjeto(rawUsage.raw) ? comoNumero(rawUsage.raw.cost) : null;
  const creditos = direto ?? aninhado;

  if (creditos === null || creditos < 0) return null;

  // Este é o ÚNICO ponto do caminho onde entra um número quebrado, e ele é
  // convertido pra inteiro na mesma linha: o que sai daqui já é micro-dólar.
  return Math.ceil(creditos * MICROS_POR_MILHAO);
}
