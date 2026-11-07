"use server";

/**
 * As funções do servidor da base de conhecimento.
 *
 * ⚠️ TODA FUNÇÃO AQUI CHAMA O GUARD DENTRO DELA MESMA.
 * Função marcada com "use server" é um endereço público da internet: dá pra
 * chamar sem passar pela tela. "A tela só mostra o botão pra quem pode" não
 * protege nada sozinho — e aqui a RLS também recusaria, mas a mensagem que ela
 * devolve não diz nada pra um leigo.
 *
 * ⚠️ INDEXAR ARQUIVO É TRABALHO DE FILA; TEXTO COLADO É NA HORA.
 * Um PDF de 50 páginas vira dezenas de chamadas de embedding em série, e o
 * proxy do EasyPanel corta requisição parada em ~60 s — por isso o arquivo vai
 * pra fila. Texto colado já chega pronto na linha do documento e não tem esse
 * risco, então continua rodando aqui dentro.
 *
 * ⚠️ QUEM ENFILEIRA ARQUIVO TEM QUE MANDAR O ENDEREÇO DELE JUNTO
 * (`urlAssinada` + `_download_url`). A ponte da automação não serve Storage
 * (regra R5 do contrato): o trabalhador NÃO consegue pedir endereço nenhum pro
 * balde, e esta função é o único ponto do caminho com sessão de gente de
 * verdade pra fazer isso. Esquecer faz TODO arquivo enviado falhar com "Não
 * achei mais o arquivo original desse documento" — já aconteceu.
 *
 * ⚠️ O `id` DO DOCUMENTO É SORTEADO AQUI, ANTES DO INSERT.
 * O caminho no balde é `{org}/{base}/{documento}.{ext}`, e a tabela
 * `documents` NÃO tem `grant update` pra quem está logado: não existe "insere
 * agora, preenche o caminho depois". Sortear o `id` no TypeScript é o que
 * permite gravar o caminho no MESMO insert. Está escrito também na migration.
 */
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireOrgMember, requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { processarDocumento } from "./ingest";
import { sniffKnowledgeFile } from "./mime";
import { getKnowledgeBaseBySlug } from "./queries";
import {
  type AcaoEmDocumentoInput,
  acaoEmDocumentoSchema,
  type BuscarNaBaseInput,
  buscarNaBaseSchema,
  type CriarDocumentoDeTextoInput,
  criarDocumentoDeTextoSchema,
} from "./schemas";
import { searchKnowledgeBase } from "./search";
import {
  enviarArquivo,
  montarCaminho,
  removerArquivos,
  SEGUNDOS_DO_LINK_DA_FILA,
  urlAssinada,
} from "./storage";
import type { DocumentStatus, KnowledgeSearchHit } from "./types";

/**
 * Teto de documentos por base. NÚMERO NOSSO, não do contrato — escrito aqui em
 * cima, pra quem for mexer não precisar caçar.
 *
 * Existe por um motivo bem prático: a listagem de documentos traz 500 linhas.
 * Sem teto, um script subindo documento em laço deixaria a tela lenta pra todo
 * mundo do workspace.
 */
const MAX_DOCUMENTOS_POR_BASE = 500;

/** A frase padrão de "confira e tente de novo". */
function primeiroErro(issues: Array<{ message: string }>): string {
  return issues[0]?.message ?? "Confira os dados e tente de novo.";
}

// =============================================================================
// Bases — não têm função do servidor. Uma base nasce de arquivo
// (`lib/knowledge/blueprint.ts`) e é gravada por `materializarWorkspace`.
// Nome e descrição são re-materializados quando o arquivo muda; slug e
// modelo de embedding são congelados por gatilho assim que a base nasce; e o
// materializador NUNCA apaga. Pra tirar uma base de circulação sem perder o
// que já foi indexado, o arquivo declara `status: "archived"` — ela some da
// busca do agente e para de aceitar documento novo (regra 10-P).
// =============================================================================

// =============================================================================
// Documentos
// =============================================================================

