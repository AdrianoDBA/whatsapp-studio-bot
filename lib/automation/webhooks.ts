/**
 * WEBHOOK: o endereço secreto que faz um sistema de fora disparar um agente.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ O TOKEN APARECE UMA VEZ SÓ.                                             │
 * │ Ele é sorteado aqui, mostrado na tela na hora da criação, e o banco      │
 * │ guarda SÓ o sha256 dele. Não existe "mostrar de novo": perdeu, cria      │
 * │ outro. É a mesma disciplina de senha — e é o que faz um vazamento do     │
 * │ banco não virar acesso aos agentes de todo mundo.                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * As quatro defesas (ameaça T14 do contrato):
 *
 *  1. **32 bytes sorteados** (`randomBytes`), não `Math.random()`. São 256
 *     bits: adivinhar por tentativa está fora de cogitação.
 *  2. **Só o sha256 é guardado**, e a coluna `token_hash` está fora do
 *     `grant select` de quem está logado.
 *  3. **Comparação em tempo constante** (`timingSafeEqual`). Comparar com
 *     `===` vazaria, pelo tempo de resposta, quantos caracteres do começo
 *     estavam certos — e aí o ataque vira caractere por caractere.
 *  4. **Endpoint que não existe é comparado contra um hash falso**, pra
 *     responder no MESMO tempo de um token errado. Sem isso, o relógio conta
 *     quais endereços existem.
 *
 * O limite de chamadas é contado NO BANCO (`webhook_touch`), e não na memória
 * do processo: com duas cópias do app no ar, cada uma contaria metade.
 *
 * ⚠️ FALA COM O BANCO (por `queue.ts`). Não importe de um componente com
 * `"use client"` — importe os TIPOS de `./types`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { logError } from "@/lib/logger";
import { webhookEndpointForCheck, webhookTouch } from "./queue";
import type { TokenNovo, VerificacaoWebhook } from "./types";

/**
 * O prefixo do token. Serve pra pessoa reconhecer o que ela colou num campo
 * ("isso aqui é um token de webhook do meu app"), e pra varredura de segredo
 * de repositório saber o que procurar.
 */
export const PREFIXO_DO_TOKEN = "whk_";

/** Quantos caracteres do token ficam visíveis na tela pra identificar qual é. */
export const TAMANHO_DO_APELIDO_DO_TOKEN = 12;

/** Quantas chamadas um endpoint aceita por minuto. Contado no banco. */
export const LIMITE_DE_CHAMADAS_POR_MINUTO = 60;

/** Teto do corpo que a rota aceita: 64 KB. */
export const MAX_CORPO_DO_WEBHOOK_BYTES = 65_536;

/**
 * Um hash que não é de ninguém, usado pra gastar o mesmo tempo quando o
 * endpoint não existe. Sorteado uma vez por processo, de propósito: uma
 * constante fixa no código seria reconhecível.
 */
const HASH_ISCA = createHash("sha256").update(randomBytes(32)).digest();

/** sha256 do token, em hexadecimal. É isto (e só isto) que o banco guarda. */
export function hashDeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Sorteia um token novo: `whk_<32 bytes em base64url>`.
 *
 * base64url (e não hex) porque o token viaja na URL como segunda opção
 * (`?token=...`) e não pode ter caractere que precise de escape.
 *
 * ⚠️ O valor de `token` só existe nesta volta da função. Depois de mostrar na
 * tela, ele não é recuperável de lugar nenhum.
 */
export function gerarTokenDeWebhook(): TokenNovo {
  const token = PREFIXO_DO_TOKEN + randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashDeToken(token),
    tokenPrefix: token.slice(0, TAMANHO_DO_APELIDO_DO_TOKEN),
  };
}

