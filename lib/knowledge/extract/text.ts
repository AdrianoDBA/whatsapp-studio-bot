/**
 * Tirar o texto de um arquivo de TEXTO. É quase nada, de propósito.
 *
 * `.txt`, `.md` e `.csv` já são texto: o trabalho aqui é decodificar os bytes
 * em UTF-8 e mais nada. Nem tabela de markdown vira outra coisa, nem coluna de
 * CSV vira frase — o modelo lê melhor o arquivo do jeito que ele é, e o aluno
 * consegue conferir o trecho no rastro contra o arquivo original.
 *
 * ⚠️ NA PRÁTICA ESTA FUNÇÃO QUASE NUNCA RODA: `sniffKnowledgeFile` já
 * decodificou os bytes pra PROVAR que era texto, e passa o resultado adiante em
 * `SniffResult.texto`. Ela existe pro caminho de "Tentar de novo", que relê o
 * arquivo do bucket e não passou pelo sniff.
 *
 * Arquivo PURO: dá pra testar no Vitest.
 */
import type { ExtracaoResult } from "./index";

export function extrairTextoSimples(bytes: Uint8Array): ExtracaoResult {
  try {
    // `fatal: true` = sequência inválida vira exceção, e não o caractere "�"
    // caladamente. Um arquivo binário renomeado pra .txt precisa FALHAR aqui,
    // não virar mil pedaços de lixo indexado.
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const semMarca = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
    return { ok: true, texto: semMarca };
  } catch {
    return {
      ok: false,
      motivo:
        "Não consegui ler esse arquivo de texto. Ele provavelmente foi salvo num formato " +
        'diferente — abra num editor e salve de novo escolhendo "UTF-8".',
    };
  }
}