/** Contagem de documentos da base, pro teto. */
async function documentosDemais(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  kbId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("knowledge_base_id", kbId);
  return (count ?? 0) >= MAX_DOCUMENTOS_POR_BASE;
}

/**
 * O envio de arquivo.
 *
 * A ordem NÃO é arbitrária:
 *   1. confere permissão e acha a base;
 *   2. **cheira os bytes** (nunca a extensão do nome — regra 7 do CLAUDE.md);
 *   3. sorteia o `id` do documento e monta o caminho no balde;
 *   4. sobe o arquivo;
 *   5. grava a linha COM o caminho (mesmo insert — ver o aviso do topo);
 *   6. se o insert falhar, apaga o arquivo que acabou de subir;
 *   7. indexa na hora.
 */
export async function uploadDocumentAction(
  orgSlug: string,
  formData: FormData,
): Promise<ActionResult<{ documentId: string; status: DocumentStatus }>> {
  if (typeof orgSlug !== "string" || orgSlug.trim().length === 0) {
    return { ok: false, error: "Workspace não informado." };
  }

  const { user, org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  const baseSlug = formData.get("baseSlug");
  const arquivo = formData.get("arquivo");

  if (typeof baseSlug !== "string" || baseSlug.length === 0) {
    return { ok: false, error: "Não achei em qual base guardar esse arquivo." };
  }
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, error: "Escolha um arquivo antes de enviar." };
  }

  const supabase = await createClient();
  const base = await getKnowledgeBaseBySlug(supabase, org.id, baseSlug);
  if (!base) return { ok: false, error: "Essa base não existe mais." };
  // Base APOSENTADA não recebe documento novo. Recusa AQUI, antes de o arquivo
  // subir pro balde: aceitar e falhar depois deixaria lixo no Storage e o
  // documento parado em "Falhou" por um motivo que não é culpa de ninguém.
  if (base.status === "archived") {
    return {
      ok: false,
      error:
        `A base "${base.name}" está aposentada e não recebe documento novo. ` +
        "Peça pro Claude Code declarar ela como ativa de novo.",
    };
  }

  if (await documentosDemais(supabase, org.id, base.id)) {
    return {
      ok: false,
      error:
        `Essa base já tem ${MAX_DOCUMENTOS_POR_BASE} documentos, que é o limite. ` +
        "Apague algum que não usa mais, ou peça pro Claude Code declarar outra base.",
    };
  }

  // 2. O conteúdo decide o tipo. O nome do arquivo e o `Content-Type` do
  // formulário são texto digitado por quem está do outro lado.
  const cheirado = await sniffKnowledgeFile(arquivo);
  if (!cheirado.ok) return { ok: false, error: cheirado.motivo };

  const titulo = tituloDoArquivo(arquivo.name);

  // 3 e 4. O id vem ANTES do insert porque o caminho depende dele.
  const documentId = crypto.randomUUID();
  const caminho = montarCaminho({
    organizationId: org.id,
    knowledgeBaseId: base.id,
    documentId,
    ext: cheirado.ext,
  });

  const enviado = await enviarArquivo({
    supabase,
    caminho,
    bytes: cheirado.bytes,
    contentType: cheirado.mime,
  });
  if (!enviado.ok) return { ok: false, error: enviado.error };

  // 5. A linha, com o caminho junto.
  const { error } = await supabase.from("documents").insert({
    id: documentId,
    organization_id: org.id,
    knowledge_base_id: base.id,
    created_by: user.id,
    title: titulo,
    source_kind: "upload",
    storage_path: caminho,
    mime_type: cheirado.mime,
    byte_size: cheirado.bytes.length,
    status: "pending",
  });

  if (error) {
    // 6. Arquivo órfão é o defeito conhecido deste caminho. Limpar aqui é o
    // mesmo que o envio de logo faz.
    logError("knowledge.uploadDocument", error);
    await removerArquivos({ supabase, caminhos: [caminho] });
    return { ok: false, error: "Não deu pra guardar esse documento agora. Tente de novo." };
  }

  // 7. ENFILEIRA a leitura — não lê aqui.
  //
  // Ler aqui era o desvio: um PDF de 50 páginas vira dezenas de chamadas de
  // embedding em série, e o proxy do EasyPanel corta requisição parada em 60
  // segundos. O aluno via erro de rede e o documento ficava "Lendo..." pra
  // sempre. Quem lê agora é o trabalhador, que roda fora da requisição.
  //
  // ⚠️ O ENDEREÇO DO ARQUIVO VAI JUNTO, e não é opcional: a ponte da automação
  // não serve Storage (regra R5), então o trabalhador não tem como baixar nada
  // do balde. Este é o único ponto do caminho em que existe uma sessão de gente
  // de verdade pra pedir o endereço. Sem ele, TODO arquivo enviado falha com
  // "Não achei mais o arquivo original desse documento" — foi exatamente o que
  // aconteceu quando a fila entrou sem esta linha.
  const enderecoDoArquivo = await urlAssinada({
    supabase,
    caminho,
    segundos: SEGUNDOS_DO_LINK_DA_FILA,
  });

  if (!enderecoDoArquivo) {
    // O arquivo subiu e a linha está gravada: dá pra sair dessa pelo "Tentar de
    // novo", que gera um endereço novo. Melhor isso do que apagar o envio.
    logError("knowledge.uploadDocument.endereco", "não consegui assinar o endereço do arquivo");
    return { ok: true, data: { documentId, status: "pending" } };
  }

  const { error: erroDaFila } = await supabase.rpc("enqueue_document_job", {
    _document_id: documentId,
    _download_url: enderecoDoArquivo,
  });

  if (erroDaFila) {
    logError("knowledge.uploadDocument.fila", erroDaFila);
    // O documento JÁ está gravado como "na fila". Não é erro de formulário: a
    // tela mostra a linha, e o botão "tentar de novo" resolve.
    return {
      ok: true,
      data: { documentId, status: "pending" },
    };
  }

  revalidatePath(`/app/${orgSlug}/conhecimento`);
  revalidatePath(`/app/${orgSlug}/conhecimento/${baseSlug}`);

  return {
    ok: true,
    data: { documentId, status: "pending" },
  };
}

