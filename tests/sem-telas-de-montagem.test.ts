import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { semComentarios } from "./helpers/sem-comentarios";

/**
 * GUARDA ESTÁTICA: nenhuma função do servidor CRIA definição.
 *
 * Definição (agente, base, agendamento, webhook) nasce de arquivo e é gravada
 * por `materializarWorkspace`. Uma action de criação sobrevivente é um SEGUNDO
 * dono da verdade: o banco passa a divergir do repositório, e nada acusa — o
 * `npm run semear` seguinte simplesmente não vê a linha que o formulário criou.
 *
 * É feio de propósito: um teste que lê arquivo chama atenção, e é isso que se
 * quer aqui.
 *
 * ⚠️ ISTO CASA MENOS DO QUE PARECE, E É PRA SABER DISSO. A checagem procura o
 * texto literal `export async function ${nome}` — comprovado por mutação que
 * ela NÃO pega:
 *   • `export const createAgentAction = async () => { ... }` (const com
 *     arrow function, não `function`);
 *   • `export { createAgentAction } from "./outro-arquivo"` (re-export);
 *   • a mesma função, de novo, num arquivo que não termine em `actions.ts`.
 * Não alargamos o regex de propósito: nesta altura do plano, isso arriscaria
 * falso positivo em código legítimo, sem ninguém disponível pra caçar. Quem
 * PROTEGE de verdade contra essas três formas voltarem é o `tsc`: apagar
 * `new-agent-dialog.tsx` etc. quebra o import de quem os chamava, e não tem
 * como recriar a tela sem recriar o arquivo (a outra metade deste teste,
 * embaixo). Esta primeira metade é só um alarme cedo, não a garantia.
 */
const PROIBIDAS: Array<[string, string]> = [
  ["createAgentAction", "agente nasce de lib/seed/registro.ts"],
  ["updateAgentAction", "editar agente é editar o arquivo"],
  ["deleteAgentAction", "aposentar agente é declarar status archived"],
  ["createKnowledgeBaseAction", "base nasce de lib/seed/registro.ts"],
  ["updateKnowledgeBaseAction", "slug e modelo são congelados pelo gatilho"],
  ["deleteKnowledgeBaseAction", "o materializador nunca apaga, e a tela também não"],
  ["criarAgendamentoAction", "agendamento nasce de lib/seed/registro.ts"],
  ["apagarAgendamentoAction", "apagar deixaria o banco divergir do arquivo"],
  ["criarWebhookAction", "webhook nasce de lib/seed/registro.ts"],
  ["revogarWebhookAction", "virou girarTokenDoWebhookAction, que mantém a URL"],
];

function arquivosDeAction(): string[] {
  const raiz = join(process.cwd(), "lib");
  return readdirSync(raiz, { recursive: true, encoding: "utf8" })
    .filter((nome) => nome.endsWith("actions.ts"))
    .map((nome) => join(raiz, nome));
}

describe("nenhuma função do servidor cria definição", () => {
  it("acha os arquivos de action (senão a guarda passa calada)", () => {
    expect(arquivosDeAction().length).toBeGreaterThan(0);
  });

  it.each(PROIBIDAS)("%s não existe mais (%s)", (nome, porque) => {
    for (const caminho of arquivosDeAction()) {
      const codigo = semComentarios(readFileSync(caminho, "utf8"));
      expect(codigo, `${caminho} ainda exporta ${nome} — ${porque}`).not.toContain(
        `export async function ${nome}`,
      );
    }
  });
});

/**
 * A outra metade: nenhuma TELA importa um formulário de criação. O arquivo
 * apagado quebraria o build, mas um `new-agent-dialog` recriado com outro nome
 * não quebraria nada — e é assim que a tela volta pela porta dos fundos.
 */
describe("nenhuma tela monta definição", () => {
  it("não sobrou diálogo de criação em agentes, conhecimento ou automações", () => {
    const raiz = join(process.cwd(), "app");
    const suspeitos = readdirSync(raiz, { recursive: true, encoding: "utf8" }).filter((nome) =>
      /(new-agent|new-base|agendamento-form|agent-editor|base-settings)/.test(nome),
    );
    expect(suspeitos).toEqual([]);
  });
});
