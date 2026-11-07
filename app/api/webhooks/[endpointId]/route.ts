/**
 * A PORTA DE FORA: um sistema qualquer chama, e um agente roda.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ESTA ROTA NUNCA RODA O AGENTE.                                          │
 * │ Ela confere o token, põe UM trabalho na fila e responde 202 na hora.    │
 * │ Quem roda é o trabalhador (o outro processo do container).              │
 * │                                                                          │
 * │ Por quê: quem chama um webhook (WhatsApp, formulário, n8n, Zapier)      │
 * │ desiste em poucos segundos e REPETE a chamada. Se o agente rodasse aqui │
 * │ dentro, uma execução de 40 segundos viraria três execuções cobradas.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * O CONTRATO
 * ----------
 *   POST /api/webhooks/<id-do-endereço>
 *   cabeçalho:  Authorization: Bearer whk_...        (ou ?token=whk_... na URL)
 *   corpo:      qualquer JSON, até 64 KB
 *
 *   202  entrou na fila           404  esse endereço não existe
 *   401  token errado             403  endereço desligado
 *   413  corpo grande demais      429  volta depois (ver `code` e `Retry-After`)
 *   503  o app está sem endereço de banco (a fila não existe)
 *
 * A RECUSA CARREGA UM `code` ESTÁVEL, pra quem programa do outro lado conseguir
 * distinguir sem ler o texto em português:
 *
 *   429 `limite_de_chamadas`  chamou demais nesse minuto
 *   429 `teto_de_gasto`       o workspace chegou no teto de gasto com IA
 *   429 `fila_cheia`          o workspace já tem 25 trabalhos esperando
 *   429 `chamada_repetida`    essa chave de repetição já tinha entrado
 *   403 `endereco_desligado`  alguém desligou esse endereço
 *   403 `sem_responsavel`     quem respondia por ele saiu do workspace
 *
 * ⚠️ TETO DE GASTO É 429, NUNCA 202. Responder "aceitei" pra um trabalho que
 * nunca vai rodar é mentir pro sistema do outro lado — ele precisa saber pra
 * tentar de novo. E é 429 e não 402 (*Payment Required*): 402 diz "você me deve
 * dinheiro", e ninguém deve nada. É um limite que o próprio workspace colocou.
 *
 * ⚠️ O CORPO É DADO, NUNCA INSTRUÇÃO (ameaça T15 do contrato).
 * Quem embrulha o corpo em `{"data": …}` é a função do banco
 * (`enqueue_webhook_job`), de propósito: o banco é a última camada que ninguém
 * contorna. **Não embrulhe de novo aqui** — sairia `data.data`. O motor marca
 * o que está em `data` como dado recebido junto com o pedido, e não como
 * ordem, que é o par do rodapé anti-injeção de `lib/agents/prompt.ts`.
 *
 * ⚠️ NADA DE IDENTIDADE VEM DAQUI. Organização, agente e `run_as` saem da
 * linha de `webhook_endpoints`, gravada quando alguém criou o endereço pela
 * tela. Quem chama não escolhe em nome de quem o agente roda.
 *
 * MODO SÍNCRONO (`webhook_endpoints.esperar_resposta = true`)
 * ------------------------------------------------------------
 * Continua entrando na fila EXATAMENTE igual — isto NÃO é um segundo jeito de
 * rodar o agente. A única diferença é que a rota fica esperando (perguntando
 * pro banco a cada 500 ms, nunca rodando nada) até `PRAZO_DO_WEBHOOK_MS`
 * (50 s, ver `lib/automation/queue.ts`). Terminou a tempo: 200 com a resposta
 * do agente. Estourou o prazo: 202 com `buscarEm`, o endereço de
 * `app/api/webhooks/[endpointId]/j/[jobId]/route.ts`, que faz UMA leitura (sem
 * espera) e devolve 200 (terminou) ou 202 `{"status":"running"}`.
 */
