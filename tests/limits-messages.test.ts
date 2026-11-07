/**
 * AS FRASES DO TETO DE GASTO, PALAVRA POR PALAVRA.
 *
 * Este é o teste que trava o texto. Ele existe porque a frase que a pessoa lê
 * quando o agente para é a diferença entre "entendi, vou aumentar o limite" e
 * "quebrou tudo, socorro" — e texto sem teste é texto que alguém reescreve
 * numa sexta-feira.
 *
 * As cinco regras que TODA frase segue (§11 do contrato da onda 6):
 *   1. diz por que parou;  2. diz que nada quebrou;  3. diz quando volta;
 *   4. dá o caminho do menu (ou manda pedir pra quem tem);
 *   5. nunca usa "erro", "falha", "bloqueado" nem "limite excedido".
 *
 * ⚠️ O relógio é congelado em 21/08/2026: as frases dizem "1º de setembro", e
 * sem congelar elas mudariam de mês em mês e o teste quebraria sozinho.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  audienciaDoPapel,
  budgetBanner,
  budgetBlockedMessage,
  budgetBlockedMessageFromStatus,
  ehRecusaDeTeto,
  gastoDoBloqueio,
  podeMudarOTeto,
  TEXTO_FREIOS_DO_SISTEMA,
  TEXTO_MEDIDOR_NAO_E_FATURA,
  TEXTO_POR_QUE_EM_DOLAR,
  tetoDoBloqueio,
  textoExecucoesSemPreco,
} from "@/lib/limits/messages";
import type { BudgetStatus } from "@/lib/limits/types";

/** 21/08/2026, 14h de Brasília. */
const AGORA = new Date("2026-08-21T17:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterAll(() => {
  vi.useRealTimers();
});

function status(patch: Partial<BudgetStatus> = {}): BudgetStatus {
  return {
    month: "2026-08-01",
    day: "2026-08-21",
    monthlyBudgetMicros: 20_000_000,
    dailyBudgetMicros: null,
    platformCapMicros: null,
    effectiveMonthlyMicros: 20_000_000,
    maxRunCostMicros: null,
    hardStop: true,
    alertAtPercent: 80,
    monthSpentMicros: 0,
    daySpentMicros: 0,
    monthAgentMicros: 0,
    monthEmbeddingMicros: 0,
    unpricedRuns: 0,
    unpricedDocuments: 0,
    percentUsed: 0,
    overBudget: false,
    blocked: false,
    blockedBy: null,
    ...patch,
  };
}

/** As palavras que nenhuma frase pode usar. */
const PROIBIDAS = ["erro", "falha", "bloquead", "limite excedido"];

function conferirVocabulario(frase: string) {
  const minusculo = frase.toLowerCase();
  for (const palavra of PROIBIDAS) {
    expect(minusculo, `a frase não pode dizer "${palavra}": ${frase}`).not.toContain(palavra);
  }
}

// ---------------------------------------------------------------------------
// Chat e botão "Rodar agora"
// ---------------------------------------------------------------------------

