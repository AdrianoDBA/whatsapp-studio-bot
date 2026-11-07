/**
 * A CHAMADA INTERNA: o trabalhador pede pro site rodar um agente.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ESTA ROTA NÃO É PÚBLICA, mesmo estando num endereço público.             │
 * │ Ela só existe porque o trabalhador e o site são dois processos do MESMO  │
 * │ container: o trabalhador é burro de propósito (só `pg` e `fetch`), e     │
 * │ todo o código de agente, ferramenta e chave mora aqui no site.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * AS CINCO CAMADAS QUE PROTEGEM ISTO (ameaça T4 do contrato)
 * ----------------------------------------------------------
 * 1. O `proxy.ts` devolve 404 quando o pedido veio de FORA (o endereço de quem
 *    chamou está na cadeia de proxy e não é loopback — ver
 *    `lib/automation/chamada-interna.ts`). Esta rota confere de novo, porque
 *    duas camadas.
 * 2. Assinatura HMAC-SHA256 derivada da ENCRYPTION_KEY (que nunca sai do
 *    container), conferida em TEMPO CONSTANTE, com janela de 60 segundos.
 * 3. O corpo carrega UM único campo: `jobId`. Nada de organização, de agente
 *    nem de identidade — pedir isso é a ameaça T5, e ela morre aqui.
 * 4. `loadJobForRun` exige que a linha esteja `running` E travada por ESTE
 *    trabalhador.
 * 5. `mark_job_started` recusa a segunda entrega do mesmo trabalho.
 *
 * ⚠️ RESÍDUO CONHECIDO: se você expuser o container direto na internet com
 * `TRUST_PROXY=0`, não dá pra distinguir dentro de fora e a camada 1 some.
 * Sobram as outras quatro — o que continua sólido, mas é uma camada a menos.
 * Está escrito em `lib/automation/CLAUDE.md`.
 */

import { chamadaVeioDeFora } from "@/lib/automation/chamada-interna";
import { executarTrabalho } from "@/lib/automation/run-job";
import { runJobRequestSchema } from "@/lib/automation/schemas";
import { internalJobSecret } from "@/lib/env";
import { logError } from "@/lib/logger";
import { conferirAssinatura } from "@/scripts/lib/segredo-interno.mjs";

/** Precisa de Node de verdade: `pg`, `node:crypto` e o motor inteiro. */
export const runtime = "nodejs";
/**
 * 5 minutos. É o mesmo teto de `TETO_DE_TEMPO_DO_TRABALHO_MS`, e ele pode ser
 * maior que o do chat porque esta chamada é DENTRO do container: ela não passa
 * pelo proxy do EasyPanel, então o corte de 60 segundos não vale aqui.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Assinatura de mais de um minuto atrás não serve mais. */
const JANELA_MS = 60_000;

/** Corpo minúsculo de propósito: um `jobId` e nada mais. */
const MAX_CORPO_BYTES = 1_024;

function textoPuro(mensagem: string, status: number): Response {
  return new Response(mensagem, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Camada 1. 404 (e não 403) de propósito: pra quem está de fora, esta rota
  // simplesmente não existe.
  if (chamadaVeioDeFora(req.headers)) return textoPuro("Não encontrado.", 404);

  const assinatura = req.headers.get("x-job-signature") ?? "";
  const workerId = req.headers.get("x-worker-id") ?? "";
  const momento = Number.parseInt(req.headers.get("x-job-ts") ?? "", 10);

  const bruto = await req.text();
  if (bruto.length > MAX_CORPO_BYTES) return textoPuro("Pedido grande demais.", 413);

  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto === "" ? "{}" : bruto);
  } catch {
    return textoPuro("Não entendi o pedido.", 400);
  }

  const jobId = (corpo as { jobId?: unknown })?.jobId;
  const pedido = runJobRequestSchema.safeParse({ jobId, workerId, ts: momento });
  if (!pedido.success) {
    return textoPuro(pedido.error.issues[0]?.message ?? "Não entendi o pedido.", 400);
  }

  // Camada 2. A janela vem ANTES da conta do HMAC: assinatura velha nem chega
  // a ser calculada.
  if (Math.abs(Date.now() - pedido.data.ts) > JANELA_MS) {
    return textoPuro("Essa chamada interna está velha demais.", 401);
  }

  let segredo: string;
  try {
    segredo = internalJobSecret();
  } catch (err) {
    logError("api/internal/run-job/segredo", err);
    return textoPuro(
      "O app não conseguiu montar o segredo da chamada interna (falta a ENCRYPTION_KEY).",
      500,
    );
  }

  const confere = conferirAssinatura(
    segredo,
    pedido.data.jobId,
    pedido.data.workerId,
    pedido.data.ts,
    assinatura,
  );

  if (!confere) {
    // A frase é específica de propósito: o motivo REAL disto, na máquina do
    // aluno, é quase sempre "o site e o trabalhador estão com .env
    // diferentes".
    logError(
      "api/internal/run-job",
      new Error("assinatura da chamada interna não confere (ENCRYPTION_KEY diferente?)"),
    );
    return textoPuro("Assinatura da chamada interna não confere.", 401);
  }

  // Camadas 3, 4 e 5 vivem dentro daqui. Repare que o único dado que veio do
  // pedido e chega aqui é o NÚMERO DO TRABALHO.
  const resultado = await executarTrabalho(pedido.data.jobId, pedido.data.workerId);

  return new Response(JSON.stringify(resultado), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