/** Compara dois hashes hexadecimais em tempo constante. */
function hashesBatem(hexA: string, hexB: string): boolean {
  const a = Buffer.from(hexA, "hex");
  const b = Buffer.from(hexB, "hex");
  // `timingSafeEqual` LANÇA quando os tamanhos diferem — e o tamanho seria a
  // primeira coisa a vazar. Como os dois lados são sempre sha256 (32 bytes),
  // um tamanho diferente só acontece se o dado do banco estiver corrompido.
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Gasta o mesmo tempo de uma comparação de verdade, sem comparar nada. */
function gastarOMesmoTempo(token: string): void {
  const calculado = Buffer.from(hashDeToken(token), "hex");
  timingSafeEqual(calculado, HASH_ISCA);
}

/** O endereço público de um endpoint. É o que a pessoa cola no sistema de fora. */
export function montarUrlDoWebhook(baseUrl: string, endpointId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/webhooks/${endpointId}`;
}

/**
 * O token que veio no pedido: `Authorization: Bearer whk_...` ou `?token=`.
 *
 * O cabeçalho é o caminho principal (não fica gravado em log de servidor nem
 * no histórico do navegador). A URL existe porque muito sistema simples só
 * sabe chamar um endereço — e é melhor ter o caminho fácil funcionando do que
 * o aluno colar o token num lugar pior.
 */
export function tokenDoPedido(headers: Headers, url: URL): string {
  const autorizacao = headers.get("authorization") ?? "";
  const comBearer = /^bearer\s+(.+)$/i.exec(autorizacao.trim());
  if (comBearer?.[1]) return comBearer[1].trim();

  const doCabecalho = headers.get("x-webhook-token");
  if (doCabecalho?.trim()) return doCabecalho.trim();

  return url.searchParams.get("token")?.trim() ?? "";
}

/**
 * Esse pedido pode disparar o agente?
 *
 * ⚠️ TUDO QUE SAI DAQUI VEM DA LINHA DO BANCO — organização, agente e
 * identidade. Nada vem do pedido HTTP. É a mesma regra da fila (ameaça T5).
 *
 * A ordem importa:
 *   1. acha o endpoint (não achou → gasta o mesmo tempo e responde);
 *   2. confere o token em tempo constante;
 *   3. só DEPOIS olha se está ligado — quem não provou o token não descobre
 *      nem isso;
 *   4. conta a chamada e confere o limite do minuto.
 *
 * O limite é contado só pra quem passou pelo token, de propósito: o inimigo
 * real aqui não é força bruta (são 256 bits), é uma integração maluca do outro
 * lado chamando mil vezes por minuto e enchendo a fila do workspace.
 */
export async function verificarWebhook(
  endpointId: string,
  token: string,
  /**
   * `false` pra uma leitura que NÃO deve contar contra o limite de
   * chamadas por minuto do endereço — é o caso da rota de "buscar depois"
   * (`.../j/[jobId]`), que só lê o resultado de um trabalho que já
   * entrou na fila. `window_count` é uma coluna ÚNICA e compartilhada em
   * `webhook_endpoints`: se essa leitura contasse, um cliente fazendo
   * polling estouraria o MESMO balde que o POST compara contra 60/min, e
   * o próximo evento de negócio de verdade tomaria 429 por causa disso.
   */
  contar = true,
): Promise<VerificacaoWebhook> {
  let endpoint: Awaited<ReturnType<typeof webhookEndpointForCheck>>;
  try {
    endpoint = await webhookEndpointForCheck(endpointId);
  } catch (err) {
    logError("automation/webhookEndpointForCheck", err);
    // Falhou a leitura? Trata como "não achei". Errar pro lado de negar é o
    // único erro seguro aqui.
    gastarOMesmoTempo(token);
    return { ok: false, motivo: "nao-encontrado" };
  }

  if (!endpoint) {
    gastarOMesmoTempo(token);
    return { ok: false, motivo: "nao-encontrado" };
  }

  if (!hashesBatem(hashDeToken(token), endpoint.tokenHash)) {
    return { ok: false, motivo: "token-invalido" };
  }

  if (!endpoint.isActive) {
    return { ok: false, motivo: "desligado" };
  }

  // Só quem PODE gastar o balde (o POST que enfileira) gasta o balde. Uma
  // leitura de resultado passa pelas mesmas conferências de cima (token,
  // endereço ligado) sem consumir o limite de chamadas por minuto.
  if (contar) {
    let cabe: boolean;
    try {
      cabe = await webhookTouch(endpoint.id, LIMITE_DE_CHAMADAS_POR_MINUTO);
    } catch (err) {
      logError("automation/webhookTouch", err);
      // Não deu pra contar a chamada. Deixar passar seria abrir a torneira sem
      // medidor; recusar avisa o outro lado pra tentar de novo daqui a pouco.
      return { ok: false, motivo: "limite" };
    }

    if (!cabe) {
      return { ok: false, motivo: "limite" };
    }
  }

  return {
    ok: true,
    endpointId: endpoint.id,
    organizationId: endpoint.organizationId,
    agentId: endpoint.agentId,
    runAs: endpoint.runAs,
    modo: endpoint.modo,
    esperarResposta: endpoint.esperarResposta,
  };
}
