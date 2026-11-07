/**
 * O AGENDAMENTO, do lado do TypeScript: a frase em português e a conta da
 * próxima rodada.
 *
 * Arquivo PURO: só `Intl` e conta de data. Dá pra importar de página, de
 * componente com `"use client"` e de teste.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️ QUEM MANDA NA PRÓXIMA RODADA É O BANCO, NÃO ESTE ARQUIVO.             │
 * │                                                                          │
 * │ Quem grava `schedules.next_run_at` é o gatilho `schedules_set_next_run`, │
 * │ que chama a função `public.next_schedule_run` (em                        │
 * │ `supabase/migrations/20260821010000_automacao_fila.sql`). O Postgres tem │
 * │ o banco de fusos horários completo, então horário de verão sai certo lá  │
 * │ sem biblioteca nenhuma.                                                  │
 * │                                                                          │
 * │ `proximaRodada()` daqui é um ESPELHO, e existe por um motivo só: mostrar │
 * │ "vai rodar pela primeira vez em ..." na tela ANTES de salvar. Se um dia  │
 * │ os dois discordarem, o certo é o do banco — e o conserto é aqui, nunca   │
 * │ lá. As regras que os dois seguem estão escritas em cada bloco abaixo, e  │
 * │ `tests/automation-schedules.test.ts` trava todas elas.                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ O EIXO DOS DIAS DA SEMANA É O DO POSTGRES: 0 = domingo, 6 = sábado.
 * É o mesmo do `extract(dow)`, e é o que está gravado em `schedules.weekdays`.
 * Trocar por "1 = segunda" quebra a conta do banco e a daqui de uma vez só.
 */
import type { ScheduleKind } from "./types";

// ---------------------------------------------------------------------------
// Fusos horários
// ---------------------------------------------------------------------------
// Lista curta de propósito. Um seletor com os 400 fusos do mundo não ajuda
// ninguém a escolher — e o aluno brasileiro quer um dos primeiros da lista.

export type FusoSuportado = { id: string; label: string };

export const FUSOS: readonly FusoSuportado[] = [
  { id: "America/Sao_Paulo", label: "Brasília (São Paulo, Rio, Minas...)" },
  { id: "America/Fortaleza", label: "Nordeste (Fortaleza, Recife, Salvador)" },
  { id: "America/Belem", label: "Belém, Macapá" },
  { id: "America/Manaus", label: "Manaus, Boa Vista, Porto Velho" },
  { id: "America/Cuiaba", label: "Cuiabá, Campo Grande" },
  { id: "America/Rio_Branco", label: "Rio Branco (Acre)" },
  { id: "America/Noronha", label: "Fernando de Noronha" },
  { id: "UTC", label: "UTC (horário universal)" },
  { id: "America/New_York", label: "Nova York (EUA - leste)" },
  { id: "America/Los_Angeles", label: "Los Angeles (EUA - oeste)" },
  { id: "Europe/Lisbon", label: "Lisboa" },
  { id: "Europe/London", label: "Londres" },
  { id: "Europe/Paris", label: "Paris, Berlim, Madri, Roma" },
] as const;

/** Só os identificadores. É esta lista que o formato (Zod) confere. */
export const FUSOS_SUPORTADOS: readonly string[] = FUSOS.map((f) => f.id);

/** O fuso que um agendamento novo assume. Igual ao padrão da coluna no banco. */
export const FUSO_PADRAO = "America/Sao_Paulo";

export function fusoEhSuportado(id: string): boolean {
  return FUSOS_SUPORTADOS.includes(id);
}

// ---------------------------------------------------------------------------
// Dias da semana
// ---------------------------------------------------------------------------

/** 0 = domingo … 6 = sábado. O MESMO eixo do `extract(dow)` do Postgres. */
export const DIAS_DA_SEMANA: readonly { valor: number; nome: string; curto: string }[] = [
  { valor: 0, nome: "domingo", curto: "dom" },
  { valor: 1, nome: "segunda-feira", curto: "seg" },
  { valor: 2, nome: "terça-feira", curto: "ter" },
  { valor: 3, nome: "quarta-feira", curto: "qua" },
  { valor: 4, nome: "quinta-feira", curto: "qui" },
  { valor: 5, nome: "sexta-feira", curto: "sex" },
  { valor: 6, nome: "sábado", curto: "sáb" },
] as const;