import {
  type EnqueueWebhookResult,
  enqueueWebhookJob,
  esperarResultadoDoTrabalho,
  PRAZO_DO_WEBHOOK_MS,
} from "@/lib/automation/queue";
import {
  MAX_CORPO_DO_WEBHOOK_BYTES,
  tokenDoPedido,
  verificarWebhook,
} from "@/lib/automation/webhooks";
import { budgetBlockedMessage } from "@/lib/limits/messages";
import { segundosAteAViradaDoDia, segundosAteAViradaDoMes } from "@/lib/limits/month";
import { logError } from "@/lib/logger";

/** Precisa de Node de verdade: a fila fala com o banco por `pg`. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * ⚠️ SEM ISTO, O PRÓPRIO NEXT CORTA A REQUISIÇÃO ANTES DO PROXY.
 * O modo síncrono espera até `PRAZO_DO_WEBHOOK_MS` (50 s) pelo trabalho. Sem
 * declarar `maxDuration` (ver `app/api/chat/route.ts`), o Next usaria o teto
 * padrão da plataforma — que pode ser menor que isso — e a espera nunca
 * chegaria a terminar. 60 é o mínimo: 50 s de espera + folga pro resto da
 * rota (conferir token, montar resposta).
 */
export const maxDuration = 60;

/** Formato de um número (uuid). Endereço fora disso nem chega no banco. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quantos caracteres da chave de repetição do chamador a gente aproveita. */
const MAX_CHAVE_DE_REPETICAO = 120;

function responder(
  status: number,
  corpo: Record<string, unknown>,
  extras?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extras,
    },
  });
}

/**
 * A chave que evita trabalho em dobro quando o sistema de fora repete a
 * chamada (o que ele SEMPRE faz, quando acha que deu tempo limite).
 *
 * O número do endereço entra na chave de propósito: sem isso, dois sistemas
 * diferentes mandando `Idempotency-Key: 1` fariam o segundo sumir em silêncio.
 */
