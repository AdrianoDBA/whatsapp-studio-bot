/**
 * A GUARDA QUE FALTAVA: toda função do banco que a AUTOMAÇÃO usa precisa estar
 * na lista fechada da ponte.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * A automação não fala com o Supabase pela internet: ela fala por uma ponte
 * caseira (`postgrest-bridge.ts`), que só sabe executar o que está numa lista
 * escrita à mão. Quando alguém acrescenta uma chamada de função no código e
 * esquece de acrescentar na lista, o resultado é o pior tipo de defeito:
 *
 *   • pelo painel, funciona;
 *   • pela automação, falha em silêncio.
 *
 * Isso ACONTECEU DE VERDADE. Gravar o rastro deixou de ser `insert` e virou
 * função (`record_agent_run_step`), e ninguém acrescentou na lista. O agente
 * agendado respondia certo e gravava ZERO passos, custo zero — histórico vazio
 * e gasto invisível pro teto de gasto. Medido: 3 passos e US$ 0,000487 pelo
 * painel contra 0 passos e US$ 0,00 pela automação, com o mesmo agente.
 *
 * Os 716 testes passavam.
 *
 * COMO ELE FUNCIONA
 * Lê o CÓDIGO-FONTE das pastas que rodam no caminho da automação, acha todo
 * `.rpc("...")` e conferem contra `FUNCOES_DA_PONTE`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FUNCOES_DA_PONTE } from "@/lib/automation/postgrest-bridge";

const RAIZ = process.cwd();

/**
 * As pastas que o trabalhador realmente alcança quando roda uma automação.
 *
 * ➕ ROTEOU UMA COISA NOVA PRA FILA? Acrescente a pasta dela aqui — senão a
 *    guarda continua verde e o buraco volta.
 */
const PASTAS_DA_AUTOMACAO = [
  "lib/agents", // o motor, o gravador do rastro, as ferramentas
  "lib/ai", // resolver modelo e chave
  "lib/secrets", // abrir a credencial do cofre
  "lib/knowledge", // indexar documento virou trabalho de fila
  "lib/limits", // ler o teto de gasto
];

/**
 * Funções que só existem no caminho da TELA e nunca são chamadas por uma
 * automação. Ficar de fora da ponte é intencional pra elas.
 *
 * Cada uma aqui é uma afirmação: "isto nunca roda sozinho". Se um dia rodar,
 * o teste acusa e a decisão volta pra mesa.
 */
const SO_NA_TELA = new Set([
  "save_credential", // cadastrar chave é ato de gente, na tela
  "credential_status", // idem
  "queue_document", // o botão "tentar de novo"
  "enqueue_document_job", // enfileirar é a tela; QUEM RODA é que passa pela ponte
  "set_org_ai_limits",
  "set_org_platform_cap",
  "recompute_org_ai_spend",
  "platform_ai_spend_overview",
]);

function arquivosTs(pasta: string): string[] {
  const raiz = join(RAIZ, pasta);
  const saida: string[] = [];
  function andar(dir: string) {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (extname(caminho) === ".ts" || extname(caminho) === ".tsx") saida.push(caminho);
    }
  }
  andar(raiz);
  return saida;
}

function funcoesChamadas(): Map<string, string> {
  const achadas = new Map<string, string>();
  for (const pasta of PASTAS_DA_AUTOMACAO) {
    for (const arquivo of arquivosTs(pasta)) {
      const fonte = readFileSync(arquivo, "utf8");
      for (const m of fonte.matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)) {
        const nome = m[1];
        if (nome && !achadas.has(nome)) achadas.set(nome, arquivo.replace(RAIZ, "").slice(1));
      }
    }
  }
  return achadas;
}

describe("a ponte da automação conhece tudo que a automação chama", () => {
  it("acha chamadas de função no código (senão este teste não prova nada)", () => {
    expect(funcoesChamadas().size).toBeGreaterThan(3);
  });

  it("TODA função chamada no caminho da automação está na lista da ponte", () => {
    const naLista = new Set<string>(FUNCOES_DA_PONTE);
    const faltando: string[] = [];

    for (const [nome, arquivo] of funcoesChamadas()) {
      if (naLista.has(nome) || SO_NA_TELA.has(nome)) continue;
      faltando.push(`${nome} (chamada em ${arquivo})`);
    }

    expect(
      faltando,
      "Estas funções rodam no caminho da automação mas a ponte não sabe executar.\n" +
        "Pelo painel vai funcionar; pela automação vai falhar calado.\n" +
        "Acrescente em FUNCOES_DA_PONTE + FORMA_DA_FUNCAO, ou em SO_NA_TELA se\n" +
        "ela realmente nunca roda sozinha:",
    ).toEqual([]);
  });

  it("a lista de exceções não guarda nome que ninguém chama mais", () => {
    const chamadas = new Set(funcoesChamadas().keys());
    const orfas = [...SO_NA_TELA].filter((n) => !chamadas.has(n));
    // Exceção que sobrou vira mentira na documentação: alguém lê "isso nunca
    // roda sozinho" sobre uma função que nem existe mais.
    expect(orfas, "exceções que não correspondem a nenhuma chamada real:").toEqual([]);
  });
});
