/**
 * A ARITMÉTICA DO TETO — a parte que não pode ter ponto flutuante.
 *
 * Uma pergunta só: **o teto que a pessoa digitou é EXATAMENTE o teto que fica
 * gravado?** Se não for, o número na tela e o número que o banco compara são
 * dois números diferentes — e aí o teto mente, que é o pior defeito possível
 * numa peça que existe pra ser confiável.
 *
 * O caso que dá errado sozinho: `2.01 * 1_000_000` dá `2009999.9999999998` em
 * JavaScript. Gravado assim, o `bigint` do banco recusaria (ou truncaria), e a
 * conta passaria a ser feita em cima de um valor que ninguém digitou.
 */
import { describe, expect, it } from "vitest";
import {
  formatTetoUsd,
  MICROS_POR_DOLAR,
  microsToUsd,
  TETOS_SUGERIDOS_MICROS,
  usdToMicros,
} from "@/lib/limits/money";

describe("usdToMicros — inteiro, sempre", () => {
  it("os valores dos botões prontos da tela", () => {
    expect(usdToMicros(5)).toBe(5_000_000);
    expect(usdToMicros(20)).toBe(20_000_000);
    expect(usdToMicros(50)).toBe(50_000_000);
    expect(usdToMicros(200)).toBe(200_000_000);
  });

  it("centavo quebrado NÃO deixa sobra de ponto flutuante", () => {
    // A conta ingênua (`usd * 1_000_000`) erra de verdade nestes valores: US$
    // 2,01 vira 2009999.9999999998 e US$ 4,03 vira 4030000.0000000005. Um
    // `bigint` não aceita isso, e um teto arredondado por acidente compara
    // errado pra sempre. Estas duas linhas são a prova de que a nossa conta não
    // passa por ali.
    expect(Number.isInteger(2.01 * 1_000_000)).toBe(false);
    expect(Number.isInteger(4.03 * 1_000_000)).toBe(false);

    expect(usdToMicros(2.01)).toBe(2_010_000);
    expect(usdToMicros(4.03)).toBe(4_030_000);
    expect(usdToMicros(0.07)).toBe(70_000);
    expect(usdToMicros(0.29)).toBe(290_000);
    expect(usdToMicros(1.1)).toBe(1_100_000);
    expect(usdToMicros(1234.56)).toBe(1_234_560_000);
  });

  it("todo resultado é inteiro, pra qualquer centavo entre 0,01 e 100,00", () => {
    for (let centavos = 1; centavos <= 10_000; centavos++) {
      const micros = usdToMicros(centavos / 100);
      expect(Number.isInteger(micros)).toBe(true);
      expect(micros).toBe(centavos * 10_000);
    }
  });

  it("arredonda pro centavo mais próximo (a tela só fala em centavo)", () => {
    expect(usdToMicros(0.014)).toBe(10_000);
    expect(usdToMicros(0.015)).toBe(20_000);
    expect(usdToMicros(19.999)).toBe(20_000_000);
  });

  it("os limites do banco continuam inteiros", () => {
    // As restrições da tabela: US$ 1 a US$ 100.000 no mês, US$ 0,10 no dia,
    // US$ 0,01 por execução.
    expect(usdToMicros(1)).toBe(1_000_000);
    expect(usdToMicros(100_000)).toBe(100_000_000_000);
    expect(usdToMicros(0.1)).toBe(100_000);
    expect(usdToMicros(0.01)).toBe(10_000);
  });

  it("número que não é número estoura — nunca vira 0 nem null", () => {
    // Zero significaria "sem gastar nada" e nulo significaria "sem teto". Os
    // dois estariam silenciosamente errados, e ninguém descobriria.
    expect(() => usdToMicros(Number.NaN)).toThrow(RangeError);
    expect(() => usdToMicros(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("ida e volta", () => {
  it("dólar → micro → dólar devolve o mesmo número", () => {
    for (const usd of [0.01, 0.1, 0.07, 1, 5, 19.99, 20, 200, 1234.56]) {
      expect(microsToUsd(usdToMicros(usd))).toBeCloseTo(usd, 10);
    }
  });

  it("micro → dólar é uma divisão simples", () => {
    expect(microsToUsd(20_000_000)).toBe(20);
    expect(microsToUsd(4_200)).toBeCloseTo(0.0042, 10);
    expect(microsToUsd(0)).toBe(0);
  });
});

describe("os botões prontos", () => {
  it("são US$ 5 / 20 / 50 / 200, todos inteiros", () => {
    expect(TETOS_SUGERIDOS_MICROS).toEqual([5_000_000, 20_000_000, 50_000_000, 200_000_000]);
    for (const micros of TETOS_SUGERIDOS_MICROS) {
      expect(Number.isInteger(micros)).toBe(true);
      // Nenhum deles pode ser recusado pela restrição do banco (mínimo US$ 1).
      expect(micros).toBeGreaterThanOrEqual(MICROS_POR_DOLAR);
    }
  });
});

describe("formatTetoUsd — o teto na tela tem SEMPRE 2 casas", () => {
  it("escreve dinheiro do jeito que o aluno lê", () => {
    expect(formatTetoUsd(20_000_000)).toBe("US$ 20,00");
    expect(formatTetoUsd(3_470_000)).toBe("US$ 3,47");
    expect(formatTetoUsd(100_000)).toBe("US$ 0,10");
    expect(formatTetoUsd(0)).toBe("US$ 0,00");
  });

  it("valor de centésimo de centavo NÃO vira 4 casas aqui", () => {
    // As 4 casas ("US$ 0,0042") existem só na tela de Execuções, onde elas
    // fazem sentido. No teto, elas fariam a pessoa parar de enxergar a barra.
    expect(formatTetoUsd(4_200)).toBe("US$ 0,00");
  });

  it('"sem teto" é escrito, nunca US$ 0,00', () => {
    expect(formatTetoUsd(null)).toBe("sem teto");
    expect(formatTetoUsd(undefined)).toBe("sem teto");
  });
});
