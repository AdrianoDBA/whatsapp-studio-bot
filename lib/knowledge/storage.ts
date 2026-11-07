/**
 * Os arquivos enviados — o balde `knowledge-docs`.
 *
 * ⚠️ O CAMINHO NÃO É COSMÉTICO, ELE É A SEGURANÇA.
 * As quatro policies do bucket (migration `20260821020000`) leem a PRIMEIRA
 * pasta do caminho como o id do workspace e conferem `is_org_member` /
 * `has_org_role` em cima dela. Mudar a forma de `{org}/{base}/{documento}.{ext}`
 * pra qualquer outra coisa desliga o isolamento entre workspaces no bucket
 * inteiro — sem erro nenhum aparecendo.
 *
 * ⚠️ A PONTE DA AUTOMAÇÃO NÃO SERVE STORAGE (regra R5 do contrato). NADA NESTE
 * ARQUIVO roda dentro do trabalhador da fila: quem chama é sempre uma função
 * do servidor, com sessão de gente de verdade.
 *
 * É por isso que o arquivo enviado NÃO é baixado do balde pelo trabalhador.
 * Quem enfileira pede aqui um endereço temporário (`urlAssinada`, com
 * `SEGUNDOS_DO_LINK_DA_FILA`) e manda o endereço junto no trabalho; lá o
 * trabalhador só faz `baixarDeUrl`, que é um `fetch` comum e não sabe o que é
 * um bucket. Tentar "só dar Storage pra ponte" desfaz o isolamento inteiro.
 *
 * ⚠️ ARQUIVO ÓRFÃO É PROBLEMA CONHECIDO. Envio que deu certo com `insert` que
 * falhou deixa arquivo sem linha. Quem apaga é a função do servidor, no
 * `catch` — best-effort, igual ao envio de logo. NUNCA por gatilho SQL: o
 * Supabase novo recusa `delete from storage.objects` por SQL (está escrito no
 * próprio `reset-dev.sql`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/env";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";
import type { SniffedExt, SniffedMime } from "./mime";

export const KNOWLEDGE_BUCKET = "knowledge-docs" as const;

/** Quanto tempo o endereço de download fica valendo. */
const SEGUNDOS_PADRAO_DA_URL = 300;

/**
 * Quanto tempo vale o endereço que viaja DENTRO do trabalho da fila.
 *
 * Uma hora, e não os 5 minutos do botão "Baixar", porque o trabalho pode
 * esperar: o trabalhador roda UM por vez, e uma tentativa que falha volta pra
 * fila com espera crescente. Cinco minutos fariam o arquivo expirar no meio da
 * própria fila.
 *
 * Não é "pra sempre" de propósito. Trabalho que ficou parado mais que isso
 * falha pedindo pra tentar de novo — e o "Tentar de novo" gera um endereço
 * novo, porque ele passa por uma função do servidor, com sessão de gente.
 */
export const SEGUNDOS_DO_LINK_DA_FILA = 3600;

/**
 * `{organizationId}/{knowledgeBaseId}/{documentId}.{ext}`
 *
 * ⚠️ O `documentId` tem que ser sorteado ANTES do insert (`crypto.randomUUID()`)
 * e gravado no MESMO insert que o `storage_path`: a tabela `documents` não tem
 * `grant update` pra quem está logado, então não existe "insere agora e
 * preenche o caminho depois". Está escrito também na migration.
 */
export function montarCaminho(p: {
  organizationId: string;
  knowledgeBaseId: string;
  documentId: string;
  ext: SniffedExt;
}): string {
  return `${p.organizationId}/${p.knowledgeBaseId}/${p.documentId}.${p.ext}`;
}

export async function enviarArquivo(p: {
  supabase: SupabaseClient<Database>;
  caminho: string;
  bytes: Uint8Array;
  contentType: SniffedMime;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // `Blob` e não `Uint8Array` cru: o cliente do Supabase precisa do
  // `Content-Type` junto, e o bucket recusa o que não estiver na lista de
  // tipos aceitos.
  const corpo = new Blob([new Uint8Array(p.bytes)], { type: p.contentType });

  const { error } = await p.supabase.storage.from(KNOWLEDGE_BUCKET).upload(p.caminho, corpo, {
    contentType: p.contentType,
    upsert: false,
  });

  if (error) {
    logError("knowledge.enviarArquivo", error);
    return {
      ok: false,
      error: "Não deu pra guardar esse arquivo agora. Tente de novo em alguns instantes.",
    };
  }
  return { ok: true };
}

export async function baixarArquivo(p: {
  supabase: SupabaseClient<Database>;
  caminho: string;
}): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const { data, error } = await p.supabase.storage.from(KNOWLEDGE_BUCKET).download(p.caminho);

  if (error || !data) {
    logError("knowledge.baixarArquivo", error);
    return {
      ok: false,
      error: "Não achei mais o arquivo original desse documento. Suba ele de novo pra reindexar.",
    };
  }

  return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
}

