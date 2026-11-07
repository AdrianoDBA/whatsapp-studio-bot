/**
 * REDE DE SEGURANÇA, NÃO O MECANISMO.
 *
 * Quem impede uma ferramenta de agir em ensaio é o `ctx.acao` não fazer nada
 * (regra 10-K). Este teste existe pra pegar cedo o caminho paralelo — uma
 * ferramenta que importe `lib/email` ou chame `fetch` direto agiria de verdade
 * achando que estava simulando.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { semComentarios } from "./helpers/sem-comentarios";

const PASTA = join(process.cwd(), "lib/agents/tools");
// `recursive: true` NÃO é enfeite — é a mesma correção que a guarda irmã
// (`agents-tools-no-raw-client.test.ts`) já tinha e esta não: sem ele, uma
// ferramenta dentro de subpasta (`lib/agents/tools/vendas/avisar.ts`) escapava
// da guarda inteira e podia chamar `fetch` direto com o verify verde.
const ARQUIVOS = readdirSync(PASTA, { recursive: true, encoding: "utf8" }).filter(
  (f) => f.endsWith(".ts") && !f.split(/[\\/]/).pop()?.startsWith("_"),
);

describe("nenhuma ferramenta age por fora do ctx.acao", () => {
  it("acha os arquivos (senão este teste não prova nada)", () => {
    expect(ARQUIVOS.length).toBeGreaterThan(2);
  });

  for (const arquivo of ARQUIVOS) {
    it(`${arquivo} não chama fetch nem importa lib/email`, () => {
      const fonte = readFileSync(join(PASTA, arquivo), "utf8");

      // O texto proibido também aparece nos comentários que EXPLICAM a regra
      // (o aviso de topo desta própria ferramenta, por exemplo). Então a busca
      // ignora o texto de comentário — mesma função do teste irmão
      // (`agents-tools-no-raw-client.test.ts`), pra não ter duas guardas
      // parecidas com critérios diferentes.
      const linhasDeCodigo = semComentarios(fonte);

      expect(linhasDeCodigo, "use ctx.acao.http").not.toMatch(/\bfetch\s*\(/);
      expect(linhasDeCodigo, "use ctx.acao.email").not.toMatch(/from\s+["']@\/lib\/email/);
    });
  }
});
