/**
 * DINHEIRO, NOS DOIS SENTIDOS: o que a pessoa digita vira inteiro, e o teto
 * vira texto curto de tela.
 *
 * ⚠️ ESTE ARQUIVO NÃO VAI EM `lib/format.ts`, DE PROPÓSITO. Aquele arquivo faz
 * "número vira texto de tela" e continua sendo o dono de `formatUsdFromMicros`
 * (o custo de UMA execução, com 4 casas). Aqui é o caminho contrário — texto
 * de formulário vira inteiro — mais o formato CURTO que o teto usa.
 *
 * ⚠️ A CONTA PASSA POR CENTAVOS, NUNCA POR `usd * 1_000_000`.
 * Em ponto flutuante, `2.01 * 1_000_000` dá `2009999.9999999998` e
 * `4.03 * 1_000_000` dá `4030000.0000000005`. Um teto gravado com essa sobra
 * vira comparação errada no banco pra sempre. Multiplicar por 100, arredondar
 * (aí o erro morre) e só então multiplicar por 10.000 mantém tudo inteiro.
 *
 * Arquivo PURO: pode ser importado por componente com "use client" e por teste.
 */

/** US$ 1,00 = 1.000.000 micro-dólares. */
export const MICROS_POR_DOLAR = 1_000_000;

/** US$ 0,01 = 10.000 micro-dólares. É a menor unidade que a tela aceita. */
export const MICROS_POR_CENTAVO = 10_000;

/**
 * "20" → 20.000.000 · "0,07" → 70.000 · "1234,56" → 1.234.560.000
 *
 * Arredonda pro centavo mais próximo: o formulário fala em dólar e centavo, e
 * qualquer casa além disso viraria um teto que a tela não consegue mostrar de
 * volta igual ao que foi digitado.
 *
 * ⚠️ Quem chama valida com Zod ANTES (é a regra 5 do CLAUDE.md raiz). Um valor
 * que não é número finito estoura aqui de propósito: devolver 0 seria gravar
 * "sem gastar nada" e devolver `null` seria gravar "sem teto" — os dois
 * silenciosamente errados.
 */
export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd)) {
    throw new RangeError("usdToMicros: o valor precisa ser um número finito");
  }
  return Math.round(usd * 100) * MICROS_POR_CENTAVO;
}

/** 20.000.000 → 20 · 70.000 → 0,07. É o que o formulário mostra no campo. */
export function microsToUsd(micros: number): number {
  if (!Number.isFinite(micros)) {
    throw new RangeError("microsToUsd: o valor precisa ser um número finito");
  }
  return micros / MICROS_POR_DOLAR;
}

/**
 * Os botões prontos da tela: US$ 5 · US$ 20 · US$ 50 · US$ 200.
 *
 * Existem porque leigo escolhe, não calcula (§1 do contrato da onda 6). O campo
 * livre continua existindo, escondido atrás de "outro valor".
 */
export const TETOS_SUGERIDOS_MICROS: readonly number[] = [
  5 * MICROS_POR_DOLAR,
  20 * MICROS_POR_DOLAR,
  50 * MICROS_POR_DOLAR,
  200 * MICROS_POR_DOLAR,
];

/**
 * O teto e o gasto do mês, em texto CURTO: sempre 2 casas.
 *
 *   20_000_000 → "US$ 20,00"
 *   3_470_000  → "US$ 3,47"
 *   4_200      → "US$ 0,00"      ← e está certo: é a escala do MÊS
 *   null       → "sem teto"
 *
 * ⚠️ POR QUE NÃO `formatUsdFromMicros` AQUI. Aquele escreve 4 casas abaixo de
 * US$ 1 — o que é certo pra UMA execução ("US$ 0,0042") e errado pro teto: o
 * contrato decidiu que o gasto do mês nunca aparece com 4 casas, senão a pessoa
 * lê "US$ 16,4000 de US$ 20,0000" e não enxerga mais a barra. As 4 casas
 * continuam existindo só na tela de Execuções.
 */
export function formatTetoUsd(micros: number | null | undefined): string {
  if (micros === null || micros === undefined || !Number.isFinite(micros)) {
    return "sem teto";
  }
  return `US$ ${(micros / MICROS_POR_DOLAR).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
