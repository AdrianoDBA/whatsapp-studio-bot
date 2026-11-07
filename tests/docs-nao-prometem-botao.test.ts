import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A documentação é do ALUNO, e ele é leigo: quando ela manda clicar num botão
 * que não existe, ele conclui que o sistema está quebrado — não que a doc está
 * velha. Esta guarda pega as frases que a Onda do "código é o dono" invalidou.
 *
 * Se algum dia um botão desses voltar, apague a linha DAQUI junto com a mudança,
 * no mesmo commit. Uma guarda que a gente afrouxa sem pensar não guarda nada.
 *
 * ⚠️ ISTO CASA MENOS DO QUE PARECE, E É PRA SABER DISSO. Só cinco frases
 * literais — não "qualquer promessa de botão que não existe". Provado por
 * revisão: "Agentes → o agente → Ferramentas — marque Mandar email. Salve." e
 * "Agentes criados pelo painel" passaram os dois por aqui sem acender nada,
 * porque nenhum regex cobre "marque … Salve" nem "criados pelo". E a busca só
 * lê `docs/` — **`README.md` da raiz está fora do alcance desta guarda**,
 * mesmo prometendo o mesmo tipo de botão morto. Não alargue os regexes pra
 * cobrir mais casos: nesta altura do plano, regex mais largo arrisca falso
 * positivo em prosa legítima, sem ninguém disponível pra caçar. O que
 * protege de verdade contra o resto é ler o arquivo inteiro, não confiar
 * neste teste passando.
 */
const FRASES_MORTAS: Array<[RegExp, string]> = [
  [/clique em ["“]?novo agente/i, "o botão não existe mais; agente nasce de arquivo"],
  [/clique em ["“]?nova base/i, "o botão não existe mais; base nasce de arquivo"],
  [/bot(ã|a)o de (criar|novo) agendamento/i, "agendamento nasce de arquivo"],
  [/revogar o webhook/i, "virou 'gerar token', que mantém o endereço"],
  [/edite as instru(ç|c)(õ|o)es (no|pelo) painel/i, "o prompt mora no arquivo"],
];

function arquivosDeDoc(): string[] {
  const raiz = join(process.cwd(), "docs");
  return readdirSync(raiz, { recursive: true, encoding: "utf8" })
    .filter((n) => n.endsWith(".md") && !n.includes("superpowers"))
    .map((n) => join(raiz, n));
}

describe("a documentação não promete botão que não existe", () => {
  it("acha os arquivos de doc (senão a guarda passa calada)", () => {
    expect(arquivosDeDoc().length).toBeGreaterThan(0);
  });

  it.each(FRASES_MORTAS)("nenhuma doc diz %s (%s)", (padrao, porque) => {
    for (const caminho of arquivosDeDoc()) {
      const texto = readFileSync(caminho, "utf8");
      expect(padrao.test(texto), `${caminho}: ${porque}`).toBe(false);
    }
  });
});
