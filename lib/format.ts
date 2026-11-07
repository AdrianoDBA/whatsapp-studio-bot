/**
 * Como número vira texto na tela — em PT-BR, num lugar só.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * Dinheiro, duração e data apareciam formatados em cinco telas diferentes,
 * cada uma do seu jeito. Aí uma mostrava "US$ 0,004" e outra "US$ 0.0042" pro
 * MESMO valor, e o aluno achava que tinha sido cobrado duas vezes. Aqui é o
 * único lugar do projeto que transforma número em texto de tela.
 *
 * ⚠️ FUSO HORÁRIO FIXO EM SÃO PAULO, DE PROPÓSITO.
 * Data e hora são desenhadas duas vezes: uma no servidor (que costuma rodar em
 * UTC) e outra no navegador (que roda no fuso de quem abriu). Se cada um
 * escolhesse o próprio fuso, o React reclamaria que "o servidor mostrou uma
 * coisa e o navegador esperava outra" — e, pior, a data podia pular um dia.
 * Fixando o fuso, os dois sempre escrevem exatamente o mesmo texto.
 *
 * Arquivo PURO: pode ser importado por página, por componente com "use client"
 * e por teste. Não lê banco, não lê variável de ambiente.
 */

/** O fuso que o app usa pra mostrar data e hora. Ver o aviso do topo. */
const FUSO = "America/Sao_Paulo";

const MICROS_POR_DOLAR = 1_000_000;

/**
 * Data e hora NO FUSO QUE VOCÊ PEDIR, com a sigla do fuso junto.
 *
 * Quando usar isto em vez de `formatDateTime`: quando o horário PERTENCE a
 * outro fuso — o caso do agendamento, em que a pessoa escolhe "9h em Lisboa" e
 * precisa ver 9h, não 5h de Brasília.
 *
 * ⚠️ Use SÓ do lado do navegador (dentro de um `"use client"`, depois de a
 * pessoa interagir). Se isso for desenhado no servidor E no navegador com
 * fusos diferentes, o React reclama que "o servidor mostrou uma coisa e o
 * navegador esperava outra" — que é exatamente o motivo de `formatDateTime`
 * ter fuso fixo.
 */
export function formatDateTimeInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    // Fuso que o navegador não conhece não pode derrubar a tela.
    return formatDateTime(iso);
  }
}

/**
 * Micro-dólares → texto de dinheiro.
 *
 *   4_200      → "US$ 0,0042"
 *   1_500_000  → "US$ 1,50"
 *   0          → "US$ 0,0000"   (custou zero mesmo)
 *   null       → "preço desconhecido"
 *
 * `null` NÃO vira "US$ 0,00". Zero quer dizer "não custou nada"; `null` quer
 * dizer "não deu pra calcular" (modelo fora do catálogo de preços). Mostrar
 * zero pros dois casos seria mentir sobre a conta.
 */
export function formatUsdFromMicros(micros: number | null | undefined): string {
  if (micros === null || micros === undefined || !Number.isFinite(micros)) {
    return "preço desconhecido";
  }

  const dolares = micros / MICROS_POR_DOLAR;
  // Valor de centavo pra cima cabe em 2 casas; abaixo disso, 2 casas viraria
  // "US$ 0,00" pra tudo e o aluno não veria diferença entre execuções.
  const casas = Math.abs(dolares) >= 1 ? 2 : 4;

  return `US$ ${dolares.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}`;
}

/**
 * Preço de tabela do catálogo → "US$ 3,00 / 1M tokens".
 *
 * É o preço por 1 milhão de tokens, que é como os provedores anunciam.
 */
export function formatPricePerMTok(micros: number): string {
  if (!Number.isFinite(micros)) return "preço desconhecido";

  const dolares = micros / MICROS_POR_DOLAR;
  const casas = dolares > 0 && dolares < 1 ? 3 : 2;

  return `US$ ${dolares.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })} / 1M tokens`;
}