describe("frase A — teto do mês, pra quem administra", () => {
  const frase = budgetBlockedMessage({
    audience: "pessoa-admin",
    blockedBy: "mes",
    effectiveMicros: 20_000_000,
    spentMicros: 20_000_000,
    agora: AGORA,
  });

  it("é exatamente a frase do contrato", () => {
    expect(frase).toBe(
      "Os agentes deste workspace estão parados: vocês chegaram no teto de gasto com IA " +
        "deste mês (US$ 20,00 de US$ 20,00). Nada quebrou e nada foi perdido. O teto zera " +
        "sozinho em 1º de setembro — ou você pode aumentar agora em Configurações → " +
        "Limites de IA.",
    );
  });

  it("diz que nada quebrou, quando volta e onde mexer", () => {
    expect(frase).toContain("Nada quebrou");
    expect(frase).toContain("1º de setembro");
    expect(frase).toContain("Configurações → Limites de IA");
    conferirVocabulario(frase);
  });

  it("com o corte desligado, mostra o gasto DE VERDADE, não o teto duas vezes", () => {
    const passou = budgetBlockedMessage({
      audience: "pessoa-admin",
      blockedBy: "mes",
      effectiveMicros: 20_000_000,
      spentMicros: 23_100_000,
      agora: AGORA,
    });
    expect(passou).toContain("(US$ 23,10 de US$ 20,00)");
  });

  it("sem saber o gasto, mostra só o teto — nunca um número inventado", () => {
    const semGasto = budgetBlockedMessage({
      audience: "pessoa-admin",
      blockedBy: "mes",
      effectiveMicros: 20_000_000,
      agora: AGORA,
    });
    expect(semGasto).toContain("deste mês (US$ 20,00).");
    expect(semGasto).not.toContain("de US$ 20,00)");
  });
});

describe("frase B — teto do mês, pra quem não administra", () => {
  const frase = budgetBlockedMessage({
    audience: "pessoa-membro",
    blockedBy: "mes",
    effectiveMicros: 20_000_000,
    spentMicros: 20_000_000,
    agora: AGORA,
  });

  it("é exatamente a frase do contrato", () => {
    expect(frase).toBe(
      "Os agentes deste workspace estão parados: o time chegou no teto de gasto com IA " +
        "deste mês. Nada quebrou. O teto zera sozinho em 1º de setembro — se precisar " +
        "antes, peça pra quem administra o workspace aumentar o limite em Configurações → " +
        "Limites de IA.",
    );
  });

  it("manda PEDIR, e não mostra o número do teto", () => {
    expect(frase).toContain("peça pra quem administra");
    expect(frase).not.toContain("US$");
    conferirVocabulario(frase);
  });
});

describe("frase C — o freio do dia", () => {
  it("é exatamente a frase do contrato, pra quem administra", () => {
    expect(
      budgetBlockedMessage({
        audience: "pessoa-admin",
        blockedBy: "dia",
        effectiveMicros: 5_000_000,
        spentMicros: 5_000_000,
        agora: AGORA,
      }),
    ).toBe(
      "Os agentes deste workspace estão parados até amanhã: vocês chegaram no teto de gasto " +
        "com IA de hoje (US$ 5,00). Esse é o freio diário, pra um dia ruim não comer o mês " +
        "inteiro. Ele zera à meia-noite (horário de Brasília) — ou você pode mudar em " +
        "Configurações → Limites de IA.",
    );
  });

  it("fala de AMANHÃ, não da virada do mês", () => {
    const frase = budgetBlockedMessage({
      audience: "pessoa-membro",
      blockedBy: "dia",
      effectiveMicros: 5_000_000,
      agora: AGORA,
    });
    expect(frase).toContain("até amanhã");
    expect(frase).toContain("meia-noite (horário de Brasília)");
    expect(frase).not.toContain("1º de setembro");
    conferirVocabulario(frase);
  });
});

describe("frase D — o teto da plataforma", () => {
  const frase = budgetBlockedMessage({
    audience: "pessoa-admin",
    blockedBy: "plataforma",
    effectiveMicros: 50_000_000,
    spentMicros: 50_000_000,
    agora: AGORA,
  });

  it("é exatamente a frase do contrato", () => {
    expect(frase).toBe(
      "Os agentes deste workspace estão parados: foi atingido o limite de gasto com IA que " +
        "quem cuida do sistema definiu pra este workspace (US$ 50,00). Esse limite não muda " +
        "aqui dentro — fale com quem administra o sistema. Ele zera sozinho em 1º de setembro.",
    );
  });

  it("é a MESMA pra quem administra o workspace e pra quem não administra", () => {
    // Este teto não muda aqui dentro nem pra quem é dono — mandar ele abrir
    // Configurações seria mandar procurar um campo que não existe.
    const membro = budgetBlockedMessage({
      audience: "pessoa-membro",
      blockedBy: "plataforma",
      effectiveMicros: 50_000_000,
      spentMicros: 50_000_000,
      agora: AGORA,
    });
    expect(membro).toBe(frase);
    expect(frase).not.toContain("Configurações → Limites de IA");
    conferirVocabulario(frase);
  });
});

