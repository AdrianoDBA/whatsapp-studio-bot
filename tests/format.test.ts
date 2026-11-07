import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatPricePerMTok,
  formatRelativeTime,
  formatShortDay,
  formatTokens,
  formatUsdFromMicros,
} from "@/lib/format";

/**
 * `lib/format.ts` é o dono único de dinheiro, tempo e data na tela. Ele é
 * pequeno, mas duas coisas aqui são de SEGURANÇA DE INFORMAÇÃO, não de estilo:
 *
 *   1. custo desconhecido NUNCA pode aparecer como "US$ 0,00" — o aluno leria
 *      "essa execução foi de graça" quando a verdade é "não sei quanto foi";
 *   2. data e hora precisam sair IGUAIS no servidor e no navegador, senão o
 *      React reclama de diferença e a data pode até pular um dia.
 */

describe("formatUsdFromMicros", () => {
  it("mostra 4 casas pra valor menor que um dólar", () => {
    expect(formatUsdFromMicros(4_200)).toBe("US$ 0,0042");
    expect(formatUsdFromMicros(12)).toBe("US$ 0,0000");
  });

  it("mostra 2 casas de um dólar pra cima", () => {
    expect(formatUsdFromMicros(1_500_000)).toBe("US$ 1,50");
    expect(formatUsdFromMicros(12_345_678)).toBe("US$ 12,35");
  });

  it('ZERO é "custou zero mesmo", e aparece como valor', () => {
    expect(formatUsdFromMicros(0)).toBe("US$ 0,0000");
  });

  it('NULO é "preço desconhecido" — e nunca um valor em dinheiro', () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const texto = formatUsdFromMicros(v);
      expect(texto).toBe("preço desconhecido");
      expect(texto).not.toContain("US$");
    }
  });

  it("usa vírgula decimal (PT-BR), nunca ponto", () => {
    expect(formatUsdFromMicros(4_200)).not.toContain(".");
    expect(formatUsdFromMicros(4_200)).toContain(",");
  });
});

describe("formatPricePerMTok", () => {
  it("escreve o preço por 1 milhão de tokens", () => {
    expect(formatPricePerMTok(3_000_000)).toBe("US$ 3,00 / 1M tokens");
    expect(formatPricePerMTok(200_000)).toBe("US$ 0,200 / 1M tokens");
  });

  it("não explode com número inválido", () => {
    expect(formatPricePerMTok(Number.NaN)).toBe("preço desconhecido");
  });
});

