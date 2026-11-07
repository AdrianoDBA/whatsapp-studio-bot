/**
 * O SEGREDO DA CHAMADA INTERNA — trabalhador → /api/internal/run-job.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * O trabalhador (scripts/worker.mjs) e o site (o Next) são dois processos
 * DENTRO DO MESMO container. O trabalhador pega um trabalho da fila e pede pro
 * site rodar o agente, porque é lá que mora todo o código de agente, de
 * ferramenta e de chave. Essa chamada precisa provar que veio de dentro.
 *
 * ⚠️ NENHUMA VARIÁVEL DE AMBIENTE NOVA. O segredo é DERIVADO da ENCRYPTION_KEY
 * (que já é obrigatória) com HKDF-SHA256. Como os dois processos nascem do
 * mesmo `docker-entrypoint.sh`, eles sempre concordam — inclusive quando a
 * chave é a temporária que o container gera no boot.
 *
 * O que quebra: rodar o site e o trabalhador com `.env` DIFERENTES na sua
 * máquina. O sintoma é 401 na chamada interna, e a mensagem do log diz isso.
 *
 * ⚠️ ESTE ARQUIVO É .mjs DE PROPÓSITO. Ele é importado pelos dois lados:
 *   • pelo trabalhador, que é Node puro (não passa pelo empacotador do Next);
 *   • pelo site, em TypeScript, através do `segredo-interno.d.mts` ao lado.
 * Uma segunda cópia em TypeScript seria a mesma conta escrita duas vezes — e
 * no dia em que uma das duas mudasse, o sintoma seria 401 sem explicação.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/** Sal da derivação. Trocar isso invalida a chamada interna (não o cofre). */
const SAL = "automacao-v1";
/** Pra que serve a chave derivada. Separa esta do resto do que sai da mestra. */
const INFO = "internal-run-job-v1";

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const HEX_64_RE = /^[0-9a-f]{64}$/i;

/**
 * Transforma a ENCRYPTION_KEY em bytes, do MESMO jeito nos dois processos.
 *
 * O formato que o container gera é 32 bytes sorteados em base64 (é o que
 * `lib/secrets/crypto.ts` exige). O caminho de texto puro existe só pra que
 * uma chave fora do formato ainda produza o mesmo segredo dos dois lados — em
 * vez de produzir dois segredos diferentes e virar um 401 misterioso.
 *
 * @param {string | undefined | null} encryptionKey
 * @returns {Buffer}
 */
function materialDaChave(encryptionKey) {
  const limpo = String(encryptionKey ?? "").trim();
  if (limpo === "") {
    throw new Error(
      "Falta a variável ENCRYPTION_KEY. Sem ela o trabalhador não consegue provar " +
        "pro site que a chamada veio de dentro do container. Rode: npm run gerar-chave",
    );
  }
  if (BASE64_RE.test(limpo)) {
    const bytes = Buffer.from(limpo, "base64");
    if (bytes.length >= 32) return bytes;
  }
  return Buffer.from(limpo, "utf8");
}

/**
 * O segredo compartilhado, em hexadecimal (32 bytes → 64 caracteres).
 *
 * @param {string | undefined | null} encryptionKey
 * @returns {string}
 */
export function derivarSegredoInterno(encryptionKey) {
  const derivada = hkdfSync("sha256", materialDaChave(encryptionKey), SAL, INFO, 32);
  return Buffer.from(derivada).toString("hex");
}

/**
 * A assinatura de UMA chamada. O momento entra na conta: a rota só aceita
 * assinatura de até 60 segundos atrás, então uma assinatura capturada não
 * serve amanhã.
 *
 * @param {string} segredo  o que `derivarSegredoInterno` devolveu (hex)
 * @param {string} jobId
 * @param {string} workerId
 * @param {number} momentoMs
 * @returns {string}
 */
export function assinarChamada(segredo, jobId, workerId, momentoMs) {
  if (!HEX_64_RE.test(String(segredo ?? ""))) {
    throw new Error("assinarChamada: o segredo interno precisa ser 32 bytes em hexadecimal.");
  }
  return createHmac("sha256", Buffer.from(segredo, "hex"))
    .update(`v1\n${jobId}\n${workerId}\n${momentoMs}`, "utf8")
    .digest("hex");
}

/**
 * Confere a assinatura em TEMPO CONSTANTE.
 *
 * Comparar com `===` vazaria, pelo tempo de resposta, quantos caracteres do
 * começo estavam certos — e com isso dá pra adivinhar a assinatura inteira,
 * um caractere de cada vez.
 *
 * @param {string} segredo
 * @param {string} jobId
 * @param {string} workerId
 * @param {number} momentoMs
 * @param {string} assinatura
 * @returns {boolean}
 */
export function conferirAssinatura(segredo, jobId, workerId, momentoMs, assinatura) {
  const recebida = String(assinatura ?? "");
  if (!HEX_64_RE.test(recebida)) return false;

  let esperada;
  try {
    esperada = assinarChamada(segredo, jobId, workerId, momentoMs);
  } catch {
    return false;
  }

  const a = Buffer.from(esperada, "hex");
  const b = Buffer.from(recebida, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * A assinatura de UMA chamada de `npm run semear` — `scripts/semear.mjs` →
 * `/api/internal/semear`. Sem `jobId` nem `workerId`: semear não é trabalho
 * da fila, então assina só `organizationId` (pode ser vazio) e o momento.
 *
 * ⚠️ PREFIXO DIFERENTE (`semear-v1`, não `v1`) DE PROPÓSITO: separa o domínio
 * da assinatura de `assinarChamada`. Uma assinatura de `run-job` nunca é uma
 * assinatura válida de `semear`, e vice-versa, mesmo as duas derivando do
 * MESMO segredo — o texto assinado é diferente.
 *
 * @param {string} segredo         o que `derivarSegredoInterno` devolveu (hex)
 * @param {string} organizationId  vazio (`""`) quando semeia TODOS os workspaces
 * @param {number} momentoMs
 * @returns {string}
 */
export function assinarChamadaSemear(segredo, organizationId, momentoMs) {
  if (!HEX_64_RE.test(String(segredo ?? ""))) {
    throw new Error("assinarChamadaSemear: o segredo interno precisa ser 32 bytes em hexadecimal.");
  }
  return createHmac("sha256", Buffer.from(segredo, "hex"))
    .update(`semear-v1\n${organizationId ?? ""}\n${momentoMs}`, "utf8")
    .digest("hex");
}

/**
 * Confere a assinatura de uma chamada de `npm run semear`, em TEMPO CONSTANTE.
 *
 * @param {string} segredo
 * @param {string} organizationId
 * @param {number} momentoMs
 * @param {string} assinatura
 * @returns {boolean}
 */
export function conferirAssinaturaSemear(segredo, organizationId, momentoMs, assinatura) {
  const recebida = String(assinatura ?? "");
  if (!HEX_64_RE.test(recebida)) return false;

  let esperada;
  try {
    esperada = assinarChamadaSemear(segredo, organizationId, momentoMs);
  } catch {
    return false;
  }

  const a = Buffer.from(esperada, "hex");
  const b = Buffer.from(recebida, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
