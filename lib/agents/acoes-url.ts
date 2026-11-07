/**
 * AS TRAVAS DO ENDEREÇO DE SAÍDA — puras, testáveis sem rede.
 *
 * A partir da onda 7 o agente alcança a internet. Este arquivo é a parte que dá
 * pra decidir olhando só o texto do endereço. NÃO EXISTE verificação do IP
 * resolvido em lugar nenhum — é risco conhecido e aceito nesta onda. Um domínio
 * que resolva pra `127.0.0.1` continua passando aqui; a defesa está em outra
 * camada (limite de tamanho da resposta, timeout, isolamento de processo).
 *
 * Arquivo PURO: pode ser importado por teste e por componente de tela.
 */

/** Quanto tempo uma ação espera antes de desistir. */
export const PRAZO_DA_ACAO_MS = 20_000;

/**
 * Teto da resposta que volta pro modelo.
 *
 * ⚠️ NÃO É LIMITE DE REDE, É LIMITE DE JANELA. A resposta vira ENTRADA DO
 * MODELO: 40 MB de JSON estoura a janela do modelo, custa dinheiro de verdade
 * e pode derrubar o processo. Corta com aviso.
 */
export const TETO_DA_RESPOSTA_BYTES = 262_144;

/** Faixas que nunca podem ser alvo de uma ação do agente. */
const FAIXAS_INTERNAS: Array<(p: number[]) => boolean> = [
  (p) => p[0] === 127, // loopback
  (p) => p[0] === 10, // privado
  (p) => p[0] === 100 && (p[1] ?? 0) >= 64 && (p[1] ?? 0) <= 127, // CGNAT (carrier-grade)
  (p) => p[0] === 192 && p[1] === 168, // privado
  (p) => p[0] === 172 && (p[1] ?? 0) >= 16 && (p[1] ?? 0) <= 31, // privado
  (p) => p[0] === 169 && p[1] === 254, // link-local — inclui 169.254.169.254
  (p) => p[0] === 0,
];

const NOMES_INTERNOS = new Set(["localhost", "ip6-localhost", "[::1]", "::1"]);

/**
 * Tira o ponto final do nome — e isso É uma trava de segurança.
 *
 * `localhost.` (com ponto no fim) é o MESMO endereço que `localhost`: o ponto
 * é a raiz do DNS, e todo resolvedor trata os dois igual. Sem esta linha,
 * `https://localhost./x` passava batido pela conferência e a ação saía pra
 * dentro da própria máquina do servidor — reproduzido na revisão da onda 7.
 *
 * Vale pro IPv4 escrito na mão pelo mesmo motivo (`127.0.0.1.`): ali o
 * estrago era outro, mas do mesmo tamanho — a contagem de partes dava 5 em vez
 * de 4, e a função concluía "não é IPv4 literal, é um nome".
 *
 * `+` (e não um ponto só) porque `localhost..` também resolve.
 */
function semPontoFinal(host: string): string {
  return host.replace(/\.+$/, "");
}

/**
 * Esse host é da rede de dentro?
 *
 * ⚠️ `169.254.169.254` É O MOTIVO PRINCIPAL DESTA FUNÇÃO. É o endereço de
 * metadados das nuvens: quem chega nele recebe a credencial da máquina.
 *
 * Normaliza o host passando por `new URL()` antes de checar, pra cobrir
 * notações alternativas de IPv4 (decimal, octal). Chamada sozinha com texto
 * arbitrário é segura.
 */
export function ehIpInterno(host: string): boolean {
  const limpo = host.trim().toLowerCase();
  if (NOMES_INTERNOS.has(semPontoFinal(limpo))) return true;

  // IPv6 entre colchetes: qualquer endereço v6 é recusado nesta onda. A
  // superfície não compensa o ganho — nenhum sistema de aluno depende disso.
  if (limpo.startsWith("[")) return true;

  // Normaliza notações alternativas de IPv4 (decimal, octal, etc.) passando
  // por `new URL()`. Texto inválido lança; lixo não é endereço interno.
  let hostNormalizado = limpo;
  try {
    // A URL precisa de protocolo pra `new URL()` funcionar. Pra evitar validações
    // de protocolo (https/http), usa um fictício. O que importa é o hostname.
    const url = new URL(`http://${limpo}`);
    hostNormalizado = url.hostname.toLowerCase();
  } catch {
    // `new URL()` lançou: o texto não parece endereço válido. Não é interno.
    return false;
  }

  // Reaplica o check de nomes especiais DEPOIS de normalizar. O ponto final
  // SOBREVIVE ao `new URL()` quando o host é um nome (`localhost.` continua
  // `localhost.`) — só o caminho de IPv4 literal é que já o descarta sozinho.
  hostNormalizado = semPontoFinal(hostNormalizado);
  if (NOMES_INTERNOS.has(hostNormalizado)) return true;

  const partes = hostNormalizado.split(".");
  if (partes.length !== 4) return false; // não é IPv4 literal: é um nome
  const nums = partes.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  return FAIXAS_INTERNAS.some((f) => f(nums));
}

/** `ok: false` traz a frase que o MODELO vai ler — em PT-BR, sem jargão. */
export function conferirEnderecoDeSaida(
  bruto: string,
): { ok: true; url: URL } | { ok: false; erro: string } {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return { ok: false, erro: "Esse endereço não parece um endereço de internet válido." };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      erro: "Só dá pra chamar endereços que começam com https. Com http os dados viajariam abertos.",
    };
  }

  if (ehIpInterno(url.hostname)) {
    return {
      ok: false,
      erro: "Esse endereço aponta pra dentro da própria máquina do servidor, e não pra um sistema de fora.",
    };
  }

  return { ok: true, url };
}
