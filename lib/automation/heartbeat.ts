/**
 * O BATIMENTO DO TRABALHADOR: um arquivinho que ele encosta a cada volta do
 * laço, e que o `/api/health` olha.
 *
 * POR QUE UM ARQUIVO, E NÃO UMA TABELA
 * ------------------------------------
 * O site e o trabalhador são dois processos do MESMO container, então eles
 * dividem o disco. Um arquivo resolve sem gastar conexão de banco a cada 5
 * segundos — e continua funcionando quando o banco é justamente o que caiu.
 *
 * Duas coisas que o `/api/health` faz com isso:
 *   • responde 503 quando o batimento está velho, pra o EasyPanel reiniciar o
 *     container em vez de servir um site onde nenhuma automação roda, calado;
 *   • ⚠️ só faz isso quando existe `DATABASE_URL`. Sem endereço de banco o
 *     trabalhador nem sobe, e um 503 pra sempre viraria um laço de reinício
 *     num app que hoje funciona.
 *
 * ⚠️ NUNCA escreva o caminho da pasta temporária na mão aqui — sempre
 * `os.tmpdir()`. Na máquina do aluno (Windows) a pasta do Linux não existe, e
 * o `npm run dev` quebraria.
 */
import { existsSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * O nome do arquivo.
 *
 * ⚠️ ESTE MESMO NOME ESTÁ EM `scripts/worker.mjs`. Ele é Node puro (não passa
 * pelo empacotador do Next), então não dá pra importar daqui. Mudou aqui,
 * mude lá — e o `tests/entrypoint-worker.test.ts` confere que os dois batem.
 */
export const NOME_DO_ARQUIVO_DE_BATIMENTO = "worker-vivo";

/** Quanto tempo sem batimento já é motivo pra desconfiar. */
export const IDADE_MAXIMA_DO_BATIMENTO_MS = 120_000;

/** O caminho completo do arquivo de batimento. */
export function caminhoDoBatimento(): string {
  return join(tmpdir(), NOME_DO_ARQUIVO_DE_BATIMENTO);
}

/**
 * "Estou vivo." Encosta no arquivo (cria se não existir).
 *
 * NUNCA lança: um disco cheio não pode derrubar o trabalhador — o pior que
 * acontece é o healthcheck reclamar.
 */
export function baterPonto(): void {
  const caminho = caminhoDoBatimento();
  try {
    const agora = new Date();
    if (existsSync(caminho)) utimesSync(caminho, agora, agora);
    else writeFileSync(caminho, "trabalhador da automacao\n");
  } catch {
    // Sem batimento o healthcheck reclama — mas o trabalho continua rodando.
  }
}

/**
 * true quando o batimento é recente.
 *
 * Arquivo que não existe = trabalhador que nunca subiu = `false`.
 */
export function trabalhadorEstaVivo(maxIdadeMs = IDADE_MAXIMA_DO_BATIMENTO_MS): boolean {
  try {
    const info = statSync(caminhoDoBatimento());
    return Date.now() - info.mtimeMs <= maxIdadeMs;
  } catch {
    return false;
  }
}