/** Os limites que o banco impõe (constraints da tabela `schedules`). */
export const INTERVALO_MIN_MINUTOS = 5;
export const INTERVALO_MAX_MINUTOS = 1440;
/**
 * Teto de 28 no dia do mês, igual ao check da coluna.
 *
 * Não é preciosismo: "todo dia 31" pularia fevereiro, abril, junho... inteiros,
 * e em silêncio. Com 28, o dia existe em TODO mês do calendário.
 */
export const DIA_DO_MES_MAX = 28;

/**
 * A forma de um agendamento, do jeito que ele está gravado no banco
 * (snake_case). É de propósito: assim dá pra passar a linha da tabela direto,
 * sem tradutor no meio.
 */
export type FormaDoAgendamento = {
  kind: ScheduleKind | string;
  hour: number | null;
  minute: number | null;
  weekdays: number[] | null;
  day_of_month: number | null;
  every_minutes: number | null;
  timezone: string;
};

// ---------------------------------------------------------------------------
// A frase em português
// ---------------------------------------------------------------------------

function doisDigitos(n: number): string {
  return n.toString().padStart(2, "0");
}

function horaEscrita(hour: number | null, minute: number | null): string {
  if (hour === null || minute === null) return "";
  return `${doisDigitos(hour)}:${doisDigitos(minute)}`;
}

function apelidoDoFuso(timezone: string): string {
  if (timezone === FUSO_PADRAO) return "horário de Brasília";
  const conhecido = FUSOS.find((f) => f.id === timezone);
  return conhecido ? `horário de ${conhecido.label}` : `fuso ${timezone}`;
}

