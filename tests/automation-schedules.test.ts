/**
 * A CONTA DA PRÓXIMA RODADA e a frase em português do agendamento.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE ESTE ARQUIVO EXISTE                                             │
 * │                                                                          │
 * │ "Toda segunda às 9h" parece trivial até você escrever. As armadilhas    │
 * │ reais, todas cobertas aqui:                                             │
 * │                                                                          │
 * │  • o servidor roda em UTC, e às 23h em São Paulo já é o DIA SEGUINTE    │
 * │    em UTC. Quem contar o dia pelo relógio do servidor agenda pro dia    │
 * │    errado — e ninguém percebe, porque só erra depois das 21h;           │
 * │  • "toda segunda" pedido num sábado tem que pular o domingo;            │
 * │  • o horário de HOJE que já passou tem que virar amanhã, e o de hoje    │
 * │    que ainda não chegou tem que ficar hoje;                             │
 * │  • agendamento marcado pro instante EXATO de agora vai pra próxima      │
 * │    ocorrência (senão ele dispararia na hora em que foi criado).         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ QUEM MANDA NA PRÓXIMA RODADA É O BANCO (`public.next_schedule_run`).
 * O que está sendo testado aqui é o ESPELHO em TypeScript, que a tela usa pra
 * mostrar "vai rodar pela primeira vez em ...". As regras são as mesmas, e é
 * este arquivo que trava as duas versões no mesmo comportamento. Ver o aviso
 * no topo de `lib/automation/schedules.ts`.
 */
import { describe, expect, test } from "vitest";
import {
  DIAS_DA_SEMANA,
  descreverAgendamento,
  type FormaDoAgendamento,
  FUSO_PADRAO,
  FUSOS,
  FUSOS_SUPORTADOS,
  fusoEhSuportado,
  proximaRodada,
} from "@/lib/automation/schedules";

const SP = "America/Sao_Paulo";

/** Monta uma forma completa preenchendo o que não interessa com `null`. */
function forma(parcial: Partial<FormaDoAgendamento>): FormaDoAgendamento {
  return {
    kind: "daily",
    hour: null,
    minute: null,
    weekdays: null,
    day_of_month: null,
    every_minutes: null,
    timezone: SP,
    ...parcial,
  };
}

/** O instante, escrito do jeito que a gente pensa nele. */
function quando(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`data de teste inválida: ${iso}`);
  return d;
}

/** "2026-08-21 08:00" no fuso pedido — pra comparar sem decorar UTC. */
function relogioEm(data: Date, timezone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);
}

// ---------------------------------------------------------------------------
// Todo dia
// ---------------------------------------------------------------------------

