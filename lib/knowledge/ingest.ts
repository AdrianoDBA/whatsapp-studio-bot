/**
 * A INDEXAÇÃO — pegar um documento que está "esperando" e deixar ele "pronto".
 *
 * O caminho, em seis passos:
 *
 *   1. lê a linha do documento e a base dona dele;
 *   2. marca "processando" (`start_document_processing`) — e é essa função do
 *      banco que impede dois cliques indexarem (e COBRAREM) duas vezes;
 *   3. pega o texto: do campo `content` (texto colado) ou do arquivo no balde;
 *   4. recorta em pedaços;
 *   5. manda os pedaços em lotes de 32 pro provedor e grava cada lote com
 *      `append_document_chunks`;
 *   6. fecha com `finish_document_indexing` (que CONTA os pedaços na própria
 *      tabela) ou com `fail_document`.
 *
 * ⚠️ ESTA FUNÇÃO NUNCA LANÇA. Nunca. Ela é chamada de dentro de uma função do
 * servidor, e toda falha precisa virar `documents.status = 'failed'` com uma
 * frase em português na tela — porque é isso que faz o botão "Tentar de novo"
 * ter sentido. Exceção vazando daqui deixaria o documento parado em
 * "Processando" pra sempre, sem ninguém saber por quê.
 *
 * ⚠️ ELA RODA NOS DOIS LUGARES, e o passo 3 é o único que sente a diferença.
 *
 *   • TEXTO COLADO roda na hora, dentro da requisição: o texto já está na linha
 *     do documento, não tem arquivo pra baixar, e o formulário limita o
 *     tamanho.
 *   • ARQUIVO ENVIADO roda no TRABALHADOR, pela fila — senão um PDF de 50
 *     páginas estoura o corte de 60 s do proxy.
 *
 * E arquivo pela fila só funciona por causa de um detalhe: a ponte da automação
 * NÃO SERVE STORAGE (regra R5 do contrato), então o trabalhador não consegue
 * baixar nada do balde. Quem enfileira (uma função do servidor, com sessão de
 * gente) gera um endereço temporário e manda junto no trabalho; aqui o
 * `downloadUrl` chega preenchido e o passo 3 usa `baixarDeUrl` — um `fetch`
 * comum — em vez do cliente do Supabase.
 *
 * ⚠️ ESQUECER DE PASSAR O `downloadUrl` NA FILA faz TODO arquivo enviado falhar
 * com "Não achei mais o arquivo original desse documento". Já aconteceu: a fila
 * entrou numa migration e o endereço só veio depois.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiConfigError } from "@/lib/ai/errors";
import { resolveEmbeddingModel } from "@/lib/ai/resolve";
import type { ResolvedEmbeddingModel } from "@/lib/ai/types";
import { budgetBlockedMessageFromStatus } from "@/lib/limits/messages";
import { getBudgetStatus } from "@/lib/limits/queries";
import { logError } from "@/lib/logger";
import { isVaultError, vaultErrorMessage } from "@/lib/secrets";
import type { Database } from "@/types/supabase";
import { type Pedaco, recortarTexto } from "./chunk";
import { emLotes, gerarEmbeddings, LOTE_EMBEDDING, vetorParaTexto } from "./embed";
import { extrairTexto } from "./extract";
import { KNOWLEDGE_MAX_BYTES, type SniffedMime } from "./mime";
import { baixarArquivo, baixarDeUrl } from "./storage";

export type IngestOutcome =
  | { ok: true; documentId: string; pedacos: number; tokens: number; costMicros: number | null }
  /** `error` JÁ em PT-BR leigo: é o que a tela mostra. */
  | { ok: false; documentId: string; error: string };

/** Fecha o documento como falha, com a frase que o aluno vai ler. */
async function marcarFalha(
  supabase: SupabaseClient<Database>,
  documentId: string,
  mensagem: string,
): Promise<IngestOutcome> {
  const { error } = await supabase.rpc("fail_document", {
    _document_id: documentId,
    _motivo: mensagem.slice(0, 500),
  });
  if (error) logError("knowledge.marcarFalha", error);
  return { ok: false, documentId, error: mensagem };
}