// ---------------------------------------------------------------------------
// Os gatilhos sem ninguém na frente da tela
// ---------------------------------------------------------------------------

describe("frase E — agendamento", () => {
  const frase = budgetBlockedMessage({
    audience: "agendamento",
    blockedBy: "mes",
    effectiveMicros: 20_000_000,
    agora: AGORA,
  });

  it("é exatamente a frase do contrato", () => {
    expect(frase).toBe(
      "A rodada de hoje foi pulada: o workspace chegou no teto de gasto com IA deste mês. A " +
        "automação continua ligada e volta sozinha na virada do mês. Pra ela voltar antes, " +
        "aumente o teto em Configurações → Limites de IA.",
    );
  });

  it("diz PULADA e diz que a automação CONTINUA LIGADA", () => {
    // As duas coisas juntas são o ponto: rodada pulada não é automação
    // desligada, e o aluno precisa saber que não tem nada pra religar.
    expect(frase).toContain("pulada");
    expect(frase).toContain("continua ligada");
    conferirVocabulario(frase);
  });

  it("no freio do dia, ela tenta de novo AMANHÃ", () => {
    const dia = budgetBlockedMessage({
      audience: "agendamento",
      blockedBy: "dia",
      effectiveMicros: 5_000_000,
      agora: AGORA,
    });
    expect(dia).toContain("tenta de novo amanhã");
    expect(dia).toContain("continua ligada");
    conferirVocabulario(dia);
  });

  it("no teto da plataforma, manda falar com quem cuida do sistema", () => {
    const plataforma = budgetBlockedMessage({
      audience: "agendamento",
      blockedBy: "plataforma",
      effectiveMicros: 50_000_000,
      agora: AGORA,
    });
    expect(plataforma).toContain("quem cuida do sistema");
    expect(plataforma).toContain("continua ligada");
    conferirVocabulario(plataforma);
  });
});

describe("frase F — webhook", () => {
  const frase = budgetBlockedMessage({
    audience: "webhook",
    blockedBy: "mes",
    effectiveMicros: null,
    agora: AGORA,
  });

  it("é exatamente a frase do contrato", () => {
    expect(frase).toBe(
      "Este workspace chegou no teto de gasto com IA deste mês. As chamadas voltam a ser " +
        "aceitas em 1º de setembro.",
    );
  });

  it("não manda ninguém abrir menu nenhum — do outro lado tem um programa", () => {
    expect(frase).not.toContain("Configurações");
    conferirVocabulario(frase);
  });

  it("no freio do dia, a resposta fala de amanhã", () => {
    const dia = budgetBlockedMessage({
      audience: "webhook",
      blockedBy: "dia",
      effectiveMicros: null,
      agora: AGORA,
    });
    expect(dia).toContain("amanhã");
    expect(dia).not.toContain("1º de setembro");
  });
});

describe("frase G — indexar documento", () => {
  const frase = budgetBlockedMessage({
    audience: "documento",
    blockedBy: "mes",
    effectiveMicros: 20_000_000,
    agora: AGORA,
  });

  it("é exatamente a frase do contrato", () => {
    expect(frase).toBe(
      "Não dá pra indexar este arquivo agora: o workspace chegou no teto de gasto com IA " +
        "deste mês. Indexar também gasta — é a IA que lê o arquivo pra deixar ele " +
        "pesquisável. O arquivo fica guardado; assim que o teto zerar (1º de setembro) " +
        'ou for aumentado, é só clicar em "Tentar de novo".',
    );
  });

  it("explica que indexar gasta e que o arquivo NÃO foi perdido", () => {
    expect(frase).toContain("Indexar também gasta");
    expect(frase).toContain("arquivo fica guardado");
    expect(frase).toContain("Tentar de novo");
    conferirVocabulario(frase);
  });
});