describe("formatDuration", () => {
  it("abaixo de 1 segundo mostra milissegundos", () => {
    expect(formatDuration(340)).toBe("340 ms");
    expect(formatDuration(0)).toBe("0 ms");
  });

  it("entre 1 e 60 segundos mostra segundos com 1 casa", () => {
    expect(formatDuration(1234)).toBe("1,2 s");
    expect(formatDuration(59_400)).toBe("59,4 s");
  });

  it("acima de 1 minuto separa minuto e segundo", () => {
    expect(formatDuration(65_000)).toBe("1 min 5 s");
    expect(formatDuration(120_000)).toBe("2 min");
  });

  it("nunca escreve '60 s' no resto (arredonda pro minuto seguinte)", () => {
    // 119,7 s arredondaria pra "1 min 60 s" sem o cuidado do arredondamento.
    expect(formatDuration(119_700)).toBe("2 min");
  });

  it("sem duração mostra travessão", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("formatDate / formatDateTime", () => {
  it("data pura do catálogo NÃO pula um dia por causa do fuso", () => {
    // Esse é o bug clássico: "2026-08-20" vira meia-noite UTC, e São Paulo
    // (UTC-3) jogaria pro dia 19.
    expect(formatDate("2026-08-20")).toBe("20/08/2026");
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });

  it("data e hora saem no fuso de São Paulo, não no do computador", () => {
    // 20/08/2026 17:32 UTC = 14:32 em São Paulo.
    expect(formatDateTime("2026-08-20T17:32:00.000Z")).toBe("20/08/2026 14:32");
  });

  it("o resultado NÃO depende do fuso de quem roda", () => {
    // O mesmo instante escrito com dois deslocamentos diferentes tem que sair
    // com o mesmo texto — é o que garante servidor e navegador iguais.
    const a = formatDateTime("2026-08-20T17:32:00.000Z");
    const b = formatDateTime("2026-08-20T14:32:00.000-03:00");
    expect(a).toBe(b);
  });

  it("data estragada vira travessão em vez de 'Invalid Date'", () => {
    expect(formatDate("nada disso")).toBe("—");
    expect(formatDateTime("nada disso")).toBe("—");
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("formatTokens", () => {
  it("agrupa milhar com ponto (PT-BR)", () => {
    expect(formatTokens(1234)).toBe("1.234");
    expect(formatTokens(1_048_576)).toBe("1.048.576");
    expect(formatTokens(0)).toBe("0");
  });

  it("sem contagem mostra travessão", () => {
    expect(formatTokens(null)).toBe("—");
    expect(formatTokens(undefined)).toBe("—");
  });
});

/**
 * `formatRelativeTime` é o texto do Início ("há 4 min", "roda em 3 h").
 *
 * ⚠️ TODO CASO AQUI PASSA O "AGORA" NA MÃO. Um teste que chamasse
 * `formatRelativeTime(iso)` sem o segundo argumento leria o relógio da máquina
 * e passaria a falhar sozinho com o tempo — que é exatamente o defeito que a
 * função precisa evitar na tela.
 */
const AGORA = new Date("2026-08-21T17:00:00.000Z");

/** `AGORA` deslocado. Positivo = futuro. */
function em(ms: number): string {
  return new Date(AGORA.getTime() + ms).toISOString();
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

describe("formatRelativeTime", () => {
  it("segundos viram 'agora mesmo' / 'em instantes'", () => {
    expect(formatRelativeTime(em(-5_000), AGORA)).toBe("agora mesmo");
    expect(formatRelativeTime(em(5_000), AGORA)).toBe("em instantes");
    expect(formatRelativeTime(em(0), AGORA)).toBe("agora mesmo");
  });

  it("minutos e horas, nas duas direções", () => {
    expect(formatRelativeTime(em(-4 * MINUTO), AGORA)).toBe("há 4 min");
    expect(formatRelativeTime(em(3 * HORA), AGORA)).toBe("em 3 h");
    expect(formatRelativeTime(em(-2 * HORA), AGORA)).toBe("há 2 h");
    expect(formatRelativeTime(em(12 * MINUTO), AGORA)).toBe("em 12 min");
  });

  it("um dia tem nome próprio", () => {
    // "há 1 dias" é o erro clássico de plural montado por concatenação.
    expect(formatRelativeTime(em(-26 * HORA), AGORA)).toBe("ontem");
    expect(formatRelativeTime(em(26 * HORA), AGORA)).toBe("amanhã");
    expect(formatRelativeTime(em(-3 * DIA), AGORA)).toBe("há 3 dias");
    expect(formatRelativeTime(em(4 * DIA), AGORA)).toBe("em 4 dias");
  });

  it("acima de uma semana vira data — 'há 43 dias' não diz nada", () => {
    expect(formatRelativeTime(em(-30 * DIA), AGORA)).toBe("22/07/2026");
    expect(formatRelativeTime(em(60 * DIA), AGORA)).toBe("20/10/2026");
  });

  it("sem data, travessão — e nunca 'Invalid Date'", () => {
    expect(formatRelativeTime(null, AGORA)).toBe("—");
    expect(formatRelativeTime(undefined, AGORA)).toBe("—");
    expect(formatRelativeTime("nem parece data", AGORA)).toBe("—");
  });

  it("nenhuma saída tem número grudado na unidade errada", () => {
    // Varre a faixa inteira: o texto nunca pode sair vazio nem com "NaN".
    for (const ms of [-400 * DIA, -DIA, -HORA, -MINUTO, 0, MINUTO, HORA, DIA, 400 * DIA]) {
      const saida = formatRelativeTime(em(ms), AGORA);
      expect(saida.length).toBeGreaterThan(0);
      expect(saida).not.toContain("NaN");
      expect(saida).not.toContain("undefined");
    }
  });
});

describe("formatShortDay", () => {
  it("escreve o dia que está no texto, sem passar por Date", () => {
    // O caso que morde: "2026-08-21" lido como Date vira 20/08 no fuso de São
    // Paulo, e o gráfico inteiro apareceria deslocado um dia pra trás.
    expect(formatShortDay("2026-08-21")).toBe("21 de ago.");
    expect(formatShortDay("2026-01-01")).toBe("1 de jan.");
    expect(formatShortDay("2026-12-31")).toBe("31 de dez.");
  });

  it("os doze meses existem", () => {
    const meses = Array.from({ length: 12 }, (_, i) =>
      formatShortDay(`2026-${String(i + 1).padStart(2, "0")}-15`),
    );
    expect(new Set(meses).size).toBe(12);
    for (const m of meses) expect(m).toMatch(/^15 de [a-zç]{3}\.$/);
  });

  it("entrada estranha volta como veio, sem quebrar a tela", () => {
    expect(formatShortDay(null)).toBe("—");
    expect(formatShortDay("")).toBe("—");
    expect(formatShortDay("2026-99-01")).toBe("2026-99-01");
  });
});