/**
 * Baixa o arquivo a partir de um endereço temporário que JÁ VEIO PRONTO.
 *
 * É esta a função que o trabalhador da fila usa — e ela é um `fetch` comum, de
 * propósito: não toca no cliente do Supabase, não pede endereço, não sabe o
 * nome do balde. É assim que indexar arquivo grande virou trabalho de fila sem
 * furar a regra R5 (a ponte da automação não serve Storage).
 *
 * ⚠️ SÓ ACEITA ENDEREÇO DO PRÓPRIO SUPABASE. O endereço chega pelo banco, e
 * "veio do banco" não é o mesmo que "é seguro": sem esta conferência, uma linha
 * de trabalho adulterada faria o container buscar um endereço qualquer da rede
 * interna. Como o endereço é sempre gerado por `urlAssinada`, prender ele à
 * origem do Supabase não custa nada e fecha o buraco.
 */
export async function baixarDeUrl(p: {
  url: string;
  tamanhoMaximoBytes: number;
  signal?: AbortSignal;
}): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const recusado = {
    ok: false,
    error: "Não achei mais o arquivo original desse documento. Suba ele de novo pra reindexar.",
  } as const;

  let origemEsperada: string;
  try {
    origemEsperada = new URL(supabaseUrl()).origin;
  } catch (err) {
    logError("knowledge.baixarDeUrl.env", err);
    return recusado;
  }

  let alvo: URL;
  try {
    alvo = new URL(p.url);
  } catch {
    logError("knowledge.baixarDeUrl", "endereço inválido no trabalho da fila");
    return recusado;
  }
  if (alvo.origin !== origemEsperada) {
    logError("knowledge.baixarDeUrl", "endereço fora do Supabase no trabalho da fila");
    return recusado;
  }

  try {
    // `redirect: "error"` pelo mesmo motivo da conferência de origem: um
    // redirecionamento levaria o `fetch` pra fora do endereço que a gente
    // acabou de aprovar.
    const resposta = await fetch(alvo, { redirect: "error", signal: p.signal });
    if (!resposta.ok || !resposta.body) {
      logError("knowledge.baixarDeUrl", `HTTP ${resposta.status}`);
      return resposta.status === 400 || resposta.status === 404
        ? recusado
        : {
            ok: false,
            error: "Não deu pra baixar o arquivo desse documento agora. Tente de novo.",
          };
    }

    const bytes = new Uint8Array(await resposta.arrayBuffer());
    // O teto do formulário já barra arquivo grande antes de subir. Aqui ele é
    // rede de proteção: é este número que segura a memória do container.
    if (bytes.length > p.tamanhoMaximoBytes) {
      return {
        ok: false,
        error: "Esse arquivo é grande demais pra ler. Divida ele em partes menores.",
      };
    }

    return { ok: true, bytes };
  } catch (err) {
    logError("knowledge.baixarDeUrl", err);
    return { ok: false, error: "Não deu pra baixar o arquivo desse documento agora." };
  }
}

/**
 * Apaga arquivos do balde. BEST-EFFORT: nunca lança.
 *
 * Quem chama está sempre num caminho em que o dado do banco já foi (ou vai
 * ser) apagado — falhar aqui deixaria um arquivo sobrando, o que é chato, mas
 * é infinitamente melhor do que abortar a exclusão pela metade.
 */
export async function removerArquivos(p: {
  supabase: SupabaseClient<Database>;
  caminhos: string[];
}): Promise<void> {
  const caminhos = p.caminhos.filter((c): c is string => typeof c === "string" && c.length > 0);
  if (caminhos.length === 0) return;

  try {
    const { error } = await p.supabase.storage.from(KNOWLEDGE_BUCKET).remove(caminhos);
    if (error) logError("knowledge.removerArquivos", error);
  } catch (err) {
    logError("knowledge.removerArquivos", err);
  }
}

/**
 * Um endereço temporário pra baixar o arquivo.
 *
 * O balde é PRIVADO: não existe endereço público. Cada clique em "Baixar" pede
 * um endereço novo, que vale 5 minutos — assim um link copiado do histórico do
 * navegador não vira um vazamento permanente.
 */
export async function urlAssinada(p: {
  supabase: SupabaseClient<Database>;
  caminho: string;
  segundos?: number;
}): Promise<string | null> {
  const { data, error } = await p.supabase.storage
    .from(KNOWLEDGE_BUCKET)
    .createSignedUrl(p.caminho, p.segundos ?? SEGUNDOS_PADRAO_DA_URL);

  if (error || !data?.signedUrl) {
    logError("knowledge.urlAssinada", error);
    return null;
  }
  return data.signedUrl;
}