// ---------------------------------------------------------------------------
// O atalho que o motor usa
// ---------------------------------------------------------------------------

describe("budgetBlockedMessageFromStatus — o teto certo, sem ninguém escolher", () => {
  it("com o dia cheio, mostra o teto DO DIA", () => {
    const s = status({
      dailyBudgetMicros: 5_000_000,
      daySpentMicros: 5_100_000,
      monthSpentMicros: 9_000_000,
      blocked: true,
      overBudget: true,
      blockedBy: "dia",
    });
    expect(tetoDoBloqueio(s)).toBe(5_000_000);
    expect(gastoDoBloqueio(s)).toBe(5_100_000);
    expect(budgetBlockedMessageFromStatus(s, "pessoa-admin")).toContain("(US$ 5,00)");
  });

  it("com a plataforma cortando, mostra o teto DA PLATAFORMA", () => {
    const s = status({
      platformCapMicros: 50_000_000,
      monthlyBudgetMicros: 200_000_000,
      effectiveMonthlyMicros: 50_000_000,
      monthSpentMicros: 50_000_000,
      blocked: true,
      overBudget: true,
      blockedBy: "plataforma",
    });
    expect(tetoDoBloqueio(s)).toBe(50_000_000);
    expect(budgetBlockedMessageFromStatus(s, "pessoa-admin")).toContain(
      "quem cuida do sistema definiu",
    );
  });

  it("sem saber qual teto cortou, trata como o do mês (nunca fica sem frase)", () => {
    const s = status({ blocked: true, overBudget: true, blockedBy: null });
    expect(budgetBlockedMessageFromStatus(s, "pessoa-membro")).toContain("deste mês");
  });
});

// ---------------------------------------------------------------------------
// A faixa do topo
// ---------------------------------------------------------------------------

