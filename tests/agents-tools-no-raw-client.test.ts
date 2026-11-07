/**
 * GUARDA ESTÁTICA: nenhuma ferramenta abre o banco por fora do `ctx.db`.
 *
 * O `ctx.db` fecha o caminho errado por TIPO — mas nada no TypeScript impede
 * alguém de escrever, dentro de uma ferramenta:
 *
 *   import { createClient } from "@/lib/supabase/server";
 *
 * e a partir daí consultar qualquer tabela sem o filtro do workspace. A RLS
 * ainda protege (o pior caso passa a ser "ver dado de OUTRO workspace DA MESMA
 * PESSOA", não de terceiros), mas é exatamente o tipo de erro que passa
 * despercebido numa revisão.
 *
 * Então este teste lê o CÓDIGO-FONTE de `lib/agents/tools/` e quebra o
 * `npm run verify` quando acha um caminho proibido. É feio de propósito: um
 * teste que lê arquivo chama atenção, e é isso que se quer aqui.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { semComentarios } from "./helpers/sem-comentarios";

const PASTA_DAS_FERRAMENTAS = join(process.cwd(), "lib", "agents", "tools");

/** Cada item é [pedaço proibido, por que ele é proibido]. */
const PROIBIDOS: Array<[string, string]> = [
  ["@/lib/supabase/server", "abre o banco sem o filtro do workspace — use ctx.db"],
  ["@/lib/supabase/client", "cliente de navegador não roda dentro de uma ferramenta"],
  ["@supabase/supabase-js", "monta um cliente cru — use ctx.db"],
  ["@supabase/ssr", "monta um cliente cru — use ctx.db"],
  ["createOrgScopedDb", "quem monta o contexto é o motor, não a ferramenta"],
  ["process.env", "variável de ambiente só via lib/env.ts (regra 4 do CLAUDE.md)"],
  ["SERVICE_ROLE", "o template não tem chave de service role, e não vai ter"],
];

function arquivosDeFerramenta(): string[] {
  // `recursive: true` NÃO é enfeite: sem ele, uma ferramenta dentro de
  // subpasta (lib/agents/tools/vendas/buscar-cliente.ts) escapava da guarda
  // inteira e podia importar o cliente cru do banco com o verify verde.
  return readdirSync(PASTA_DAS_FERRAMENTAS, { recursive: true, encoding: "utf8" }).filter(
    (nome) => nome.endsWith(".ts") && nome !== "index.ts",
  );
}

describe("lib/agents/tools — nenhuma ferramenta fala com o banco por fora do ctx.db", () => {
  it("a pasta tem ferramenta pra conferir (senão este teste não prova nada)", () => {
    expect(arquivosDeFerramenta().length).toBeGreaterThan(0);
  });

  it.each(
    arquivosDeFerramenta(),
  )("%s não importa cliente cru nem lê variável de ambiente", (nome) => {
    const conteudo = readFileSync(join(PASTA_DAS_FERRAMENTAS, nome), "utf8");

    // O texto proibido também aparece nos comentários que EXPLICAM a regra
    // (no molde, por exemplo). Então a busca ignora o texto de comentário.
    const linhasDeCodigo = semComentarios(conteudo);

    for (const [proibido, motivo] of PROIBIDOS) {
      expect(linhasDeCodigo.includes(proibido), `${nome} usa "${proibido}": ${motivo}`).toBe(false);
    }
  });

  it("o molde de ferramenta continua existindo, com esse nome", () => {
    expect(arquivosDeFerramenta()).toContain("_TEMPLATE_ferramenta.ts");
  });
});
