/**
 * A PORTA DE TRÁS DO MODO SÍNCRONO: buscar depois o que a chamada original
 * não esperou terminar.
 *
 * Quando `POST /api/webhooks/<id>` está em modo síncrono e o trabalho não
 * termina dentro de `PRAZO_DO_WEBHOOK_MS` (50 s), a resposta 202 carrega um
 * `buscarEm` apontando pra cá. Esta rota faz UMA pergunta pro banco
 * (`webhook_job_result`, a mesma função que a espera síncrona usa) e responde
 * na hora — ela NUNCA espera, é só uma leitura.
 *
 * ⚠️ O TOKEN É CONFERIDO IGUAL À ROTA IRMÃ (mesma `verificarWebhook`, mesma
 * comparação em tempo constante), mas com `contar: false` — quem só está
 * lendo o resultado de um trabalho que já entrou na fila não deve gastar o
 * balde de 60 chamadas/minuto do endereço. Sem isso, um cliente fazendo
 * polling desta rota estouraria o MESMO contador (`window_count`, uma coluna
 * única e compartilhada em `webhook_endpoints`) que o POST compara, e o
 * próximo evento de negócio de verdade tomaria 429 por causa do polling.
 *
 * ⚠️ SÓ O QUE É ANTERIOR AO TOKEN vira o 403 genérico ("endereço não existe"
 * e "token errado" — os dois colapsam na MESMA frase, pra não deixar alguém
 * com um jobId roubado descobrir, chamada por chamada, quais UUIDs de
 * endereço são válidos). "Desligado" e "limite" só acontecem DEPOIS que o
 * token já provou — a rota irmã (o POST) já revela essas duas com 403 e 429
 * distintos, então revelar aqui também não abre brecha nenhuma. Colapsar as
 * quatro no mesmo 403 faria o cliente CERTO, com o token CERTO, ler "token
 * inválido" quando na verdade só esbarrou no limite de chamadas — um erro
 * que ele trataria como terminal (403 não é "tente de novo" como 429 é), e
 * pararia de buscar a resposta de um trabalho que já rodou e já foi cobrado.
 */
import { buscarResultadoDoTrabalho } from "@/lib/automation/queue";
import { tokenDoPedido, verificarWebhook } from "@/lib/automation/webhooks";
import { logError } from "@/lib/logger";

/** Precisa de Node de verdade: a fila fala com o banco por `pg`. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Esta rota faz UMA leitura só (nunca espera em laço), mas ainda assim
 * declara `maxDuration` — o mesmo cuidado da rota irmã (`../route.ts`): sem
 * isso, o próprio Next poderia cortar a requisição antes de uma resposta
 * lenta do banco chegar.
 */
export const maxDuration = 30;

/** Formato de um número (uuid). Fora disso nem chega no banco. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** A mesma frase pro que é ANTERIOR ao token: endereço inexistente e token errado. */
function respostaToken(): Response {
  return responder(403, { ok: false, error: "Token inválido pra esse endereço." });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ endpointId: string; jobId: string }> },
): Promise<Response> {
  const { endpointId, jobId } = await ctx.params;

  if (!UUID.test(endpointId) || !UUID.test(jobId)) {
    return respostaToken();
  }

  const token = tokenDoPedido(req.headers, new URL(req.url));

  let verificacao: Awaited<ReturnType<typeof verificarWebhook>>;
  try {
    // `contar: false` — ver o cabeçalho deste arquivo: uma leitura de
    // resultado não gasta o balde de chamadas por minuto do endereço.
    verificacao = await verificarWebhook(endpointId, token, false);
  } catch (err) {
    logError("api/webhooks/j/verificar", err);
    return responder(503, {
      ok: false,
      error: "As automações estão fora do ar neste app agora. Tente de novo daqui a pouco.",
    });
  }

  if (!verificacao.ok) {
    switch (verificacao.motivo) {
      // Anterior ao token provado: a MESMA frase genérica pros dois, pra não
      // vazar se o endereço existe.
      case "nao-encontrado":
      case "token-invalido":
        return respostaToken();

      // Depois do token: a rota irmã já revela isso com 403 específico, e
      // aqui não é diferente.
      case "desligado":
        return responder(403, {
          ok: false,
          error:
            "Esse endereço está desligado. Isso acontece quando quem respondia por ele saiu " +
            "do workspace — peça pra alguém criar um endereço novo.",
        });

      // "limite": 429, igual ao POST — NUNCA o mesmo 403 de token errado. Um
      // cliente que trata 403 como falha terminal pararia de buscar a
      // resposta de um trabalho que já rodou e já foi cobrado.
      default:
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

  let linha: Awaited<ReturnType<typeof buscarResultadoDoTrabalho>>;
  try {
    linha = await buscarResultadoDoTrabalho(verificacao.endpointId, jobId);
  } catch (err) {
    logError("api/webhooks/j/resultado", err);
    return responder(503, {
      ok: false,
      error: "As automações estão fora do ar neste app agora. Tente de novo daqui a pouco.",
    });
  }

  // O token provou que este endereço é de quem chamou — a partir daqui, dizer
  // "esse trabalho não existe" não vaza nada que o token já não confirmasse.
  if (!linha) {
    return responder(404, { ok: false, error: "Esse trabalho não foi encontrado." });
  }

  if (linha.status === "pending" || linha.status === "running") {
    return responder(202, { status: "running" });
  }

  if (linha.status === "failed" || linha.status === "cancelled") {
    return responder(200, {
      ok: false,
      error: linha.lastError ?? "O agente não conseguiu terminar essa execução.",
    });
  }

  // linha.status === "done"
  return responder(200, {
    ok: true,
    resposta: linha.output,
    custoMicros: linha.costMicros,
    // Avisa quem chamou que essa rodada foi um ENSAIO: nenhuma ferramenta de
    // ação (email, HTTP) rodou de verdade, mesmo a resposta parecendo real.
    //
    // ⚠️ VEM DA EXECUÇÃO (`agent_runs.modo`, via `webhook_job_result`), NUNCA
    // de `verificacao.modo`. O segundo é o estado ATUAL do endereço — e aqui a
    // distância entre o disparo e a leitura é ainda MAIOR que na rota irmã
    // (quem busca depois volta minutos mais tarde). Basta alguém virar a
    // chavinha pra "real" nesse intervalo, e este campo afirmaria `true` numa
    // rodada em que o email saiu de verdade.
    ensaio: linha.runModo === "ensaio",
  });
}

/**
 * Quem abre o endereço no navegador cai aqui. Mesma disciplina da rota irmã:
 * a frase explica o que fazer sem confirmar nem negar que o endereço existe.
 */
export function POST(): Response {
  return responder(405, {
    ok: false,
    error: "Esse endereço só aceita GET, com o token no cabeçalho (Authorization: Bearer whk_...).",
  });
}
