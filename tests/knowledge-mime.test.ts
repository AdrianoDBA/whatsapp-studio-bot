/**
 * "ESSE ARQUIVO É MESMO O QUE ELE DIZ QUE É?"
 *
 * Regra 7 do CLAUDE.md raiz: upload valida por CONTEÚDO, nunca pela extensão do
 * nome. Quem manda o arquivo escolhe o nome e escolhe o `Content-Type` do
 * formulário — os dois são texto digitado por quem está do outro lado.
 *
 * O que este arquivo prova, em uma frase: um binário renomeado pra `.txt` é
 * RECUSADO, e um PDF chamado `notas.txt` é reconhecido como PDF.
 */
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_ACCEPTED_MIMES,
  KNOWLEDGE_MAX_BYTES,
  sniffKnowledgeBytes,
  sniffKnowledgeFile,
  tamanhoMaximoLegivel,
} from "@/lib/knowledge/mime";

/**
 * Texto → bytes.
 *
 * O tipo de saída é `Uint8Array<ArrayBuffer>` (e não o `Uint8Array` solto que
 * o `TextEncoder` devolve) porque o construtor de `File`/`Blob` recusa
 * `ArrayBufferLike` — que inclui `SharedArrayBuffer`. Sem isso o `tsc` reclama
 * nas duas linhas que montam um `File`.
 */
function bytesDe(texto: string): Uint8Array<ArrayBuffer> {
  const codificado = new TextEncoder().encode(texto);
  const saida = new Uint8Array(new ArrayBuffer(codificado.length));
  saida.set(codificado);
  return saida;
}

/** Um "PDF" mínimo: o que importa é a assinatura do começo. */
function pdfDeMentira(prefixo = ""): Uint8Array<ArrayBuffer> {
  return bytesDe(`${prefixo}%PDF-1.7\n1 0 obj\n<<>>\nendobj\n`);
}

