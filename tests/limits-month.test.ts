/**
 * A VIRADA DO MÊS (E DO DIA), NO FUSO DE BRASÍLIA.
 *
 * O defeito que este arquivo existe pra impedir: no dia 31/08 às 22h de
 * Brasília já é 01/09 em UTC. Com a conta feita em UTC, o medidor zeraria
 * enquanto a tela ainda escreve "31 de agosto" — três horas antes do que o app
 * promete, todo mês. O banco resolve isso com `at time zone
 * 'America/Sao_Paulo'`; aqui o espelho em TypeScript precisa concordar com ele.
 *
 * ⚠️ Todo `new Date("...Z")` abaixo é um instante em UTC, e o que o teste
 * pergunta é "que dia era esse em São Paulo?".
 */
import { describe, expect, it } from "vitest";
import {
  diaISOAtras,
  hojeEmSaoPaulo,
  inicioDoMes,
  inicioDoMesISO,
  mesDoDia,
  proximaViradaDoDia,
  proximaViradaDoMes,
  rotuloDaProximaVirada,
  rotuloDoMes,
  segundosAteAViradaDoDia,
  segundosAteAViradaDoMes,
} from "@/lib/limits/month";

/** 21/08/2026, 14h de Brasília (17h UTC). Um instante bem no meio do mês. */
const MEIO_DE_AGOSTO = new Date("2026-08-21T17:00:00.000Z");

/** 31/08/2026, 22h de Brasília — que em UTC já é 01/09. É o caso que morde. */
const ULTIMA_NOITE_DE_AGOSTO = new Date("2026-09-01T01:00:00.000Z");