/**
 * Milissegundos → duração legível.
 *
 *   340    → "340 ms"
 *   1234   → "1,2 s"
 *   65000  → "1 min 5 s"
 *   null   → "—"
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";

  if (ms < 1000) return `${Math.round(ms)} ms`;

  const segundos = ms / 1000;
  if (segundos < 60) {
    return `${segundos.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} s`;
  }

  const minutos = Math.floor(segundos / 60);
  const resto = Math.round(segundos - minutos * 60);
  // 1 min 60 s não existe: arredondar 59,7 s pra cima empurra pro minuto.
  if (resto === 60) return `${minutos + 1} min`;
  return resto === 0 ? `${minutos} min` : `${minutos} min ${resto} s`;
}

/** ISO → "20/08/2026 14:32". Texto vazio quando a data não faz sentido. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  // Montado em dois pedaços de propósito. `toLocaleString` junto escreve
  // "20/08/2026, 14:32" — com vírgula, e a vírgula muda de lugar conforme a
  // versão da biblioteca de idiomas do sistema. Assim o texto é sempre o mesmo.
  const data = d.toLocaleDateString("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const hora = d.toLocaleTimeString("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${data} ${hora}`;
}

/** ISO → "20/08/2026". É este que o `pricedAt` do catálogo usa. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // "2026-08-20" sem hora é lido como meia-noite UTC. Somando o fuso de São
  // Paulo isso voltaria pro dia 19 — por isso a data pura ganha um horário do
  // meio do dia antes de virar Date.
  const bruto = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(bruto);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** 1234 → "1.234". null → "—". */
export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.trunc(n).toLocaleString("pt-BR");
}

/**
 * ISO → "há 4 min", "em 3 h", "ontem".
 *
 * É o tempo do jeito que uma pessoa fala. O Início usa nas duas direções: pra
 * trás em "últimas execuções" e pra frente em "próximas automações".
 *
 * ⚠️ SÓ EM COMPONENTE DE SERVIDOR. Numa tela com "use client" o servidor
 * escreveria "há 4 min", o navegador recalcularia alguns segundos depois e o
 * React reclamaria de o servidor ter mostrado uma coisa e o navegador esperar
 * outra. Em componente de servidor o texto vira HTML uma vez e pronto.
 *
 * ⚠️ ACIMA DE 7 DIAS VIRA DATA. "há 43 dias" não diz nada pra ninguém; a data
 * diz. Quem escreve ela é `formatDate`, com o fuso fixo de São Paulo — este
 * arquivo continua sendo o dono único de data, hora e duração (regra 10-D).
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  agora: Date = new Date(),
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const diff = d.getTime() - agora.getTime();
  const futuro = diff > 0;
  const abs = Math.abs(diff);

  const MINUTO = 60_000;
  const HORA = 60 * MINUTO;
  const DIA = 24 * HORA;

  if (abs < 45_000) return futuro ? "em instantes" : "agora mesmo";

  if (abs < HORA) {
    const min = Math.round(abs / MINUTO);
    return futuro ? `em ${min} min` : `há ${min} min`;
  }

  if (abs < DIA) {
    const h = Math.round(abs / HORA);
    return futuro ? `em ${h} h` : `há ${h} h`;
  }

  if (abs < 7 * DIA) {
    const dias = Math.round(abs / DIA);
    if (dias === 1) return futuro ? "amanhã" : "ontem";
    return futuro ? `em ${dias} dias` : `há ${dias} dias`;
  }

  return formatDate(iso);
}

const MESES_CURTOS = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez.",
] as const;

/**
 * "2026-08-21" → "21 de ago.". É o rótulo do eixo do gráfico do Início.
 *
 * ⚠️ O DIA É CORTADO DO TEXTO, NUNCA PASSADO POR `new Date()`. "2026-08-21"
 * sem hora é lido como meia-noite UTC; somando o fuso de São Paulo isso volta
 * pro dia 20, e o gráfico inteiro apareceria deslocado um dia pra trás.
 * `formatDate` resolve o mesmo problema por outro caminho (empurra pro meio-dia
 * antes de virar `Date`), porque lá a entrada às vezes tem hora de verdade.
 * Aqui a entrada é SEMPRE um dia do calendário de São Paulo, vindo da coluna
 * `day` de `org_ai_spend` — então não há nada pra converter, só pra escrever.
 */
export function formatShortDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [, mes, dia] = iso.split("-");
  const indice = Number.parseInt(mes ?? "", 10) - 1;
  const nome = MESES_CURTOS[indice];
  if (!nome || !dia) return iso;
  return `${Number.parseInt(dia, 10)} de ${nome}`;
}