describe("todo dia, no fuso de São Paulo", () => {
  const todoDiaAs8 = forma({ kind: "daily", hour: 8, minute: 0, timezone: SP });

  test("antes da hora, roda HOJE mesmo", () => {
    const alvo = proximaRodada(todoDiaAs8, quando("2026-08-21T07:00:00-03:00"));
    expect(alvo).not.toBeNull();
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-21 08:00");
  });

  test("depois da hora, vira AMANHÃ (a virada do dia)", () => {
    const alvo = proximaRodada(todoDiaAs8, quando("2026-08-21T08:00:01-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-22 08:00");
  });

  test("no instante EXATO da hora marcada, vai pra próxima — nunca pra agora", () => {
    // Sem isso, um agendamento salvo às 8h em ponto dispararia na hora em que
    // foi criado. É sempre "estritamente depois".
    const alvo = proximaRodada(todoDiaAs8, quando("2026-08-21T08:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-22 08:00");
  });

  test("⚠️ o dia é contado pelo relógio de SÃO PAULO, não pelo do servidor", () => {
    // 2026-08-21T01:00Z já é dia 21 em UTC, mas em São Paulo ainda são 22h do
    // dia 20. Quem contasse o dia pelo servidor (que roda em UTC) marcaria a
    // rodada pro dia 22 — pulando um dia inteiro, e só depois das 21h.
    const agora = quando("2026-08-21T01:00:00Z");
    expect(relogioEm(agora, "UTC")).toBe("2026-08-21 01:00");
    expect(relogioEm(agora, SP)).toBe("2026-08-20 22:00");

    const alvo = proximaRodada(todoDiaAs8, agora);
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-21 08:00");
  });

  test("às 23:30, o de hoje ainda vale; às 23:45, já é amanhã", () => {
    const tardeDaNoite = forma({ kind: "daily", hour: 23, minute: 30, timezone: SP });

    expect(
      relogioEm(proximaRodada(tardeDaNoite, quando("2026-08-21T23:00:00-03:00")) as Date, SP),
    ).toBe("2026-08-21 23:30");
    expect(
      relogioEm(proximaRodada(tardeDaNoite, quando("2026-08-21T23:45:00-03:00")) as Date, SP),
    ).toBe("2026-08-22 23:30");
  });

  test("meia-noite em ponto não vira 24h nem pula um dia", () => {
    const meiaNoite = forma({ kind: "daily", hour: 0, minute: 0, timezone: SP });
    const alvo = proximaRodada(meiaNoite, quando("2026-08-21T23:59:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-22 00:00");
  });

  test("sem hora marcada, não roda nunca (e não estoura)", () => {
    expect(proximaRodada(forma({ kind: "daily", hour: null, minute: 0 }))).toBeNull();
    expect(proximaRodada(forma({ kind: "daily", hour: 8, minute: null }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Toda semana (o fim de semana é o caso que mais dá errado)
// ---------------------------------------------------------------------------

describe("toda semana, no fuso de São Paulo", () => {
  // 0 = domingo, 6 = sábado — o MESMO eixo do `extract(dow)` do Postgres.
  const segQuaSex = forma({
    kind: "weekly",
    hour: 9,
    minute: 0,
    weekdays: [1, 3, 5],
    timezone: SP,
  });

  test("pedido numa SEXTA de manhã, roda na sexta mesmo", () => {
    // 2026-08-21 é sexta.
    const alvo = proximaRodada(segQuaSex, quando("2026-08-21T08:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-21 09:00");
  });

  test("pedido numa SEXTA depois da hora, pula o fim de semana e cai na SEGUNDA", () => {
    const alvo = proximaRodada(segQuaSex, quando("2026-08-21T10:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-24 09:00");
  });

  test("pedido num SÁBADO, pula o domingo e cai na SEGUNDA", () => {
    // 2026-08-22 é sábado, 23 é domingo, 24 é segunda.
    const alvo = proximaRodada(segQuaSex, quando("2026-08-22T12:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-24 09:00");
  });

  test("pedido num DOMINGO, cai na segunda de manhã", () => {
    const alvo = proximaRodada(segQuaSex, quando("2026-08-23T21:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-24 09:00");
  });

  test("só no fim de semana: pedido numa quarta, cai no SÁBADO", () => {
    const soFimDeSemana = forma({
      kind: "weekly",
      hour: 10,
      minute: 30,
      weekdays: [0, 6],
      timezone: SP,
    });
    // 2026-08-19 é quarta; o próximo sábado é 22.
    const alvo = proximaRodada(soFimDeSemana, quando("2026-08-19T15:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-22 10:30");
  });

  test("só num dia da semana, e ele é HOJE mas já passou: cai daqui a sete dias", () => {
    const soSexta = forma({ kind: "weekly", hour: 9, minute: 0, weekdays: [5], timezone: SP });
    const alvo = proximaRodada(soSexta, quando("2026-08-21T09:30:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-28 09:00");
  });

  test("com os sete dias marcados, se comporta igual a “todo dia”", () => {
    const todosOsDias = forma({
      kind: "weekly",
      hour: 8,
      minute: 0,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      timezone: SP,
    });
    const alvo = proximaRodada(todosOsDias, quando("2026-08-21T09:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-22 08:00");
  });

  test("⚠️ o eixo é o do Postgres: 0 é DOMINGO, não segunda", () => {
    const soDomingo = forma({ kind: "weekly", hour: 7, minute: 0, weekdays: [0], timezone: SP });
    const alvo = proximaRodada(soDomingo, quando("2026-08-21T12:00:00-03:00"));
    // 2026-08-23 é domingo. Se 0 fosse segunda, cairia no dia 24.
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-23 07:00");
    expect(DIAS_DA_SEMANA[0]?.nome).toBe("domingo");
    expect(DIAS_DA_SEMANA[6]?.nome).toBe("sábado");
  });

  test("sem nenhum dia marcado, não roda nunca", () => {
    expect(proximaRodada(forma({ kind: "weekly", hour: 9, minute: 0, weekdays: [] }))).toBeNull();
    expect(proximaRodada(forma({ kind: "weekly", hour: 9, minute: 0, weekdays: null }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Todo mês
// ---------------------------------------------------------------------------

describe("todo mês", () => {
  const dia5 = forma({ kind: "monthly", hour: 6, minute: 0, day_of_month: 5, timezone: SP });

  test("antes do dia, roda neste mês", () => {
    const alvo = proximaRodada(dia5, quando("2026-08-01T10:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-08-05 06:00");
  });

  test("depois do dia, vira o mês que vem", () => {
    const alvo = proximaRodada(dia5, quando("2026-08-21T10:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-09-05 06:00");
  });

  test("a virada do ano funciona", () => {
    const alvo = proximaRodada(dia5, quando("2026-12-20T10:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2027-01-05 06:00");
  });

  test("o dia 28 existe até em fevereiro (é por isso que o teto é 28)", () => {
    const dia28 = forma({ kind: "monthly", hour: 9, minute: 0, day_of_month: 28, timezone: SP });
    const alvo = proximaRodada(dia28, quando("2026-02-01T10:00:00-03:00"));
    expect(relogioEm(alvo as Date, SP)).toBe("2026-02-28 09:00");
  });

  test("dia fora de 1..28 não roda nunca", () => {
    expect(proximaRodada(forma({ ...dia5, day_of_month: 31 }))).toBeNull();
    expect(proximaRodada(forma({ ...dia5, day_of_month: 0 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// De tempos em tempos
// ---------------------------------------------------------------------------

describe("a cada N minutos", () => {
  test("soma no relógio absoluto, sem passar por fuso nenhum", () => {
    const cada15 = forma({ kind: "interval", every_minutes: 15, timezone: SP });
    const alvo = proximaRodada(cada15, quando("2026-08-21T08:07:00-03:00"));
    expect((alvo as Date).toISOString()).toBe("2026-08-21T11:22:00.000Z");
  });

  test("um dia inteiro também vale", () => {
    const cadaDia = forma({ kind: "interval", every_minutes: 1440, timezone: SP });
    const alvo = proximaRodada(cadaDia, quando("2026-08-21T00:00:00Z"));
    expect((alvo as Date).toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });

  test("sem intervalo, não roda nunca", () => {
    expect(proximaRodada(forma({ kind: "interval", every_minutes: null }))).toBeNull();
    expect(proximaRodada(forma({ kind: "interval", every_minutes: 0 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fusos horários
// ---------------------------------------------------------------------------

describe("fusos horários", () => {
  test("todo fuso da lista existe de verdade", () => {
    for (const fuso of FUSOS_SUPORTADOS) {
      expect(() =>
        new Intl.DateTimeFormat("en-US", { timeZone: fuso }).format(new Date()),
      ).not.toThrow();
    }
  });

  test("São Paulo é o padrão, e está na lista", () => {
    expect(FUSO_PADRAO).toBe(SP);
    expect(fusoEhSuportado(SP)).toBe(true);
    expect(FUSOS.map((f) => f.id)).toContain(SP);
  });

  test("fuso que não existe é recusado, e não estoura", () => {
    expect(fusoEhSuportado("Marte/Olympus")).toBe(false);
    const alvo = proximaRodada(
      forma({ kind: "daily", hour: 8, minute: 0, timezone: "Marte/Olympus" }),
      quando("2026-08-21T07:00:00-03:00"),
    );
    expect(alvo).toBeNull();
  });

  test("o MESMO agendamento em fusos diferentes dá instantes diferentes", () => {
    const base = quando("2026-08-21T00:00:00Z");
    const emSaoPaulo = proximaRodada(
      forma({ kind: "daily", hour: 8, minute: 0, timezone: SP }),
      base,
    );
    const emUtc = proximaRodada(
      forma({ kind: "daily", hour: 8, minute: 0, timezone: "UTC" }),
      base,
    );

    expect(relogioEm(emSaoPaulo as Date, SP)).toBe("2026-08-21 08:00");
    expect(relogioEm(emUtc as Date, "UTC")).toBe("2026-08-21 08:00");
    // São Paulo está 3 horas atrás do UTC: as 8h de lá acontecem DEPOIS.
    expect((emSaoPaulo as Date).getTime() - (emUtc as Date).getTime()).toBe(3 * 60 * 60 * 1000);
  });

  test("o Brasil não tem horário de verão: o deslocamento é o mesmo em janeiro e em julho", () => {
    const verao = proximaRodada(
      forma({ kind: "daily", hour: 12, minute: 0, timezone: SP }),
      quando("2026-01-10T00:00:00Z"),
    );
    const inverno = proximaRodada(
      forma({ kind: "daily", hour: 12, minute: 0, timezone: SP }),
      quando("2026-07-10T00:00:00Z"),
    );
    expect((verao as Date).toISOString().slice(11, 16)).toBe("15:00");
    expect((inverno as Date).toISOString().slice(11, 16)).toBe("15:00");
  });

  test("onde EXISTE horário de verão, a conta acompanha a virada", () => {
    // Nova York vira pra frente em 2026-03-08. Antes da virada 09:00 local é
    // 14:00 UTC; depois, 13:00 UTC. É o Intl (e, no banco, o Postgres) que
    // sabe disso — a gente nunca soma "3 horas" na mão.
    const ny = "America/New_York";
    const antes = proximaRodada(
      forma({ kind: "daily", hour: 9, minute: 0, timezone: ny }),
      quando("2026-03-06T20:00:00Z"),
    );
    const depois = proximaRodada(
      forma({ kind: "daily", hour: 9, minute: 0, timezone: ny }),
      quando("2026-03-09T02:00:00Z"),
    );

    expect((antes as Date).toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect((depois as Date).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(relogioEm(antes as Date, ny)).toBe("2026-03-07 09:00");
    expect(relogioEm(depois as Date, ny)).toBe("2026-03-09 09:00");
  });
});

// ---------------------------------------------------------------------------
// A frase em português
// ---------------------------------------------------------------------------

describe("descreverAgendamento", () => {
  test("todo dia", () => {
    expect(descreverAgendamento(forma({ kind: "daily", hour: 8, minute: 0 }))).toBe(
      "todo dia às 08:00 (horário de Brasília)",
    );
  });

  test("dois dias da semana", () => {
    expect(
      descreverAgendamento(forma({ kind: "weekly", hour: 9, minute: 30, weekdays: [1, 3] })),
    ).toBe("toda segunda-feira e quarta-feira às 09:30 (horário de Brasília)");
  });

  test("segunda a sexta ganha frase própria", () => {
    expect(
      descreverAgendamento(
        forma({ kind: "weekly", hour: 8, minute: 0, weekdays: [1, 2, 3, 4, 5] }),
      ),
    ).toBe("de segunda a sexta às 08:00 (horário de Brasília)");
  });

  test("fim de semana ganha frase própria", () => {
    expect(
      descreverAgendamento(forma({ kind: "weekly", hour: 10, minute: 0, weekdays: [0, 6] })),
    ).toBe("sábado e domingo às 10:00 (horário de Brasília)");
  });

  test("os sete dias viram “todo dia”", () => {
    expect(
      descreverAgendamento(
        forma({ kind: "weekly", hour: 7, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }),
      ),
    ).toBe("todo dia às 07:00 (horário de Brasília)");
  });

  test("todo mês", () => {
    expect(
      descreverAgendamento(forma({ kind: "monthly", hour: 6, minute: 5, day_of_month: 10 })),
    ).toBe("todo dia 10 do mês às 06:05 (horário de Brasília)");
  });

  test("intervalo não fala de fuso (não faz sentido)", () => {
    expect(descreverAgendamento(forma({ kind: "interval", every_minutes: 15 }))).toBe(
      "a cada 15 minutos",
    );
    expect(descreverAgendamento(forma({ kind: "interval", every_minutes: 60 }))).toBe(
      "a cada 1 hora",
    );
    expect(descreverAgendamento(forma({ kind: "interval", every_minutes: 90 }))).toBe(
      "a cada 1 hora e 30 minutos",
    );
    expect(descreverAgendamento(forma({ kind: "interval", every_minutes: 1440 }))).toBe(
      "a cada 24 horas",
    );
  });

  test("fuso diferente aparece na frase", () => {
    const frase = descreverAgendamento(
      forma({ kind: "daily", hour: 8, minute: 0, timezone: "America/Manaus" }),
    );
    expect(frase).toContain("08:00");
    expect(frase).toContain("Manaus");
  });

  test("dado incompleto vira uma frase honesta, nunca uma exceção", () => {
    expect(descreverAgendamento(forma({ kind: "weekly", hour: 8, minute: 0, weekdays: [] }))).toBe(
      "agendamento incompleto",
    );
    expect(descreverAgendamento(forma({ kind: "daily", hour: null, minute: null }))).toBe(
      "agendamento incompleto",
    );
    expect(descreverAgendamento(forma({ kind: "coisa-nova", hour: 8, minute: 0 }))).toBe(
      "agendamento incompleto",
    );
  });
});
