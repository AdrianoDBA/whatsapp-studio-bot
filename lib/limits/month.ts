/**
 * O RELÓGIO DO TETO: tudo vira à meia-noite de Brasília.
 *
 * O banco decide isso com `public.ai_today()` / `public.ai_month_start()`
 * (`at time zone 'America/Sao_Paulo'`). Este arquivo é o ESPELHO em TypeScript,
 * e existe por dois motivos: montar o `Retry-After` do webhook ("quantos
 * segundos faltam pra virada?") e escrever "1º de setembro" nas frases.
 *
 * ⚠️ AQUI DENTRO O FUSO DE SÃO PAULO É UTC−3 FIXO.
 * O Brasil não tem horário de verão desde 2019, então a conta é uma subtração.
 * **Se o horário de verão voltar, o conserto é NESTE arquivo** — o SQL usa
 * `at time zone`, que é correto por definição e não precisa de conserto.
 *
 * ⚠️ Discordou do banco? Quem manda é o banco. O conserto é aqui.
 *
 * Arquivo PURO: pode ser importado por componente com "use client" e por teste.
 */

/** UTC−3, em milissegundos. Ver o aviso do topo. */
const OFFSET_SP_MS = 3 * 60 * 60 * 1000;

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/**
 * O ano/mês/dia que está no calendário DE SÃO PAULO neste instante.
 *
 * O truque: joga o instante 3 horas pra trás e lê os campos em UTC. Assim
 * 01/09 às 01h UTC (que em São Paulo ainda é 31/08 às 22h) devolve agosto —
 * que é exatamente o que o medidor faz.
 */
function partesEmSaoPaulo(agora: Date): { ano: number; mes: number; dia: number } {
  const deslocado = new Date(agora.getTime() - OFFSET_SP_MS);
  return {
    ano: deslocado.getUTCFullYear(),
    mes: deslocado.getUTCMonth(),
    dia: deslocado.getUTCDate(),
  };
}

/** O instante da meia-noite de São Paulo daquele dia do calendário. */
function meiaNoiteEmSaoPaulo(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes, dia, 0, 0, 0, 0) + OFFSET_SP_MS);
}

function doisDigitos(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** O instante em que o mês corrente começou (00h00 de São Paulo do dia 1º). */
export function inicioDoMes(agora: Date = new Date()): Date {
  const { ano, mes } = partesEmSaoPaulo(agora);
  return meiaNoiteEmSaoPaulo(ano, mes, 1);
}

/** O instante em que o mês corrente acaba — e o medidor zera. */
export function proximaViradaDoMes(agora: Date = new Date()): Date {
  const { ano, mes } = partesEmSaoPaulo(agora);
  return meiaNoiteEmSaoPaulo(ano, mes + 1, 1);
}

/** O instante em que o dia corrente acaba — e o freio do dia zera. */
export function proximaViradaDoDia(agora: Date = new Date()): Date {
  const { ano, mes, dia } = partesEmSaoPaulo(agora);
  return meiaNoiteEmSaoPaulo(ano, mes, dia + 1);
}

/**
 * Quantos segundos faltam pra virada do mês. É o `Retry-After` do webhook.
 *
 * Sempre pelo menos 1: `Retry-After: 0` manda o sistema do outro lado tentar
 * de novo na mesma hora, o que é um laço.
 */
export function segundosAteAViradaDoMes(agora: Date = new Date()): number {
  return Math.max(1, Math.ceil((proximaViradaDoMes(agora).getTime() - agora.getTime()) / 1000));
}

/** Quantos segundos faltam pra meia-noite de Brasília. */
export function segundosAteAViradaDoDia(agora: Date = new Date()): number {
  return Math.max(1, Math.ceil((proximaViradaDoDia(agora).getTime() - agora.getTime()) / 1000));
}

/** "2026-08-21" — o mesmo dia que `public.ai_today()` devolve. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  const { ano, mes, dia } = partesEmSaoPaulo(agora);
  return `${ano}-${doisDigitos(mes + 1)}-${doisDigitos(dia)}`;
}

/**
 * "2026-08-01" — o mesmo dia que `public.ai_month_start()` devolve.
 *
 * `mesesAtras` anda pra trás no calendário: `3` num 21/08/2026 devolve
 * "2026-05-01". É assim que a tela monta a âncora de histórico.
 */
export function inicioDoMesISO(agora: Date = new Date(), mesesAtras = 0): string {
  const { ano, mes } = partesEmSaoPaulo(agora);
  const alvo = new Date(Date.UTC(ano, mes - mesesAtras, 1));
  return `${alvo.getUTCFullYear()}-${doisDigitos(alvo.getUTCMonth() + 1)}-01`;
}

/** "2026-08-21" → "2026-08-01". O dia já vem do banco no fuso certo. */
export function mesDoDia(diaIso: string): string {
  return `${diaIso.slice(0, 7)}-01`;
}

/**
 * "1º de setembro" — quando o teto do mês zera sozinho.
 *
 * Sem o ano de propósito: a frase é sempre sobre o mês que vem, e "1º de
 * setembro de 2026" numa frase de bloqueio só faz ela ficar mais longa.
 */
export function rotuloDaProximaVirada(agora: Date = new Date()): string {
  const virada = proximaViradaDoMes(agora);
  // A virada é, por construção, a meia-noite do dia 1º em São Paulo.
  const { mes } = partesEmSaoPaulo(virada);
  return `1º de ${MESES[mes]}`;
}

/** "2026-08-01" → "agosto de 2026". É o rótulo da linha do histórico. */
export function rotuloDoMes(iso: string): string {
  const [ano, mes] = iso.split("-");
  const indice = Number.parseInt(mes ?? "", 10) - 1;
  const nome = MESES[indice];
  if (!nome || !ano) return iso;
  return `${nome} de ${ano}`;
}

/**
 * "2026-08-21" com `diasAtras = 0`; "2026-07-23" com `diasAtras = 29`.
 *
 * Anda pra trás no calendário DE SÃO PAULO, que é o mesmo calendário da coluna
 * `day` de `org_ai_spend` (quem grava ali é `public.ai_today()`). Andar em UTC
 * daria o dia errado toda vez que a hora local estivesse entre 21h e a
 * meia-noite — justamente o horário em que alguém mexe no painel à noite.
 *
 * É o que monta o eixo do gráfico do Início: 30 dias sempre existem na tela,
 * mesmo os que não têm linha nenhuma no banco.
 */
export function diaISOAtras(agora: Date = new Date(), diasAtras = 0): string {
  const { ano, mes, dia } = partesEmSaoPaulo(agora);
  const alvo = new Date(Date.UTC(ano, mes, dia - diasAtras));
  return `${alvo.getUTCFullYear()}-${doisDigitos(alvo.getUTCMonth() + 1)}-${doisDigitos(alvo.getUTCDate())}`;
}