describe("budgetBanner — a faixa só aparece quando há o que dizer", () => {
  it("workspace tranquilo não vê faixa nenhuma", () => {
    expect(
      budgetBanner(status({ percentUsed: 12, monthSpentMicros: 2_400_000 }), "owner"),
    ).toBeNull();
  });

  it("sem teto nenhum, também não vê faixa", () => {
    const semTeto = status({
      monthlyBudgetMicros: null,
      effectiveMonthlyMicros: null,
      percentUsed: null,
      monthSpentMicros: 90_000_000,
    });
    expect(budgetBanner(semTeto, "owner")).toBeNull();
  });

  it("frase H — o aviso, a partir do porcento escolhido", () => {
    const faixa = budgetBanner(status({ percentUsed: 82, monthSpentMicros: 16_400_000 }), "admin");
    expect(faixa?.tom).toBe("aviso");
    expect(faixa?.titulo).toBe("Vocês já usaram 82% do teto de gasto com IA deste mês.");
    expect(faixa?.texto).toBe(
      "US$ 16,40 de US$ 20,00. Quando chegar no teto, os agentes param até 1º de setembro. " +
        "Dá pra aumentar em Configurações → Limites de IA.",
    );
    expect(faixa?.podeMudar).toBe(true);
    conferirVocabulario(`${faixa?.titulo} ${faixa?.texto}`);
  });

  it("quem não administra vê o mesmo aviso, mas mandado pedir", () => {
    const faixa = budgetBanner(status({ percentUsed: 82, monthSpentMicros: 16_400_000 }), "member");
    expect(faixa?.tom).toBe("aviso");
    expect(faixa?.podeMudar).toBe(false);
    expect(faixa?.texto).toContain("Quem administra o workspace pode aumentar");
  });

  it("abaixo do porcento escolhido, a faixa some", () => {
    expect(budgetBanner(status({ percentUsed: 79 }), "owner")).toBeNull();
    expect(budgetBanner(status({ percentUsed: 80 }), "owner")?.tom).toBe("aviso");
    // E o porcento é configurável: com aviso em 50%, 55% já aparece.
    expect(budgetBanner(status({ percentUsed: 55, alertAtPercent: 50 }), "owner")?.tom).toBe(
      "aviso",
    );
  });

  it("frase I — parado", () => {
    const faixa = budgetBanner(
      status({
        percentUsed: 100,
        monthSpentMicros: 20_000_000,
        blocked: true,
        overBudget: true,
        blockedBy: "mes",
      }),
      "owner",
    );
    expect(faixa?.tom).toBe("parado");
    expect(faixa?.titulo).toBe("Os agentes deste workspace estão parados.");
    expect(faixa?.texto).toBe(
      "O teto de gasto com IA deste mês (US$ 20,00) acabou. Eles voltam sozinhos em 1º de " +
        "setembro, ou agora, se você aumentar o teto.",
    );
    conferirVocabulario(`${faixa?.titulo} ${faixa?.texto}`);
  });

  it("frase J — passou do teto com o corte automático desligado", () => {
    const faixa = budgetBanner(
      status({
        hardStop: false,
        percentUsed: 115,
        monthSpentMicros: 23_100_000,
        overBudget: true,
        blocked: false,
        blockedBy: null,
      }),
      "owner",
    );
    expect(faixa?.tom).toBe("passou");
    expect(faixa?.titulo).toBe("Vocês passaram do teto de gasto com IA deste mês.");
    expect(faixa?.texto).toBe(
      "US$ 23,10 de US$ 20,00. Como o corte automático está desligado, os agentes continuam " +
        "rodando e a conta continua subindo.",
    );
    conferirVocabulario(`${faixa?.titulo} ${faixa?.texto}`);
  });

  it("parado pela plataforma: nem quem é dono do workspace muda esse teto", () => {
    const faixa = budgetBanner(
      status({
        platformCapMicros: 50_000_000,
        effectiveMonthlyMicros: 50_000_000,
        monthSpentMicros: 50_000_000,
        percentUsed: 100,
        blocked: true,
        overBudget: true,
        blockedBy: "plataforma",
      }),
      "owner",
    );
    expect(faixa?.tom).toBe("parado");
    expect(faixa?.podeMudar).toBe(false);
    expect(faixa?.texto).toContain("fale com quem administra o sistema");
  });
});

// ---------------------------------------------------------------------------
// Papéis e textos fixos
// ---------------------------------------------------------------------------

describe("quem pode mexer no teto", () => {
  it("dono e administrador sim, membro não", () => {
    expect(podeMudarOTeto("owner")).toBe(true);
    expect(podeMudarOTeto("admin")).toBe(true);
    expect(podeMudarOTeto("member")).toBe(false);
    expect(audienciaDoPapel("owner")).toBe("pessoa-admin");
    expect(audienciaDoPapel("member")).toBe("pessoa-membro");
  });
});

describe("os textos fixos da tela de Limites", () => {
  it("frase K aparece só quando existe execução sem preço, e concorda em número", () => {
    expect(textoExecucoesSemPreco(0)).toBeNull();
    expect(textoExecucoesSemPreco(1)).toContain("1 execução usou");
    expect(textoExecucoesSemPreco(3)).toContain("3 execuções usaram");
    expect(textoExecucoesSemPreco(3)).toContain("preço desconhecido");
  });

  it("frase L diz, com todas as letras, que isto NÃO é a fatura", () => {
    expect(TEXTO_MEDIDOR_NAO_E_FATURA).toContain("não a fatura do provedor");
    expect(TEXTO_MEDIDOR_NAO_E_FATURA).toContain("parecidos, nunca iguais");
  });

  it("frase M explica por que o teto é em dólar", () => {
    expect(TEXTO_POR_QUE_EM_DOLAR).toContain("cotação parada faz o teto mentir");
  });

  it("frase N mostra os dois freios de token, que continuam existindo", () => {
    expect(TEXTO_FREIOS_DO_SISTEMA).toContain("50 mil tokens");
    expect(TEXTO_FREIOS_DO_SISTEMA).toContain("500 mil por dia");
    expect(TEXTO_FREIOS_DO_SISTEMA).toContain("meia-noite (horário de Brasília)");
  });
});