describe("que dia é hoje, em São Paulo", () => {
  it("no meio do mês, o óbvio", () => {
    expect(hojeEmSaoPaulo(MEIO_DE_AGOSTO)).toBe("2026-08-21");
    expect(inicioDoMesISO(MEIO_DE_AGOSTO)).toBe("2026-08-01");
  });

  it("31/08 às 22h de Brasília ainda é AGOSTO, mesmo já sendo 01/09 em UTC", () => {
    expect(ULTIMA_NOITE_DE_AGOSTO.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(hojeEmSaoPaulo(ULTIMA_NOITE_DE_AGOSTO)).toBe("2026-08-31");
    expect(inicioDoMesISO(ULTIMA_NOITE_DE_AGOSTO)).toBe("2026-08-01");
  });

  it("01/09 às 00h05 de Brasília já é setembro", () => {
    const logoDepois = new Date("2026-09-01T03:05:00.000Z");
    expect(hojeEmSaoPaulo(logoDepois)).toBe("2026-09-01");
    expect(inicioDoMesISO(logoDepois)).toBe("2026-09-01");
  });
});

describe("o começo e o fim do mês", () => {
  it("o mês começa à meia-noite de Brasília do dia 1º (03h UTC)", () => {
    expect(inicioDoMes(MEIO_DE_AGOSTO).toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it("a virada é a meia-noite de Brasília do dia 1º do mês seguinte", () => {
    expect(proximaViradaDoMes(MEIO_DE_AGOSTO).toISOString()).toBe("2026-09-01T03:00:00.000Z");
    // E às 22h do dia 31 a virada ainda está por vir — faltam 2 horas.
    expect(proximaViradaDoMes(ULTIMA_NOITE_DE_AGOSTO).toISOString()).toBe(
      "2026-09-01T03:00:00.000Z",
    );
  });

  it("dezembro vira pra janeiro do ano seguinte", () => {
    const natal = new Date("2026-12-25T15:00:00.000Z");
    expect(proximaViradaDoMes(natal).toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(rotuloDaProximaVirada(natal)).toBe("1º de janeiro");
  });

  it("a virada do DIA é a meia-noite de Brasília do dia seguinte", () => {
    expect(proximaViradaDoDia(MEIO_DE_AGOSTO).toISOString()).toBe("2026-08-22T03:00:00.000Z");
    expect(proximaViradaDoDia(ULTIMA_NOITE_DE_AGOSTO).toISOString()).toBe(
      "2026-09-01T03:00:00.000Z",
    );
  });
});

describe("os segundos do Retry-After", () => {
  it("às 22h do dia 31 faltam 2 horas pro mês virar", () => {
    expect(segundosAteAViradaDoMes(ULTIMA_NOITE_DE_AGOSTO)).toBe(2 * 60 * 60);
  });

  it("às 14h do dia 21 faltam 10 dias e 10 horas", () => {
    expect(segundosAteAViradaDoMes(MEIO_DE_AGOSTO)).toBe((10 * 24 + 10) * 60 * 60);
  });

  it("a virada do dia é sempre mais perto que a do mês (fora do último dia)", () => {
    expect(segundosAteAViradaDoDia(MEIO_DE_AGOSTO)).toBe(10 * 60 * 60);
    expect(segundosAteAViradaDoDia(MEIO_DE_AGOSTO)).toBeLessThan(
      segundosAteAViradaDoMes(MEIO_DE_AGOSTO),
    );
  });

  it("nunca devolve 0 — isso mandaria o sistema de fora tentar de novo na hora", () => {
    // Um milissegundo antes da virada.
    const quaseLa = new Date("2026-09-01T02:59:59.999Z");
    expect(segundosAteAViradaDoMes(quaseLa)).toBeGreaterThanOrEqual(1);
    expect(segundosAteAViradaDoDia(quaseLa)).toBeGreaterThanOrEqual(1);
  });
});

describe("os rótulos que a frase usa", () => {
  it('a virada vira "1º de setembro"', () => {
    expect(rotuloDaProximaVirada(MEIO_DE_AGOSTO)).toBe("1º de setembro");
    expect(rotuloDaProximaVirada(ULTIMA_NOITE_DE_AGOSTO)).toBe("1º de setembro");
  });

  it('o mês do histórico vira "agosto de 2026"', () => {
    expect(rotuloDoMes("2026-08-01")).toBe("agosto de 2026");
    expect(rotuloDoMes("2026-03-01")).toBe("março de 2026");
  });

  it("data que não faz sentido volta como veio, sem derrubar a tela", () => {
    expect(rotuloDoMes("banana")).toBe("banana");
  });
});

describe("a âncora de histórico", () => {
  it("anda pra trás no calendário, inclusive virando o ano", () => {
    expect(inicioDoMesISO(MEIO_DE_AGOSTO, 0)).toBe("2026-08-01");
    expect(inicioDoMesISO(MEIO_DE_AGOSTO, 1)).toBe("2026-07-01");
    expect(inicioDoMesISO(MEIO_DE_AGOSTO, 5)).toBe("2026-03-01");
    expect(inicioDoMesISO(MEIO_DE_AGOSTO, 8)).toBe("2025-12-01");
  });

  it("o dia gravado no medidor sabe dizer de que mês ele é", () => {
    expect(mesDoDia("2026-08-31")).toBe("2026-08-01");
    expect(mesDoDia("2026-01-01")).toBe("2026-01-01");
  });
});

describe("diaISOAtras", () => {
  it("anda pra trás no calendário, virando mês e ano", () => {
    expect(diaISOAtras(MEIO_DE_AGOSTO, 0)).toBe("2026-08-21");
    expect(diaISOAtras(MEIO_DE_AGOSTO, 1)).toBe("2026-08-20");
    expect(diaISOAtras(MEIO_DE_AGOSTO, 29)).toBe("2026-07-23");
    expect(diaISOAtras(MEIO_DE_AGOSTO, 233)).toBe("2025-12-31");
  });

  it("às 22h de Brasília ainda é HOJE, não amanhã", () => {
    // Este é o caso que morde: 31/08 às 22h em São Paulo já é 01/09 em UTC.
    // Andar em UTC deslocaria o gráfico inteiro um dia pra frente.
    expect(diaISOAtras(ULTIMA_NOITE_DE_AGOSTO, 0)).toBe("2026-08-31");
    expect(diaISOAtras(ULTIMA_NOITE_DE_AGOSTO, 1)).toBe("2026-08-30");
  });

  it("combina com hojeEmSaoPaulo — os dois leem o mesmo relógio", () => {
    expect(diaISOAtras(MEIO_DE_AGOSTO, 0)).toBe(hojeEmSaoPaulo(MEIO_DE_AGOSTO));
    expect(diaISOAtras(ULTIMA_NOITE_DE_AGOSTO, 0)).toBe(hojeEmSaoPaulo(ULTIMA_NOITE_DE_AGOSTO));
  });

  it("o eixo de 30 dias sai em ordem e sem buraco", () => {
    const dias: string[] = [];
    for (let i = 29; i >= 0; i--) dias.push(diaISOAtras(MEIO_DE_AGOSTO, i));

    expect(dias).toHaveLength(30);
    expect(dias[0]).toBe("2026-07-23");
    expect(dias[29]).toBe("2026-08-21");
    expect(new Set(dias).size).toBe(30);
    // Ordenação alfabética de "AAAA-MM-DD" é ordenação cronológica.
    expect([...dias].sort()).toEqual(dias);
  });
});