export async function processarDocumento(params: {
  supabase: SupabaseClient<Database>;
  documentId: string;
  /**
   * O endereço temporário do arquivo, quando quem chama é o TRABALHADOR.
   *
   * Vem preenchido pela fila (`jobs.payload.downloadUrl`) e vazio quando a
   * chamada é da tela. É essa diferença que decide como o arquivo é baixado:
   * com endereço, um `fetch` comum; sem endereço, o cliente do Supabase.
   */
  downloadUrl?: string | null;
  signal?: AbortSignal;
}): Promise<IngestOutcome> {
  const { supabase, documentId, downloadUrl } = params;

  try {
    // -----------------------------------------------------------------------
    // 1. O documento e a base dona dele
    // -----------------------------------------------------------------------
    const { data: doc, error: erroDoDoc } = await supabase
      .from("documents")
      .select(
        "id, organization_id, knowledge_base_id, title, source_kind, storage_path, mime_type, content, status",
      )
      .eq("id", documentId)
      .maybeSingle();

    if (erroDoDoc) {
      logError("knowledge.processarDocumento.doc", erroDoDoc);
      return { ok: false, documentId, error: "Não deu pra abrir esse documento agora." };
    }
    if (!doc) {
      return { ok: false, documentId, error: "Esse documento não existe mais." };
    }

    const { data: base, error: erroDaBase } = await supabase
      .from("knowledge_bases")
      .select("id, name, embedding_model, status")
      .eq("id", doc.knowledge_base_id)
      .maybeSingle();

    if (erroDaBase || !base) {
      logError("knowledge.processarDocumento.base", erroDaBase);
      return marcarFalha(
        supabase,
        documentId,
        "A base de conhecimento desse documento não existe mais.",
      );
    }

    // Base APOSENTADA não lê documento novo. Ler custa dinheiro (é a IA que lê
    // o arquivo), e gastar pra indexar numa base que o agente nem consulta é
    // gasto sem retorno nenhum. O que já estava indexado fica onde está.
    if (base.status === "archived") {
      return marcarFalha(
        supabase,
        documentId,
        `A base "${base.name}" está aposentada e não recebe documento novo. ` +
          "Pra voltar a usá-la, peça pro Claude Code declarar ela como ativa de novo.",
      );
    }

    // -----------------------------------------------------------------------
    // 1b. O TETO DE GASTO — porque INDEXAR TAMBÉM GASTA
    // -----------------------------------------------------------------------
    // Quase ninguém sabe disso: quem lê o arquivo pra deixar ele pesquisável é
    // a IA, e ela cobra por isso. Se a indexação ficasse fora do teto, o teto
    // teria um buraco do tamanho de um PDF.
    //
    // Confere ANTES de marcar "processando": documento que nem começou a ser
    // lido não pode ficar preso em "Lendo...".
    //
    // ⚠️ CONSEQUÊNCIA CONHECIDA no caminho "Tentar de novo": `queue_document`
    // já apagou os trechos antigos antes de chegar aqui, então um documento que
    // esbarra no teto agora fica sem índice até alguém tentar de novo. É o
    // mesmo que acontece com qualquer outra falha de releitura.
    const teto = await getBudgetStatus({ organizationId: doc.organization_id, supabase });
    if (teto?.blocked) {
      return marcarFalha(supabase, documentId, budgetBlockedMessageFromStatus(teto, "documento"));
    }

    // -----------------------------------------------------------------------
    // 2. "Processando" — e a trava contra indexar duas vezes
    // -----------------------------------------------------------------------
    const { data: comecou, error: erroDoComeco } = await supabase.rpc("start_document_processing", {
      _document_id: documentId,
    });

    if (erroDoComeco) {
      logError("knowledge.processarDocumento.start", erroDoComeco);
      return { ok: false, documentId, error: "Não deu pra começar a leitura desse arquivo." };
    }
    if (comecou === false) {
      // Não é erro: é o segundo clique chegando. Devolver uma frase calma aqui
      // é melhor do que marcar o documento como falho e assustar quem clicou.
      return {
        ok: false,
        documentId,
        error: "Esse documento já está sendo lido. Aguarde um instante e atualize a página.",
      };
    }

    // -----------------------------------------------------------------------
    // 3. O modelo de embedding — o da BASE, congelado, nunca um padrão
    // -----------------------------------------------------------------------
    let modelo: ResolvedEmbeddingModel;
    try {
      modelo = await resolveEmbeddingModel({
        modelId: base.embedding_model,
        organizationId: doc.organization_id,
        supabase,
      });
    } catch (err) {
      if (isAiConfigError(err)) {
        logError("knowledge.processarDocumento.modelo", err);
        return marcarFalha(supabase, documentId, err.mensagemLeiga);
      }
      if (isVaultError(err)) {
        logError("knowledge.processarDocumento.cofre", err);
        return marcarFalha(supabase, documentId, vaultErrorMessage(err.code));
      }
      logError("knowledge.processarDocumento.modelo", err);
      return marcarFalha(
        supabase,
        documentId,
        "Não deu pra preparar a leitura desse documento. Confira a chave em Configurações → " +
          "Integrações e tente de novo.",
      );
    }

    // -----------------------------------------------------------------------
    // 4. O texto
    // -----------------------------------------------------------------------
    let texto: string;

    if (doc.source_kind === "text") {
      if (!doc.content || doc.content.trim().length === 0) {
        return marcarFalha(supabase, documentId, "Esse documento está sem texto nenhum dentro.");
      }
      texto = doc.content;
    } else {
      if (!doc.storage_path) {
        return marcarFalha(
          supabase,
          documentId,
          "Não achei o arquivo original desse documento. Suba ele de novo.",
        );
      }
      // DOIS CAMINHOS, e a diferença é quem está chamando:
      //
      //   • da TELA (texto colado, "Tentar de novo" na hora): `supabase` é uma
      //     sessão de gente de verdade e fala com o balde direto;
      //   • do TRABALHADOR: `supabase` é a ponte da automação, que NÃO SERVE
      //     STORAGE (regra R5). Por isso o endereço já vem pronto no trabalho,
      //     gerado por quem enfileirou, e aqui é só um `fetch`.
      //
      // ⚠️ Sem isso, todo arquivo enviado falhava com "Não achei mais o arquivo
      // original". Não junte os dois num só: o trabalhador não tem como pedir
      // endereço nenhum pro Storage.
      const baixado = downloadUrl
        ? await baixarDeUrl({
            url: downloadUrl,
            tamanhoMaximoBytes: KNOWLEDGE_MAX_BYTES,
            signal: params.signal,
          })
        : await baixarArquivo({ supabase, caminho: doc.storage_path });
      if (!baixado.ok) return marcarFalha(supabase, documentId, baixado.error);

      const extraido = await extrairTexto({
        mime: (doc.mime_type ?? "text/plain") as SniffedMime,
        bytes: baixado.bytes,
        textoJaDecodificado: null,
      });
      if (!extraido.ok) return marcarFalha(supabase, documentId, extraido.motivo);
      texto = extraido.texto;
    }

    // -----------------------------------------------------------------------
    // 5. O recorte
    // -----------------------------------------------------------------------
    const recorte = recortarTexto(texto);
    if (!recorte.ok) return marcarFalha(supabase, documentId, recorte.motivo);

    // -----------------------------------------------------------------------
    // 6. Embedding + gravação, lote a lote
    // -----------------------------------------------------------------------
    let tokensTotais = 0;
    let custoTotal: number | null = 0;
    let gravados = 0;

    for (const lote of emLotes(recorte.pedacos, LOTE_EMBEDDING)) {
      if (params.signal?.aborted) {
        return marcarFalha(
          supabase,
          documentId,
          "A leitura demorou demais e foi interrompida. Divida o arquivo em partes menores.",
        );
      }

      let vetores: number[][];
      try {
        const resultado = await gerarEmbeddings({
          modelo,
          textos: lote.map((p) => p.content),
          signal: params.signal,
        });
        vetores = resultado.vetores;
        tokensTotais += resultado.tokens;
        // Um único lote sem preço deixa o TOTAL desconhecido. Somar como zero
        // faria a tela mostrar um custo menor do que o real.
        custoTotal =
          custoTotal === null || resultado.costMicros === null
            ? null
            : custoTotal + resultado.costMicros;
      } catch (err) {
        logError("knowledge.processarDocumento.embed", err);

        // O QUE JÁ FOI PAGO TEM QUE ENTRAR NO MEDIDOR, MESMO FALHANDO.
        //
        // Falhar no lote 40 de 50 não devolve o dinheiro dos 39 primeiros: o
        // provedor já cobrou. Antes esse custo era acumulado só em memória e
        // ia embora junto com o erro — e como o caso comum é falta de crédito,
        // era exatamente na hora de estourar a conta que o medidor parava de
        // enxergar o gasto.
        if (custoTotal !== null && custoTotal > 0) {
          const { error: erroDoMedidor } = await supabase.rpc("org_ai_spend_add", {
            _organization_id: doc.organization_id,
            _agent_micros: 0,
            _embedding_micros: custoTotal,
            _unpriced_runs: 0,
            _unpriced_documents: 0,
          });
          if (erroDoMedidor) logError("knowledge.processarDocumento.medidor", erroDoMedidor);
        }

        return marcarFalha(
          supabase,
          documentId,
          "O serviço de IA não conseguiu ler esse documento agora. Isso costuma ser falta de " +
            "crédito na conta do provedor ou instabilidade momentânea — confira e clique em " +
            '"Tentar de novo".',
        );
      }

      const paraGravar = lote.map((p: Pedaco, i) => ({
        seq: p.seq,
        content: p.content,
        embedding: vetorParaTexto(vetores[i] ?? []),
        tokens: p.tokens,
      }));

      const { error: erroDoLote } = await supabase.rpc("append_document_chunks", {
        _document_id: documentId,
        _chunks: paraGravar,
      });

      if (erroDoLote) {
        logError("knowledge.processarDocumento.append", erroDoLote);
        return marcarFalha(
          supabase,
          documentId,
          "Não deu pra guardar os pedaços desse documento. Tente de novo.",
        );
      }
      gravados += paraGravar.length;
    }

    if (gravados === 0) {
      return marcarFalha(supabase, documentId, "Não achei texto nenhum pra indexar aqui dentro.");
    }

    // -----------------------------------------------------------------------
    // 7. Fecha
    // -----------------------------------------------------------------------
    // ⚠️ A CONTAGEM DE PEDAÇOS NÃO VAI DAQUI: a função do banco conta lendo a
    // própria tabela. O que vai por parâmetro é token e custo, porque só o
    // provedor sabe — mesma disciplina de `agent_run_steps` (ver C24/C25 do
    // contrato).
    const { error: erroDoFecho } = await supabase.rpc("finish_document_indexing", {
      _document_id: documentId,
      _embedding_model: modelo.modelId,
      _embed_tokens: Math.min(tokensTotais, 2_147_483_647),
      _embed_cost_micros: custoTotal ?? undefined,
    });

    if (erroDoFecho) {
      logError("knowledge.processarDocumento.finish", erroDoFecho);
      return marcarFalha(
        supabase,
        documentId,
        "Os pedaços foram guardados, mas não deu pra fechar a leitura. Clique em " +
          '"Tentar de novo".',
      );
    }

    return {
      ok: true,
      documentId,
      pedacos: gravados,
      tokens: tokensTotais,
      costMicros: custoTotal,
    };
  } catch (err) {
    // A rede de segurança final. Se algo escapar, o documento NÃO pode ficar
    // parado em "Processando".
    logError("knowledge.processarDocumento", err);
    return marcarFalha(
      supabase,
      documentId,
      "Deu um problema inesperado ao ler esse documento. Tente de novo; se continuar, " +
        "divida o arquivo em partes menores.",
    );
  }
}