/** "Politica-de-Ferias.PDF" → "Politica-de-Ferias" */
function tituloDoArquivo(nome: string): string {
  const semCaminho = nome.split(/[\\/]/).pop() ?? nome;
  const corte = semCaminho.lastIndexOf(".");
  const base = (corte > 0 ? semCaminho.slice(0, corte) : semCaminho).trim();
  return (base.length > 0 ? base : "Documento").slice(0, 200);
}

/**
 * O texto colado.
 *
 * Existe pra o PDF nunca ser um bloqueio duro: PDF escaneado, arquivo com
 * senha, Word — em todos esses casos a saída é abrir, copiar e colar aqui.
 */
export async function createTextDocumentAction(
  input: CriarDocumentoDeTextoInput,
): Promise<ActionResult<{ documentId: string; status: DocumentStatus }>> {
  const parsed = criarDocumentoDeTextoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { user, org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const supabase = await createClient();
  const base = await getKnowledgeBaseBySlug(supabase, org.id, parsed.data.baseSlug);
  if (!base) return { ok: false, error: "Essa base não existe mais." };
  // Base APOSENTADA não recebe documento novo. Recusa AQUI, antes de o arquivo
  // subir pro balde: aceitar e falhar depois deixaria lixo no Storage e o
  // documento parado em "Falhou" por um motivo que não é culpa de ninguém.
  if (base.status === "archived") {
    return {
      ok: false,
      error:
        `A base "${base.name}" está aposentada e não recebe documento novo. ` +
        "Peça pro Claude Code declarar ela como ativa de novo.",
    };
  }

  if (await documentosDemais(supabase, org.id, base.id)) {
    return {
      ok: false,
      error:
        `Essa base já tem ${MAX_DOCUMENTOS_POR_BASE} documentos, que é o limite. ` +
        "Apague algum que não usa mais, ou peça pro Claude Code declarar outra base.",
    };
  }

  const documentId = crypto.randomUUID();
  const { error } = await supabase.from("documents").insert({
    id: documentId,
    organization_id: org.id,
    knowledge_base_id: base.id,
    created_by: user.id,
    title: parsed.data.title,
    source_kind: "text",
    // Guardado pra "Tentar de novo" conseguir reindexar sem pedir pra pessoa
    // colar tudo outra vez.
    content: parsed.data.content,
    // BYTES, não letras: um texto com acento ocupa mais que `length`.
    byte_size: new TextEncoder().encode(parsed.data.content).length,
    mime_type: "text/plain",
    status: "pending",
  });

  if (error) {
    logError("knowledge.createTextDocument", error);
    return { ok: false, error: "Não deu pra guardar esse texto agora. Tente de novo." };
  }

  const resultado = await processarDocumento({ supabase, documentId });

  revalidatePath(`/app/${parsed.data.orgSlug}/conhecimento`);
  revalidatePath(`/app/${parsed.data.orgSlug}/conhecimento/${parsed.data.baseSlug}`);

  return { ok: true, data: { documentId, status: resultado.ok ? "ready" : "failed" } };
}

/**
 * "Tentar de novo".
 *
 * `queue_document` volta o documento pro começo E APAGA OS PEDAÇOS ANTIGOS —
 * sem isso, reindexar deixaria pedaço velho misturado com pedaço novo, e a
 * busca passaria a devolver as duas versões do mesmo trecho.
 */
/**
 * Depois de quanto tempo parado a gente considera que a leitura foi abandonada.
 *
 * O MESMO número está na função `queue_document` do banco, que é quem manda de
 * verdade. Aqui ele existe só pra mensagem na tela sair certa.
 */
const MINUTOS_ATE_CONSIDERAR_ABANDONADA = 10;

function leituraAbandonada(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  const parado = Date.now() - new Date(updatedAt).getTime();
  return parado > MINUTOS_ATE_CONSIDERAR_ABANDONADA * 60_000;
}

export async function retryDocumentAction(input: AcaoEmDocumentoInput): Promise<ActionResult> {
  const parsed = acaoEmDocumentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    // `storage_path` entra porque reler um ARQUIVO exige gerar um endereço
    // novo pra fila — o endereço antigo já expirou, e o trabalhador não sabe
    // pedir um (a ponte não serve Storage).
    .select("id, knowledge_base_id, status, updated_at, source_kind, storage_path")
    .eq("organization_id", org.id)
    .eq("id", parsed.data.documentId)
    .maybeSingle();

  if (!doc) return { ok: false, error: "Esse documento não existe mais." };

  // Leitura em andamento DE VERDADE não é interrompida — recomeçar agora
  // geraria dois conjuntos de pedaços do mesmo arquivo e cobraria o embedding
  // duas vezes.
  //
  // Mas "em andamento" tem prazo. Se o processo morreu no meio (deploy,
  // reinício do container, queda), a linha ficava marcada como "Lendo..." PARA
  // SEMPRE — e as duas camadas travavam a saída: o botão desligado e esta
  // função recusando. O documento virava um beco sem saída.
  if (doc.status === "processing" && !leituraAbandonada(doc.updated_at)) {
    return {
      ok: false,
      error: "Esse documento já está sendo lido agora. Aguarde um instante e atualize a página.",
    };
  }

  const { error } = await supabase.rpc("queue_document", { _document_id: doc.id });
  if (error) {
    logError("knowledge.retryDocument", error);
    return { ok: false, error: "Não deu pra recomeçar a leitura desse documento agora." };
  }

  // Texto colado não tem arquivo: vai pra fila sem endereço, e o trabalhador lê
  // o campo `content` da própria linha.
  let enderecoDoArquivo: string | null = null;
  if (doc.storage_path) {
    enderecoDoArquivo = await urlAssinada({
      supabase,
      caminho: doc.storage_path,
      segundos: SEGUNDOS_DO_LINK_DA_FILA,
    });
    if (!enderecoDoArquivo) {
      logError("knowledge.retryDocument.endereco", "não consegui assinar o endereço do arquivo");
      return {
        ok: false,
        error: "Não deu pra abrir o arquivo desse documento agora. Tente de novo em um minuto.",
      };
    }
  }

  const { error: erroDaFila } = await supabase.rpc("enqueue_document_job", {
    _document_id: doc.id,
    // `?? undefined`: o parâmetro no banco é `default null`, então omitir e
    // mandar `null` dão o mesmo resultado — só ajusta o tipo depois que
    // `npm run types:local` passou a descrever esse argumento sem `| null`
    // (mesma função, sem mudança de contrato; só o gerador de tipos local
    // descreve esse argumento opcional de um jeito mais estrito que antes).
    _download_url: enderecoDoArquivo ?? undefined,
  });
  if (erroDaFila) {
    logError("knowledge.retryDocument.fila", erroDaFila);
    return {
      ok: false,
      error: "Não deu pra pôr esse documento na fila agora. Tente de novo em um minuto.",
    };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/conhecimento`);

  // A leitura agora acontece na fila, então aqui só dá pra dizer que ela foi
  // pedida. O resultado aparece na própria linha do documento quando o
  // trabalhador terminar.
  return { ok: true };
}

export async function deleteDocumentAction(input: AcaoEmDocumentoInput): Promise<ActionResult> {
  const parsed = acaoEmDocumentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("organization_id", org.id)
    .eq("id", parsed.data.documentId)
    .maybeSingle();

  if (!doc) return { ok: true };

  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("organization_id", org.id)
    .eq("id", doc.id);

  if (error) {
    logError("knowledge.deleteDocument", error);
    return { ok: false, error: "Não deu pra apagar esse documento agora. Tente de novo." };
  }

  await removerArquivos({ supabase, caminhos: doc.storage_path ? [doc.storage_path] : [] });

  revalidatePath(`/app/${parsed.data.orgSlug}/conhecimento`);
  return { ok: true };
}

/**
 * Um endereço temporário pra baixar o arquivo original.
 *
 * O balde é PRIVADO: cada clique pede um endereço novo, que vale 5 minutos.
 * Assim um link copiado do histórico do navegador não vira um vazamento
 * permanente.
 */
export async function signedDocumentUrlAction(
  input: AcaoEmDocumentoInput,
): Promise<ActionResult<{ url: string }>> {
  const parsed = acaoEmDocumentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  // Baixar é leitura: qualquer membro do workspace pode. É a mesma regra da
  // policy de SELECT do bucket.
  const { org } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("organization_id", org.id)
    .eq("id", parsed.data.documentId)
    .maybeSingle();

  if (!doc?.storage_path) {
    return { ok: false, error: "Esse documento não tem arquivo pra baixar (foi texto colado)." };
  }

  const url = await urlAssinada({ supabase, caminho: doc.storage_path });
  if (!url) {
    return { ok: false, error: "Não deu pra preparar o download agora. Tente de novo." };
  }
  return { ok: true, data: { url } };
}

// =============================================================================
// Busca
// =============================================================================

/**
 * O "Testar busca" da tela — e o jeito mais rápido de descobrir se o
 * documento certo foi indexado.
 *
 * Qualquer membro pode buscar: é leitura, e a policy de SELECT de
 * `document_chunks` já libera pra membro. Quem administra é que sobe e apaga.
 */
export async function searchKnowledgeBaseAction(
  input: BuscarNaBaseInput,
): Promise<ActionResult<{ hits: KnowledgeSearchHit[] }>> {
  const parsed = buscarNaBaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { org } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });

  const supabase = await createClient();

  try {
    const resultado = await searchKnowledgeBase({
      supabase,
      organizationId: org.id,
      baseSlug: parsed.data.baseSlug,
      query: parsed.data.pergunta,
    });
    return { ok: true, data: { hits: resultado.hits } };
  } catch (err) {
    // `searchKnowledgeBase` levanta com a frase JÁ em português (ela embrulha
    // erro de banco, de cofre e de provedor). O `logError` aqui é a segunda
    // cópia, pro registro do servidor.
    logError("knowledge.searchAction", err);
    return {
      ok: false,
      error:
        err instanceof Error && err.message.length >= 12
          ? err.message
          : "Não deu pra procurar agora. Tente de novo.",
    };
  }
}
