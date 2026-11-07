/**
 * "Esse arquivo é mesmo o que ele diz que é?"
 *
 * ⚠️ A EXTENSÃO DO NOME NÃO DECIDE NADA IMPORTANTE AQUI (regra 7 do CLAUDE.md
 * raiz). Quem manda o arquivo escolhe o nome e escolhe o `Content-Type` do
 * formulário — os dois são texto digitado por quem está do outro lado. O que
 * decide é o CONTEÚDO:
 *
 *   • começa com `%PDF-`  → é PDF;
 *   • decodifica em UTF-8 inteiro, sem byte zero e sem lixo de controle
 *     → é texto;
 *   • qualquer outra coisa → recusado, com frase em PT-BR.
 *
 * A extensão entra numa decisão só, e ela é cosmética: entre `.txt`, `.md` e
 * `.csv` o conteúdo é idêntico pro nosso lado (tudo vira texto e é recortado
 * igual). A extensão só escolhe o rótulo que aparece na tela e o sufixo do
 * arquivo no bucket.
 *
 * Arquivo PURO: não fala com banco, não lê cookie, dá pra testar no Vitest.
 */

/**
 * Teto de tamanho: 5 MB.
 *
 * ⚠️ ESTE NÚMERO ANDA JUNTO COM OUTROS TRÊS. Mudou aqui, mude nos quatro:
 *   1. `KNOWLEDGE_MAX_BYTES` (aqui) — o que a função do servidor confere;
 *   2. `file_size_limit` do bucket `knowledge-docs` (migration
 *      `20260821020000_knowledge_base.sql`);
 *   3. `bodySizeLimit` em `next.config.ts` (precisa ser MAIOR, pra sobrar
 *      espaço pro resto do formulário);
 *   4. o texto da tela de envio, que promete o número pro aluno.
 */
export const KNOWLEDGE_MAX_BYTES = 5_242_880;

/**
 * Os tipos que o app aceita.
 *
 * ⚠️ Esta lista é a MESMA do `allowed_mime_types` do bucket. O Storage recusa
 * o envio sozinho se divergir — e o erro dele não é em português.
 */
export const KNOWLEDGE_ACCEPTED_MIMES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

export type SniffedMime = (typeof KNOWLEDGE_ACCEPTED_MIMES)[number];
export type SniffedExt = "pdf" | "txt" | "md" | "csv";

export type SniffResult =
  | {
      ok: true;
      mime: SniffedMime;
      ext: SniffedExt;
      bytes: Uint8Array;
      /**
       * O texto JÁ decodificado, pros arquivos de texto. `null` pro PDF (quem
       * extrai é `lib/knowledge/extract/pdf.ts`).
       *
       * Existe pra não decodificar os mesmos bytes duas vezes — e porque a
       * decodificação é justamente a conferência que provou que era texto.
       */
      texto: string | null;
    }
  /** `motivo` JÁ em PT-BR leigo: a tela mostra cru. */
  | { ok: false; motivo: string };

/** A lista que vai no `accept=` do `<input type="file">`. */
export const KNOWLEDGE_ACCEPT_ATTR = ".pdf,.txt,.md,.markdown,.csv";

/** "5 MB" — pro texto da tela nunca discordar da constante. */
export function tamanhoMaximoLegivel(): string {
  return `${Math.round(KNOWLEDGE_MAX_BYTES / (1024 * 1024))} MB`;
}

const ASSINATURA_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function comecaComPdf(bytes: Uint8Array): boolean {
  // Alguns geradores põem lixo antes do `%PDF-`. O pdf.js aguenta isso, então
  // a gente procura a assinatura nos primeiros 1024 bytes, igual ele faz.
  const limite = Math.min(bytes.length, 1024);
  for (let i = 0; i + ASSINATURA_PDF.length <= limite; i++) {
    let bate = true;
    for (let j = 0; j < ASSINATURA_PDF.length; j++) {
      if (bytes[i + j] !== ASSINATURA_PDF[j]) {
        bate = false;
        break;
      }
    }
    if (bate) return true;
  }
  return false;
}