// ---------------------------------------------------------------------------
// "Isso foi o teto, não foi defeito" — o distintivo da tela de Automações
// ---------------------------------------------------------------------------
//
// A tela de Automações precisa separar "a rodada foi pulada pelo teto" de
// "deu errado", e o único sinal que ela tem é o TEXTO de `last_error`. Este
// bloco trava as duas pontas: as frases escritas em TypeScript e as três que o
// BANCO escreve (copiadas na mão da migration `20260821040000`, seção 11).
//
// ⚠️ Mudou uma frase de teto e este teste ficou vermelho? O conserto NÃO é
// afrouxar o `ehRecusaDeTeto` — é conferir se a frase nova continua dizendo, em
// algum lugar, "teto de gasto com IA" ou "limite de gasto com IA".

/** Copiadas, palavra por palavra, de `enqueue_due_schedules` na migration. */
const FRASES_DO_BANCO = [
  "A rodada de hoje foi pulada: o workspace chegou no teto de gasto com IA de hoje. A automação continua ligada e tenta de novo amanhã.",
  "A rodada de hoje foi pulada: foi atingido o limite de gasto com IA definido por quem cuida do sistema. A automação continua ligada e volta sozinha na virada do mês.",
  "A rodada de hoje foi pulada: o workspace chegou no teto de gasto com IA deste mês. A automação continua ligada e volta sozinha na virada do mês.",
];

/** Falhas de verdade da automação. Nenhuma delas pode virar "rodada pulada". */
const FALHAS_DE_VERDADE = [
  "Esta automação parou porque o workspace já usou a cota de IA de hoje. Ela volta amanhã. (Automação tem cota própria, separada da sua.)",
  "Esta automação não tem mais uma pessoa responsável no workspace, então ela não pode rodar. Um administrador pode assumir e ligar de novo.",
  "O que essa automação manda pro agente não está num formato que ele entenda. Abra a automação e escreva de novo o pedido.",
  "A automação foi desligada porque tentar de novo daria o mesmo resultado.",
];

describe("ehRecusaDeTeto", () => {
  it("reconhece TODA frase de teto, em toda audiência e por todo teto", () => {
    const audiencias = [
      "pessoa-admin",
      "pessoa-membro",
      "agendamento",
      "webhook",
      "documento",
    ] as const;
    const tetos = ["mes", "dia", "plataforma"] as const;

    for (const audience of audiencias) {
      for (const blockedBy of tetos) {
        const frase = budgetBlockedMessage({
          audience,
          blockedBy,
          effectiveMicros: 20_000_000,
          agora: AGORA,
        });
        expect(ehRecusaDeTeto(frase), `${audience}/${blockedBy}: ${frase}`).toBe(true);
      }
    }
  });

  it("reconhece as três frases que o BANCO escreve em schedules.last_error", () => {
    for (const frase of FRASES_DO_BANCO) {
      expect(ehRecusaDeTeto(frase), frase).toBe(true);
    }
  });

  it("NÃO confunde falha de verdade com rodada pulada", () => {
    for (const frase of FALHAS_DE_VERDADE) {
      expect(ehRecusaDeTeto(frase), frase).toBe(false);
    }
  });

  it("sem texto nenhum, não é recusa de teto", () => {
    expect(ehRecusaDeTeto(null)).toBe(false);
    expect(ehRecusaDeTeto(undefined)).toBe(false);
    expect(ehRecusaDeTeto("")).toBe(false);
  });
});
