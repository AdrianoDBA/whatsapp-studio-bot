/**
 * O TESTE DA FERRAMENTA QUE AS GUARDAS USAM.
 *
 * Três guardas deste projeto (`agents-tools-no-raw-client`,
 * `agents-tools-so-usam-acao`, `automation-tools-supported`) leem código-fonte
 * e precisam ignorar o que está dentro de comentário. Quando essa limpeza tem
 * furo, as três ficam cegas AO MESMO TEMPO — e cegas em silêncio, com o
 * `npm run verify` verde.
 *
 * Cada caso abaixo é um furo que EXISTIU de verdade numa versão anterior e foi
 * reproduzido. Eles não são hipótese: são o registro de por que essa função
 * usa o lexer do TypeScript em vez de dois `replace`.
 */
import { describe, expect, it } from "vitest";
import { semComentarios } from "./helpers/sem-comentarios";

/** O que as guardas de fato procuram. */
const TEM_FETCH = /\bfetch\s*\(/;

describe("semComentarios — apaga comentário", () => {
  it("apaga comentário de linha", () => {
    expect(semComentarios(`const a = 1; // fetch(x)`)).not.toMatch(TEM_FETCH);
  });

  it("apaga comentário de bloco, inclusive de várias linhas", () => {
    const codigo = `/**\n * nunca chame fetch( aqui\n */\nconst a = 1;`;
    expect(semComentarios(codigo)).not.toMatch(TEM_FETCH);
  });

  it("preserva as quebras de linha do comentário de bloco", () => {
    // Sem isso, o que vinha ANTES do comentário grudaria no que vem DEPOIS, e
    // uma busca por linha veria os dois como uma linha só.
    const codigo = `const a = 1;\n/* nota\n   em duas linhas */\nconst b = 2;`;
    const limpo = semComentarios(codigo);
    expect(limpo.split("\n")).toHaveLength(4);
    expect(limpo).toContain("const a = 1;");
    expect(limpo).toContain("const b = 2;");
  });
});

describe("semComentarios — o código de verdade CONTINUA lá", () => {
  it("comentário de bloco no começo da linha não engole o código do lado", () => {
    // FURO 1 (reproduzido): a versão que descartava a linha inteira quando ela
    // começava com marca de comentário aprovava este arquivo.
    const codigo = `/* nota rapida */ fetch("https://exemplo.com/x");`;
    expect(semComentarios(codigo)).toMatch(TEM_FETCH);
  });

  it("`//` dentro de string não apaga o resto da linha", () => {
    // FURO 2 (reproduzido): endereço sem protocolo — não tem `:` antes do `//`,
    // então o regex comia daí até o fim da linha, levando o `fetch(` junto.
    const codigo = `const url = "//cdn.exemplo.com/webhook"; fetch(url);`;
    expect(semComentarios(codigo)).toMatch(TEM_FETCH);
  });

  it("`/*` dentro de string não emenda com um `*/` legítimo lá na frente", () => {
    // FURO 3 (reproduzido, e o pior dos três porque acontece SEM MÁ-FÉ): o
    // `/*` dentro das aspas casava com o fechamento de um comentário honesto
    // no fim do arquivo, e tudo entre os dois virava "comentário".
    const codigo = [
      `const dica = "exemplo de comentario: /* nota importante";`,
      `fetch("https://exemplo.com/roubar");`,
      ``,
      `/**`,
      ` * Explicação no fim do arquivo, sem relação com a dica acima.`,
      ` */`,
    ].join("\n");
    expect(semComentarios(codigo)).toMatch(TEM_FETCH);
  });

  it("o endereço do import continua no resultado", () => {
    // A string NÃO é apagada de propósito: o endereço de um import é um
    // literal de string, e é exatamente o que a guarda irmã procura.
    const codigo = `import { createClient } from "@/lib/supabase/server";`;
    expect(semComentarios(codigo)).toContain("@/lib/supabase/server");
  });

  it("texto parecido com comentário dentro de template literal sobrevive", () => {
    const codigo = "const t = `veja // isto e /* aquilo */`;\nfetch(t);";
    expect(semComentarios(codigo)).toMatch(TEM_FETCH);
    expect(semComentarios(codigo)).toContain("veja // isto");
  });
});
