/**
 * Lê o `.env.local` na mão.
 *
 * POR QUE ISSO EXISTE: o `npm run dev` (que é o Next) carrega o `.env.local`
 * sozinho. O Node puro NÃO carrega. Como o trabalhador da automação é Node
 * puro, sem isto ele subiria na sua máquina sem enxergar nem o endereço do
 * banco nem a chave de segurança — e o sintoma seria "a automação não roda",
 * sem erro nenhum no registro (log).
 *
 * Dentro do container isto não faz nada (não existe `.env.local` lá): as
 * variáveis chegam pelo painel do EasyPanel.
 *
 * É a mesma receita do `scripts/migrate.mjs`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Preenche `process.env` com o que estiver no `.env.local` da raiz do projeto.
 * O que já estiver definido no ambiente GANHA — variável do painel vale mais
 * que arquivo local.
 *
 * @param {string} raiz  a pasta do projeto
 */
export function lerArquivoEnvLocal(raiz) {
  const caminho = join(raiz, ".env.local");
  if (!existsSync(caminho)) return;

  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, chave, valorCru] = m;
    if (process.env[chave]) continue;
    process.env[chave] = valorCru.replace(/^["']|["']$/g, "");
  }
}
