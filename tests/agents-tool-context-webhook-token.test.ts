/**
 * GUARDA ESTÁTICA: `ctx.db.from("webhook_endpoints").update(...)` continua sem
 * conseguir tocar `token_hash` nem `token_prefix`.
 *
 * A migration `20260823020000_grant_update_token_webhook.sql` deu
 * `grant update (token_hash, token_prefix)` pra `authenticated` — foi
 * autorizado pra que `girarTokenDoWebhookAction` (ação HUMANA, atrás de
 * `requireOrgRole`) conseguisse girar o segredo do webhook. O grant vale pro
 * papel inteiro: tela E ferramenta de agente. Quem fecha a porta pra
 * ferramenta é só o `Omit` do `update()` em `lib/agents/tool-context.ts` —
 * sem ele, uma ferramenta futura poderia gravar um hash escolhido e girar o
 * segredo sem passar pela ação humana (ler já era impossível: `token_hash`
 * nunca teve `grant select`).
 *
 * Por que este teste lê o código-fonte em vez de testar o tipo: `Omit<...>`
 * some em tempo de execução — o JavaScript gerado aceita qualquer chave no
 * `patch`, então uma chamada de teste "de verdade" passando `token_hash`
 * não falha em runtime, só no `tsc`. E um teste SÓ de tipo (`@ts-expect-error`)
 * só quebra `npm run typecheck`, não `npm run test`, então passaria batido
 * se algum dia o typecheck for pulado num CI apressado. Uma guarda que lê o
 * fonte quebra os dois. Mesmo espírito de
 * `tests/agents-tools-no-raw-client.test.ts`: um teste que lê arquivo chama
 * atenção, e é isso que se quer aqui.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { semComentarios } from "./helpers/sem-comentarios";

const ARQUIVO = join(process.cwd(), "lib", "agents", "tool-context.ts");

function blocoDoWebhookEndpoints(codigoSemComentarios: string): string {
  const inicio = codigoSemComentarios.indexOf("webhook_endpoints: {");
  if (inicio === -1) {
    throw new Error("não achei o bloco webhook_endpoints em tool-context.ts — o arquivo mudou?");
  }
  // Cada bloco de tabela fecha com "\n    },\n" (4 espaços) antes da próxima
  // entrada — é o mesmo recuo usado em toda `criarAcessos()`. `webhook_endpoints`
  // é a última tabela da lista hoje, então também aceita o fechamento do
  // `return {` (`\n  };\n}`).
  const fimRelativo = codigoSemComentarios.slice(inicio).search(/\n {4}\},\n {2}\};\n\}/);
  if (fimRelativo === -1) {
    throw new Error("não achei o fim do bloco webhook_endpoints — o arquivo mudou de forma?");
  }
  return codigoSemComentarios.slice(inicio, inicio + fimRelativo);
}

describe("lib/agents/tool-context.ts — update de webhook_endpoints não toca o segredo do token", () => {
  const codigo = readFileSync(ARQUIVO, "utf8");
  const semComentario = semComentarios(codigo);
  const bloco = blocoDoWebhookEndpoints(semComentario);

  it('o bloco tem exatamente um update(), com Omit<TablesUpdate<"webhook_endpoints">, …>', () => {
    const ocorrencias = bloco.match(/Omit<\s*TablesUpdate<"webhook_endpoints">/g) ?? [];
    expect(ocorrencias).toHaveLength(1);
  });

  it("o Omit do update exclui token_hash e token_prefix (além de organization_id e created_by)", () => {
    const match = bloco.match(
      /Omit<\s*TablesUpdate<"webhook_endpoints">\s*,\s*((?:"[^"]+"\s*\|?\s*)+)>/,
    );
    const excluidasBrutas = match?.[1];
    if (!excluidasBrutas) {
      throw new Error("não achei o tipo do patch de update() dentro do bloco");
    }

    const excluidas = (excluidasBrutas.match(/"([^"]+)"/g) ?? []).map((s) => s.replaceAll('"', ""));

    expect(excluidas).toEqual(
      expect.arrayContaining(["organization_id", "created_by", "token_hash", "token_prefix"]),
    );
  });
});
