/**
 * TIRA COMENTÁRIO DO CÓDIGO — pro lexer do TypeScript, não na base do regex.
 *
 * POR QUE ISSO EXISTE, E POR QUE NÃO É UM `replace`
 * -------------------------------------------------
 * Três guardas deste projeto leem o código-fonte de `lib/agents/tools/` e
 * quebram o `npm run verify` quando acham um caminho proibido (`fetch(` solto,
 * cliente de banco cru, filtro que a ponte não fala). Todas as três precisam
 * ignorar o texto que está DENTRO de comentário — senão elas falham contra os
 * próprios avisos que explicam a regra.
 *
 * A primeira versão descartava a linha inteira quando ela COMEÇAVA com marca de
 * comentário. Isso engolia `/* nota *\/ fetch("...")` junto com a chamada de
 * verdade: a guarda aprovava um arquivo com `fetch(` executável.
 *
 * A segunda versão apagava o TRECHO do comentário com dois `replace`. Melhor,
 * e ainda assim furada em dois jeitos que foram REPRODUZIDOS:
 *
 *   1. `const url = "//cdn.exemplo.com/x"; fetch(url);`
 *      O `//` dentro da string (sem `:` antes) apagava o resto da linha, e o
 *      `fetch(` sumia.
 *
 *   2. `const dica = "veja: /* nota";`  …código proibido…  `/** algo no fim *\/`
 *      O `/*` dentro da string emendava com o `*\/` de um comentário legítimo
 *      lá na frente, e TUDO no meio virava "comentário" — inclusive a violação.
 *
 * A lição não é "escreva um regex melhor": é que separar comentário de string
 * exige um lexer, e o TypeScript já traz um. Ele sabe que `//` dentro de aspas é
 * texto, que `/*` dentro de aspas é texto, e onde cada literal começa e termina.
 *
 * A string em si CONTINUA no resultado — de propósito. O endereço de um import
 * (`from "@/lib/supabase/server"`) é um literal de string, e é justamente o que
 * a guarda irmã procura.
 */
import ts from "typescript";

/** O mesmo código, com o texto de todo comentário removido. */
export function semComentarios(codigo: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    codigo,
  );

  let resultado = "";
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const ehComentario =
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia;

    // Comentário de bloco pode ter várias linhas. Trocar por um espaço só
    // gruda o que vinha antes com o que vem depois, e uma busca por linha
    // passaria a ver as duas como uma. Então preserva as quebras de linha.
    if (ehComentario) {
      const texto = scanner.getTokenText();
      resultado += texto.replace(/[^\n]/g, "");
    } else {
      resultado += scanner.getTokenText();
    }

    token = scanner.scan();
  }

  return resultado;
}
