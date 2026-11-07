/**
 * "Me dá o texto que está dentro deste arquivo."
 *
 * Uma porta só pros dois caminhos (PDF e texto), pra quem chama não precisar
 * saber qual é qual. Quem decide o tipo é `lib/knowledge/mime.ts`, olhando o
 * CONTEÚDO — nunca a extensão do nome.
 *
 * NUNCA LANÇA. Falha vira `{ ok: false, motivo }`, com o motivo já em PT-BR
 * leigo — porque essa frase vai direto pra `documents.error_message`, que a
 * tela mostra crua pro aluno.
 */
import type { SniffedMime } from "../mime";
import { extrairTextoSimples } from "./text";

export type ExtracaoResult =
  | { ok: true; texto: string }
  /** `motivo` JÁ em PT-BR leigo: vira `documents.error_message`. */
  | { ok: false; motivo: string };

export { extrairTextoDePdf } from "./pdf";
export { extrairTextoSimples } from "./text";

export async function extrairTexto(p: {
  mime: SniffedMime;
  bytes: Uint8Array;
  /**
   * O texto que o `sniff` já decodificou, quando existe.
   *
   * Passar isto evita decodificar os mesmos bytes duas vezes — e a primeira
   * decodificação foi justamente a conferência que provou que era texto.
   */
  textoJaDecodificado: string | null;
}): Promise<ExtracaoResult> {
  if (p.mime === "application/pdf") {
    // O import é dinâmico DENTRO do pdf.ts. Aqui é estático de propósito: o
    // empacotamento standalone do Next precisa enxergar o arquivo pra copiar
    // ele pra imagem.
    const { extrairTextoDePdf } = await import("./pdf");
    return extrairTextoDePdf(p.bytes);
  }

  if (p.textoJaDecodificado !== null) {
    return { ok: true, texto: p.textoJaDecodificado };
  }

  return extrairTextoSimples(p.bytes);
}