/** ["seg", "qua", "sex"] → "segunda-feira, quarta-feira e sexta-feira" */
function juntarDias(dias: number[]): string {
  const nomes = dias
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DIAS_DA_SEMANA.find((x) => x.valor === d)?.nome)
    .filter((n): n is string => typeof n === "string");

  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0] as string;
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** 90 → "1 hora e 30 minutos" · 15 → "15 minutos" · 120 → "2 horas" */
function duracaoEscrita(minutos: number): string {
  if (minutos < 60) return `${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  const parteHoras = `${horas} ${horas === 1 ? "hora" : "horas"}`;
  if (resto === 0) return parteHoras;
  return `${parteHoras} e ${resto} ${resto === 1 ? "minuto" : "minutos"}`;
}

/**
 * O agendamento em uma frase que qualquer pessoa entende.
 *
 * É esta frase que aparece na lista de automações — o aluno NUNCA vê
 * `0 8 * * 1-5`, e nunca digita isso também. NUNCA lança: dado estranho vira
 * "agendamento incompleto", que pelo menos é honesto.
 */
export function descreverAgendamento(s: FormaDoAgendamento): string {
  const fuso = apelidoDoFuso(s.timezone);

  if (s.kind === "interval") {
    if (s.every_minutes === null || !Number.isFinite(s.every_minutes) || s.every_minutes < 1) {
      return "agendamento incompleto";
    }
    // Intervalo não depende de fuso: "a cada 15 minutos" é a cada 15 minutos
    // em qualquer lugar do mundo.
    return `a cada ${duracaoEscrita(Math.trunc(s.every_minutes))}`;
  }

  const hora = horaEscrita(s.hour, s.minute);
  if (hora === "") return "agendamento incompleto";

  if (s.kind === "daily") {
    return `todo dia às ${hora} (${fuso})`;
  }

  if (s.kind === "weekly") {
    const dias = (s.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (dias.length === 0) return "agendamento incompleto";

    const conjunto = new Set(dias);
    if (conjunto.size === 7) return `todo dia às ${hora} (${fuso})`;
    if (conjunto.size === 5 && [1, 2, 3, 4, 5].every((d) => conjunto.has(d))) {
      return `de segunda a sexta às ${hora} (${fuso})`;
    }
    if (conjunto.size === 2 && conjunto.has(0) && conjunto.has(6)) {
      return `sábado e domingo às ${hora} (${fuso})`;
    }
    return `toda ${juntarDias([...conjunto])} às ${hora} (${fuso})`;
  }

  if (s.kind === "monthly") {
    if (s.day_of_month === null || s.day_of_month < 1 || s.day_of_month > DIA_DO_MES_MAX) {
      return "agendamento incompleto";
    }
    return `todo dia ${s.day_of_month} do mês às ${hora} (${fuso})`;
  }

  return "agendamento incompleto";
}

// ---------------------------------------------------------------------------
// A conta da próxima rodada (o espelho — ver o aviso do topo)
// ---------------------------------------------------------------------------

/**
 * Um formatador por fuso, guardado.
 *
 * Montar um `Intl.DateTimeFormat` é caro, e a tela recalcula a cada tecla
 * digitada no formulário.
 */
const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatadorDo(timezone: string): Intl.DateTimeFormat {
  const guardado = formatadores.get(timezone);
  if (guardado) return guardado;

  const novo = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    // `hourCycle: "h23"` e não `hour12: false`: com `hour12` a meia-noite sai
    // como "24" em algumas versões do Node, e a conta pularia um dia.
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatadores.set(timezone, novo);
  return novo;
}

type RelogioDeParede = {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
};

/** Que horas são, naquele fuso, no instante dado. Lança se o fuso não existir. */
function relogioDeParede(instante: Date, timezone: string): RelogioDeParede {
  const partes = formatadorDo(timezone).formatToParts(instante);
  const pegar = (tipo: Intl.DateTimeFormatPartTypes): number => {
    const parte = partes.find((p) => p.type === tipo);
    return parte ? Number.parseInt(parte.value, 10) : 0;
  };

  const hora = pegar("hour");
  return {
    ano: pegar("year"),
    mes: pegar("month"),
    dia: pegar("day"),
    // Cinto além do suspensório: se alguma versão do Node insistir em "24".
    hora: hora === 24 ? 0 : hora,
    minuto: pegar("minute"),
    segundo: pegar("second"),
  };
}

/**
 * Quanto aquele fuso está adiantado (ou atrasado) em relação ao UTC, NAQUELE
 * instante. É aqui que o horário de verão entra na conta.
 */
function deslocamentoMs(instante: Date, timezone: string): number {
  const p = relogioDeParede(instante, timezone);
  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // O `Intl` só chega ao segundo; os milissegundos do instante não fazem parte
  // do relógio de parede e precisam sair da conta.
  return comoSeFosseUtc - (instante.getTime() - instante.getMilliseconds());
}

/**
 * "Dia 21/08/2026, às 08:00, em São Paulo" → o instante exato disso.
 *
 * As duas passadas resolvem a virada do horário de verão: a primeira chuta o
 * deslocamento usando o horário como se fosse UTC, e a segunda corrige usando
 * o deslocamento que vale no instante chutado.
 *
 * ⚠️ LIMITAÇÃO CONHECIDA, MEDIDA E ACEITA
 * ---------------------------------------
 * Esta conta é um ESPELHO da função `next_schedule_run` do banco, que é quem
 * manda de verdade. Numa comparação de 2.430 casos (5 fusos × 9 instantes × 54
 * formatos), os dois concordaram em tudo MENOS em 33 casos — todos exatamente
 * nas viradas de horário de verão de fusos estrangeiros (Nova York, Paris).
 *
 * O que isso significa na prática: nos dois dias do ano em que um fuso
 * estrangeiro vira o relógio, a PRÉVIA da tela pode mostrar uma hora diferente
 * da que vai acontecer. A rodada em si sai certa — quem calcula o
 * `next_run_at` gravado é o banco, não este arquivo.
 *
 * Por que não foi consertado: reproduzir fielmente a aritmética de fuso do
 * Postgres em JavaScript é um poço sem fundo, e o preço do erro aqui é um
 * texto de prévia errado por uma hora, dois dias por ano, só pra quem escolhe
 * fuso de fora do Brasil. Se um dia isso incomodar, o caminho certo NÃO é
 * melhorar o espelho: é a tela perguntar a data pro banco.
 */
function instanteDoRelogio(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  timezone: string,
): Date {
  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0);
  const primeiroChute = alvo - deslocamentoMs(new Date(alvo), timezone);
  const corrigido = alvo - deslocamentoMs(new Date(primeiroChute), timezone);
  return new Date(corrigido);
}

/** O dia da semana de uma data do calendário. 0 = domingo, igual ao Postgres. */
function diaDaSemana(ano: number, mes: number, dia: number): number {
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** Soma dias numa data do calendário, sem passar perto de fuso. */
function somarDias(
  ano: number,
  mes: number,
  dia: number,
  quantos: number,
): { ano: number; mes: number; dia: number } {
  const d = new Date(Date.UTC(ano, mes - 1, dia + quantos));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

/** Soma meses no primeiro dia do mês. Nunca "estoura" pro mês seguinte. */
function somarMeses(ano: number, mes: number, quantos: number): { ano: number; mes: number } {
  const total = (ano * 12 + (mes - 1) + quantos) | 0;
  return { ano: Math.floor(total / 12), mes: (total % 12) + 1 };
}

/**
 * Quando esse agendamento roda pela próxima vez? `null` quando não roda nunca
 * (dado incompleto, formato desconhecido ou fuso que não existe).
 *
 * ⚠️ É SEMPRE ESTRITAMENTE DEPOIS de `apartirDe`. Um agendamento marcado pro
 * exato instante de agora vai pra próxima ocorrência — senão, um agendamento
 * "toda segunda às 9h" salvo às 9h em ponto de uma segunda-feira dispararia na
 * mesma hora em que foi criado, o que ninguém espera.
 *
 * As regras são as MESMAS de `public.next_schedule_run`. Ver o aviso do topo
 * do arquivo antes de mexer.
 */
export function proximaRodada(s: FormaDoAgendamento, apartirDe: Date = new Date()): Date | null {
  const base = apartirDe.getTime();
  if (!Number.isFinite(base)) return null;

  // ── a cada N minutos ────────────────────────────────────────────────────
  // Não passa por fuso nenhum: é uma soma no relógio absoluto.
  if (s.kind === "interval") {
    const minutos = s.every_minutes;
    if (minutos === null || !Number.isFinite(minutos) || minutos < 1) return null;
    return new Date(base + Math.trunc(minutos) * 60_000);
  }

  if (s.hour === null || s.minute === null) return null;
  if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) return null;
  if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59) return null;
  if (!s.timezone) return null;

  try {
    const agora = relogioDeParede(apartirDe, s.timezone);

    // ── todo dia ──────────────────────────────────────────────────────────
    // Duas voltas: hoje (se ainda não passou) e amanhã. É o mesmo `for i in
    // 0..1` da função do banco.
    if (s.kind === "daily") {
      for (let i = 0; i <= 1; i++) {
        const d = somarDias(agora.ano, agora.mes, agora.dia, i);
        const alvo = instanteDoRelogio(d.ano, d.mes, d.dia, s.hour, s.minute, s.timezone);
        if (alvo.getTime() > base) return alvo;
      }
      return null;
    }

    // ── toda semana ───────────────────────────────────────────────────────
    // Oito voltas: os sete dias da semana que vem mais o de hoje. A oitava
    // existe pro caso de o único dia marcado ser HOJE e o horário já ter
    // passado — aí a resposta é "daqui a sete dias".
    if (s.kind === "weekly") {
      const dias = (s.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      if (dias.length === 0) return null;
      const marcados = new Set(dias);

      for (let i = 0; i <= 7; i++) {
        const d = somarDias(agora.ano, agora.mes, agora.dia, i);
        if (!marcados.has(diaDaSemana(d.ano, d.mes, d.dia))) continue;
        const alvo = instanteDoRelogio(d.ano, d.mes, d.dia, s.hour, s.minute, s.timezone);
        if (alvo.getTime() > base) return alvo;
      }
      return null;
    }

    // ── todo mês ──────────────────────────────────────────────────────────
    if (s.kind === "monthly") {
      const dom = s.day_of_month;
      if (dom === null || !Number.isInteger(dom) || dom < 1 || dom > DIA_DO_MES_MAX) return null;

      for (let i = 0; i <= 12; i++) {
        const m = somarMeses(agora.ano, agora.mes, i);
        const alvo = instanteDoRelogio(m.ano, m.mes, dom, s.hour, s.minute, s.timezone);
        if (alvo.getTime() > base) return alvo;
      }
      return null;
    }

    return null;
  } catch {
    // Fuso que o `Intl` não conhece. A tela mostra "—" e o formato (Zod) já
    // barra isso antes de chegar no banco.
    return null;
  }
}
