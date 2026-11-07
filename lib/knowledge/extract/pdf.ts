/**
 * Tirar o texto de um PDF.
 *
 * ⚠️ ESTE É O ÚNICO ARQUIVO DO PROJETO QUE IMPORTA `unpdf`. Mantê-lo sozinho
 * tem um motivo prático e um plano B:
 *
 *  • motivo: `unpdf` embute o pdf.js, que é grande e carrega pedaços de si
 *    mesmo na hora. Ele está em `serverExternalPackages` no `next.config.ts`
 *    justamente por isso — empacotado, ele quebra SÓ EM PRODUÇÃO;
 *  • plano B (declarado no §6 do contrato, risco 7): se um dia o `unpdf` não
 *    subir no container, dá pra APAGAR este arquivo, tirar `application/pdf` do
 *    `KNOWLEDGE_ACCEPTED_MIMES` e do `allowed_mime_types` do bucket, e o resto
 *    do app continua funcionando com .txt/.md/.csv e a aba "Colar texto".
 *    Nenhum outro arquivo precisa mudar.
 *
 * ⚠️ O `import` é DINÂMICO (`await import("unpdf")`), e isso não é
 * preguiça: assim o pdf.js só é carregado quando alguém sobe um PDF de
 * verdade. Sem isso, TODA função do servidor do app pagaria o carregamento
 * dele no primeiro pedido depois de o container subir.
 *
 * ⚠️ PDF ESCANEADO NÃO TEM TEXTO. Um PDF que é foto de página devolve zero
 * caractere daqui, e a frase de erro precisa dizer isso com essas palavras —
 * "não achei texto" sem explicação faz o aluno achar que o app está quebrado.
 */
import { logError } from "@/lib/logger";
import type { ExtracaoResult } from "./index";

export async function extrairTextoDePdf(bytes: Uint8Array): Promise<ExtracaoResult> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");

    // ⚠️ O pdf.js CONSOME o buffer que recebe (ele fica "detached" depois).
    // Uma cópia aqui é o que deixa o mesmo `bytes` ser reaproveitado depois —
    // no envio pro bucket, por exemplo. Sem ela o upload sobe 0 byte.
    const copia = new Uint8Array(bytes);
    const pdf = await getDocumentProxy(copia);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });

    // ⚠️ `mergePages: true` devolve UMA string com as páginas já coladas — é
    // uma sobrecarga do `unpdf`. Sem essa opção viria `string[]`, e aí o
    // recorte contaria pedaço por PÁGINA em vez de por assunto (e uma frase
    // que atravessa a virada de página ficaria partida pra sempre).
    const limpo: string = text;

    if (limpo.trim().length === 0) {
      return {
        ok: false,
        motivo:
          `Esse PDF tem ${totalPages} página(s), mas nenhuma delas tem texto de verdade — ` +
          "é uma foto de cada página (PDF escaneado). Passe ele por um programa de " +
          "reconhecimento de texto (OCR) e suba de novo, ou cole o texto na aba ao lado.",
      };
    }

    return { ok: true, texto: limpo };
  } catch (err) {
    // O detalhe técnico vai pro registro do servidor; a pessoa lê a frase.
    logError("knowledge.extrairTextoDePdf", err);
    return {
      ok: false,
      motivo:
        "Não consegui abrir esse PDF. Ele pode estar protegido por senha ou corrompido — " +
        "tente abrir e salvar de novo, ou cole o texto na aba ao lado.",
    };
  }
}