/** Extensão do nome do arquivo, em minúscula e sem o ponto. */
function extensaoDoNome(fileName: string): string {
  const nome = typeof fileName === "string" ? fileName : "";
  const corte = nome.lastIndexOf(".");
  if (corte < 0 || corte === nome.length - 1) return "";
  return nome.slice(corte + 1).toLowerCase();
}

/**
 * Texto de verdade, ou binário disfarçado?
 *
 * Devolve o texto decodificado, ou `null` quando os bytes não são UTF-8
 * válido — que é o caso de imagem, .docx, .xlsx, executável e de arquivo de
 * texto salvo em UTF-16 (o Bloco de Notas do Windows chama isso de "Unicode").
 */
function decodificarTexto(bytes: Uint8Array): string | null {
  // Byte zero no meio é o sinal mais confiável de "isto não é texto": nenhum
  // arquivo de texto UTF-8 legítimo tem um, e praticamente todo formato
  // binário tem vários.
  //
  // Repare que isto TAMBÉM pega o UTF-16 (que intercala zeros), e é de
  // propósito: aceitar UTF-16 aqui faria o recorte contar caracteres errados
  // depois.
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return null;
  }

  try {
    // `fatal: true` = qualquer sequência inválida vira exceção em vez de virar
    // o caractere "�" caladamente. Sem isso, um .docx entraria como texto
    // cheio de lixo e viraria pedaço indexado sem sentido nenhum.
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Tira a marca de ordem de byte que o Excel põe no começo dos .csv.
    return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  } catch {
    return null;
  }
}

/**
 * Olha os bytes e decide o que é.
 *
 * SÍNCRONA de propósito: é ela que o teste exercita, com bytes montados à mão.
 * A versão que recebe `File` é a de baixo.
 */
export function sniffKnowledgeBytes(bytes: Uint8Array, fileName: string): SniffResult {
  if (bytes.length === 0) {
    return { ok: false, motivo: "Esse arquivo está vazio. Escolha outro." };
  }
  if (bytes.length > KNOWLEDGE_MAX_BYTES) {
    return {
      ok: false,
      motivo:
        `Esse arquivo é grande demais (o limite é ${tamanhoMaximoLegivel()}). ` +
        "Divida em partes menores e suba uma de cada vez.",
    };
  }

  if (comecaComPdf(bytes)) {
    return { ok: true, mime: "application/pdf", ext: "pdf", bytes, texto: null };
  }

  const texto = decodificarTexto(bytes);
  if (texto === null) {
    return {
      ok: false,
      motivo:
        "Só dá pra ler PDF e arquivo de texto (.txt, .md, .csv). Esse aí é de outro tipo — " +
        "se for um Word ou uma planilha, exporte como PDF e tente de novo.",
    };
  }
  if (texto.trim().length === 0) {
    return {
      ok: false,
      motivo: "Esse arquivo só tem espaços em branco — não tem nada pra ler dentro dele.",
    };
  }

  // Daqui pra baixo a extensão só escolhe o RÓTULO. O conteúdo já foi provado
  // texto pelo decodificador acima.
  const ext = extensaoDoNome(fileName);
  if (ext === "csv") return { ok: true, mime: "text/csv", ext: "csv", bytes, texto };
  if (ext === "md" || ext === "markdown") {
    return { ok: true, mime: "text/markdown", ext: "md", bytes, texto };
  }
  return { ok: true, mime: "text/plain", ext: "txt", bytes, texto };
}

/**
 * A mesma coisa, partindo do `File` que veio do formulário.
 *
 * ⚠️ Confere o tamanho ANTES de ler os bytes: `arrayBuffer()` num arquivo de
 * 500 MB põe 500 MB na memória do servidor antes de qualquer conferência.
 */
export async function sniffKnowledgeFile(file: File): Promise<SniffResult> {
  if (file.size > KNOWLEDGE_MAX_BYTES) {
    return {
      ok: false,
      motivo:
        `Esse arquivo é grande demais (o limite é ${tamanhoMaximoLegivel()}). ` +
        "Divida em partes menores e suba uma de cada vez.",
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return sniffKnowledgeBytes(bytes, file.name);
}