function chaveDeRepeticao(headers: Headers, endpointId: string): string | null {
  const bruto = (headers.get("idempotency-key") ?? headers.get("x-idempotency-key") ?? "").trim();
  if (bruto === "") return null;
  return `webhook:${endpointId}:${bruto.slice(0, MAX_CHAVE_DE_REPETICAO)}`;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ endpointId: string }> },
): Promise<Response> {
  const { endpointId } = await ctx.params;

  if (!UUID.test(endpointId)) {
    return responder(404, { ok: false, error: "Esse endereço de webhook não existe." });
  }

  // ---------------------------------------------------------------------
  // O corpo, com teto
  // ---------------------------------------------------------------------
  // O `content-length` é só a primeira barreira (dá pra mentir nele ou nem
  // mandar). O teto de verdade é conferido no texto que chegou.
  const anunciado = Number.parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(anunciado) && anunciado > MAX_CORPO_DO_WEBHOOK_BYTES) {
    return responder(413, {
      ok: false,
      error: "O corpo dessa chamada passou de 64 KB. Mande só o essencial.",
    });
  }

  let bruto: string;
  try {
    bruto = await req.text();
  } catch {
    return responder(400, { ok: false, error: "Não deu pra ler o corpo dessa chamada." });
  }

  if (Buffer.byteLength(bruto, "utf8") > MAX_CORPO_DO_WEBHOOK_BYTES) {
    return responder(413, {
      ok: false,
      error: "O corpo dessa chamada passou de 64 KB. Mande só o essencial.",
    });
  }

  let corpo: unknown;
  try {
    // Chamada sem corpo é legítima: tem sistema que só avisa "aconteceu".
    corpo = bruto.trim() === "" ? {} : JSON.parse(bruto);
  } catch {
    return responder(400, {
      ok: false,
      error: "O corpo dessa chamada não é um JSON válido.",
    });
  }

  // O banco exige que o payload seja um OBJETO (`jobs_payload_is_object`).
  // Um array ou um número solto vira `{ "valor": … }` pra não recusar a
  // chamada por um detalhe de formato.
  const payload =
    corpo !== null && typeof corpo === "object" && !Array.isArray(corpo)
      ? (corpo as Record<string, unknown>)
      : { valor: corpo };

  // ---------------------------------------------------------------------
  // O token
  // ---------------------------------------------------------------------
  const token = tokenDoPedido(req.headers, new URL(req.url));

  let verificacao: Awaited<ReturnType<typeof verificarWebhook>>;
  try {
    verificacao = await verificarWebhook(endpointId, token);
  } catch (err) {
    logError("api/webhooks/verificar", err);
    return responder(503, {
      ok: false,
      error: "As automações estão fora do ar neste app agora. Tente de novo daqui a pouco.",
    });
  }

  if (!verificacao.ok) {
    switch (verificacao.motivo) {
      case "nao-encontrado":
        return responder(404, { ok: false, error: "Esse endereço de webhook não existe." });
      case "token-invalido":
        return responder(401, { ok: false, error: "Token inválido pra esse endereço." });
      case "desligado":
        return responder(403, {
          ok: false,
          error:
            "Esse endereço está desligado. Isso acontece quando quem respondia por ele saiu " +
            "do workspace — peça pra alguém criar um endereço novo.",
        });
      default:
        // `code` estável pra quem programa do outro lado conseguir separar
        // "você chamou demais" de "esse workspace chegou no teto de gasto".
        return responder(
          429,
          {
            ok: false,
            error: "Muitas chamadas em pouco tempo nesse endereço. Espere um minuto.",
            code: "limite_de_chamadas",
          },
          { "retry-after": "60" },
        );
    }
  }

  // ---------------------------------------------------------------------
  // Entra na fila e acabou
  // ---------------------------------------------------------------------
  let entrada: EnqueueWebhookResult;
  try {
    entrada = await enqueueWebhookJob({
      endpointId: verificacao.endpointId,
      payload,
      idempotencyKey: chaveDeRepeticao(req.headers, verificacao.endpointId),
    });
  } catch (err) {
    logError("api/webhooks/enfileirar", err);
    return responder(503, {
      ok: false,
      error: "As automações estão fora do ar neste app agora. Tente de novo daqui a pouco.",
    });
  }

  if (entrada.jobId === null) {
    // A função do banco agora diz POR QUE não entrou. Antes ela devolvia nulo
    // pros quatro motivos e esta rota fazia uma leitura extra pra adivinhar —
    // e mesmo assim não separava "fila cheia" de "chamada repetida".
    switch (entrada.motivo) {
      // -----------------------------------------------------------------
      // O TETO DE GASTO: 429, nunca 202.
      // -----------------------------------------------------------------
      // Responder "aceitei" pra um trabalho que já se sabe que não vai rodar
      // é mentir pro sistema do outro lado. E é 429 e não 402: 402 diz "você
      // me deve dinheiro", e ninguém deve nada — é um limite auto-imposto.
      // 429 diz "volta depois", que é exatamente o caso, e vem com o
      // `Retry-After`, que é exatamente a informação útil.
      case "teto-de-gasto": {
        const escopo = entrada.escopo ?? "mes";
        // Quando quem cortou foi o freio do DIA, mandar o sistema voltar só na
        // virada do mês faria ele parar de chamar por semanas por causa de um
        // limite que zera à meia-noite.
        const segundos = escopo === "dia" ? segundosAteAViradaDoDia() : segundosAteAViradaDoMes();
        return responder(
          429,
          {
            ok: false,
            error: budgetBlockedMessage({
              audience: "webhook",
              blockedBy: escopo,
              effectiveMicros: null,
            }),
            code: "teto_de_gasto",
          },
          { "retry-after": String(segundos) },
        );
      }

      // Os dois motivos abaixo dizem coisas DIFERENTES, e juntar os dois numa
      // frase só mandaria metade das pessoas procurar um problema que não
      // existe: "desligado" é alguém que apagou a chavinha; "sem-responsavel"
      // é o endereço se desligando sozinho agora, porque quem respondia por ele
      // saiu do workspace.
      case "desligado":
        return responder(403, {
          ok: false,
          error:
            "Esse endereço está desligado. Peça pra alguém do workspace ligar ele de novo na " +
            "tela de Automações.",
          code: "endereco_desligado",
        });

      case "sem-responsavel":
        return responder(403, {
          ok: false,
          error:
            "Esse endereço acabou de ser desligado porque quem respondia por ele saiu do " +
            "workspace. Peça pra alguém criar um endereço novo.",
          code: "sem_responsavel",
        });

      case "repetida":
        return responder(429, {
          ok: false,
          error:
            "Essa mesma chamada já tinha entrado na fila (a chave de repetição é a mesma). " +
            "Não tem trabalho novo pra fazer.",
          code: "chamada_repetida",
        });

      default:
        return responder(
          429,
          {
            ok: false,
            error: "A fila de automações desse workspace está cheia. Tente de novo daqui a pouco.",
            code: "fila_cheia",
          },
          { "retry-after": "60" },
        );
    }
  }

  // -----------------------------------------------------------------------
  // Modo assíncrono (o padrão): entrou na fila, acabou. Quem chamou não
  // espera pela resposta do agente — é o comportamento de hoje.
  // -----------------------------------------------------------------------
  if (!verificacao.esperarResposta) {
    return responder(202, { ok: true, jobId: entrada.jobId });
  }

  // -----------------------------------------------------------------------
  // Modo SÍNCRONO: este endereço espera a resposta do agente antes de
  // responder pro sistema de fora. ISTO NÃO RODA O AGENTE AQUI DENTRO — é só
  // uma espera sobre o MESMO trabalho que acabou de entrar na fila (ver o
  // cabeçalho deste arquivo e `esperarResultadoDoTrabalho` em
  // `lib/automation/queue.ts`). Quem roda continua sendo o trabalhador.
  // -----------------------------------------------------------------------
  const fim = await esperarResultadoDoTrabalho({
    endpointId: verificacao.endpointId,
    jobId: entrada.jobId,
    prazoMs: PRAZO_DO_WEBHOOK_MS,
    // Quem chamou fechou a conexão? Para de perguntar pro banco em vez de
    // continuar até o prazo estourar sem ninguém ouvindo.
    signal: req.signal,
  });

  if (fim.tipo === "prazo") {
    // O trabalho ainda não terminou quando o prazo estourou. 202 (e não um
    // erro): a chamada foi aceita, só está demorando mais que o previsto.
    // `buscarEm` é o endereço pra quem chamou vir buscar o resultado depois.
    return responder(202, {
      ok: true,
      jobId: entrada.jobId,
      buscarEm: `/api/webhooks/${endpointId}/j/${entrada.jobId}`,
    });
  }

  if (fim.tipo === "falhou") {
    // 200, não um 5xx: a CHAMADA foi um sucesso (entrou, rodou, terminou). O
    // agente que falhou é dado de negócio, não defeito da integração — é a
    // mesma leitura que `agent_runs.status = 'failed'` já tem no resto do app.
    return responder(200, { ok: false, error: fim.erro, jobId: entrada.jobId });
  }

  return responder(200, {
    ok: true,
    resposta: fim.output,
    custoMicros: fim.costMicros,
    // Avisa quem chamou que essa rodada foi um ENSAIO: nenhuma ferramenta de
    // ação (email, HTTP) rodou de verdade, mesmo a resposta parecendo real.
    //
    // ⚠️ VEM DA EXECUÇÃO (`agent_runs.modo`), NUNCA DE `verificacao.modo`.
    // O segundo é o estado ATUAL do endereço, lido junto com o token: bastava
    // alguém virar a chavinha pra "real" na tela de Automações entre o disparo
    // e a resposta, e este campo dizia `true` numa rodada em que o email SAIU.
    // O `modo` da execução é imutável e descreve o que de fato aconteceu.
    ensaio: fim.ensaio,
  });
}

/**
 * Quem abre o endereço no navegador cai aqui.
 *
 * Um 405 seco faria o aluno achar que o endereço está errado. A frase explica
 * o que fazer — e não confirma nem nega que o endereço existe, porque nem
 * chega a olhar o banco.
 */
export function GET(): Response {
  return responder(405, {
    ok: false,
    error:
      "Esse endereço só aceita POST, com o token no cabeçalho " +
      "(Authorization: Bearer whk_...). Abrir ele no navegador não dispara nada.",
  });
}