describe("sniffKnowledgeBytes — o conteúdo decide", () => {
  it("reconhece PDF pela assinatura, mesmo com o nome errado", () => {
    const r = sniffKnowledgeBytes(pdfDeMentira(), "notas.txt");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mime).toBe("application/pdf");
    expect(r.ext).toBe("pdf");
    // PDF não sai daqui decodificado: quem extrai é o `extract/pdf.ts`.
    expect(r.texto).toBeNull();
  });

  it("acha o `%PDF-` mesmo com lixo antes (alguns geradores fazem isso)", () => {
    const r = sniffKnowledgeBytes(pdfDeMentira("   \n\n"), "arquivo.pdf");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mime).toBe("application/pdf");
  });

  it("RECUSA binário renomeado pra .txt (byte zero no meio)", () => {
    // Um .docx, um .xlsx e um .png têm byte zero. Nenhum arquivo de texto
    // UTF-8 legítimo tem.
    const binario = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x41, 0x42]);
    const r = sniffKnowledgeBytes(binario, "planilha.txt");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/PDF e arquivo de texto/i);
    expect(r.motivo).toMatch(/exporte como PDF/i);
  });

  it("RECUSA sequência UTF-8 inválida em vez de virar '?' caladamente", () => {
    // Sem `fatal: true` no decodificador, isto entraria como texto cheio de
    // lixo e viraria pedaço indexado sem sentido nenhum.
    const invalido = new Uint8Array([0xc3, 0x28, 0x41, 0x42, 0x43]);
    const r = sniffKnowledgeBytes(invalido, "texto.txt");
    expect(r.ok).toBe(false);
  });

  it("RECUSA texto salvo em UTF-16 (o 'Unicode' do Bloco de Notas)", () => {
    // UTF-16 intercala zeros — e aceitar isso faria o recorte contar
    // caracteres errados depois.
    const utf16 = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]);
    const r = sniffKnowledgeBytes(utf16, "notas.txt");
    expect(r.ok).toBe(false);
  });

  it("a extensão só escolhe o RÓTULO entre .txt, .md e .csv", () => {
    const conteudo = bytesDe("coluna1,coluna2\n1,2\n");

    expect(sniffKnowledgeBytes(conteudo, "tabela.csv")).toMatchObject({
      ok: true,
      mime: "text/csv",
      ext: "csv",
    });
    expect(sniffKnowledgeBytes(conteudo, "LEIA.MD")).toMatchObject({
      ok: true,
      mime: "text/markdown",
      ext: "md",
    });
    expect(sniffKnowledgeBytes(conteudo, "readme.markdown")).toMatchObject({
      ok: true,
      mime: "text/markdown",
      ext: "md",
    });
    // Sem extensão conhecida (ou sem extensão nenhuma) vira texto simples.
    expect(sniffKnowledgeBytes(conteudo, "arquivo-sem-extensao")).toMatchObject({
      ok: true,
      mime: "text/plain",
      ext: "txt",
    });
  });

  it("devolve o texto JÁ decodificado, sem a marca do Excel", () => {
    const comMarca = bytesDe("﻿nome,valor\n");
    const r = sniffKnowledgeBytes(comMarca, "tabela.csv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).toBe("nome,valor\n");
  });

  it("arquivo vazio e arquivo só de espaço são recusados, com frase diferente", () => {
    const vazio = sniffKnowledgeBytes(new Uint8Array(0), "a.txt");
    expect(vazio.ok).toBe(false);
    if (vazio.ok) return;
    expect(vazio.motivo).toMatch(/vazio/i);

    const soEspaco = sniffKnowledgeBytes(bytesDe("   \n\t \n"), "a.txt");
    expect(soEspaco.ok).toBe(false);
    if (soEspaco.ok) return;
    expect(soEspaco.motivo).toMatch(/espaços em branco/i);
  });

  it("arquivo acima do teto é recusado dizendo o número que a tela promete", () => {
    const grande = new Uint8Array(KNOWLEDGE_MAX_BYTES + 1).fill(0x41);
    const r = sniffKnowledgeBytes(grande, "gigante.txt");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain(tamanhoMaximoLegivel());
  });

  it("a lista de tipos aceitos é a MESMA do bucket (4 tipos, sem surpresa)", () => {
    // Divergir da `allowed_mime_types` do bucket faz o Storage recusar o envio
    // sozinho — com um erro que não é em português.
    expect([...KNOWLEDGE_ACCEPTED_MIMES]).toEqual([
      "application/pdf",
      "text/plain",
      "text/markdown",
      "text/csv",
    ]);
  });
});

describe("sniffKnowledgeFile — o caminho do formulário", () => {
  it("recusa pelo TAMANHO antes de ler os bytes", async () => {
    // Ler `arrayBuffer()` de um arquivo de 500 MB põe 500 MB na memória do
    // servidor. Este dublê estoura se alguém chamar `arrayBuffer()`.
    const arquivoEnorme = {
      size: KNOWLEDGE_MAX_BYTES + 1,
      name: "enorme.pdf",
      arrayBuffer: () => {
        throw new Error("não podia ter lido os bytes");
      },
    } as unknown as File;

    const r = await sniffKnowledgeFile(arquivoEnorme);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/grande demais/i);
  });

  it("lê o arquivo pequeno normalmente", async () => {
    const arquivo = new File([bytesDe("oi, mundo")], "ola.txt", { type: "text/plain" });
    const r = await sniffKnowledgeFile(arquivo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).toBe("oi, mundo");
    expect(r.mime).toBe("text/plain");
  });

  it("o `Content-Type` do formulário NÃO decide nada", async () => {
    // O navegador manda o tipo que quiser. Aqui um PDF de verdade é anunciado
    // como CSV — e o conteúdo continua mandando.
    const arquivo = new File([pdfDeMentira()], "planilha.csv", { type: "text/csv" });
    const r = await sniffKnowledgeFile(arquivo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mime).toBe("application/pdf");
  });
});
