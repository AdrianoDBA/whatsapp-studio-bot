/**
 * O `npm run semear` entra por aqui.
 *
 * Ela existe pelo mesmo motivo de `/api/internal/run-job`: as declarações
 * moram em TypeScript com alias `@/`, e um script `.mjs` solto não consegue
 * importá-las. Rodando dentro do Next, o materializador é só um import.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ NÃO É POSTGRES. `semearWorkspaces` (`lib/seed/semear.ts`) age no nome do  │
 * │ DONO DE CADA WORKSPACE, pela mesma impersonação da automação — nunca     │
 * │ `systemPool()`. Ver o comentário do topo daquele arquivo pro porquê.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * AS MESMAS CAMADAS DO `run-job`, adaptadas: 404 pra pedido que veio de fora
 * (`chamadaVeioDeFora`), assinatura HMAC derivada da ENCRYPTION_KEY conferida
 * em tempo constante com janela de 60s, e corpo mínimo (`{ organizationId? }`
 * — nunca uma identidade, porque quem impersonar é decidido DENTRO, por
 * `owner_memberships_for_seed`).
 *
 * ⚠️ Assinatura própria (`assinarChamadaSemear`/`conferirAssinaturaSemear`,
 * em `scripts/lib/segredo-interno.mjs`): o texto assinado é diferente do de
 * `run-job` (`semear-v1\n...` vs `v1\n...`) — domínio separado, mesmo
 * derivando do mesmo segredo.
 */
import { chamadaVeioDeFora } from "@/lib/automation/chamada-interna";
import { semearRequestSchema } from "@/lib/automation/schemas";
import { internalJobSecret } from "@/lib/env";
import { logError } from "@/lib/logger";
import { semearWorkspaces } from "@/lib/seed/semear";
import { conferirAssinaturaSemear } from "@/scripts/lib/segredo-interno.mjs";

/** Precisa de Node de verdade: `pg`, `node:crypto` e o motor inteiro (pela ponte). */
export const runtime = "nodejs";
/** Mesmo teto do `run-job`: dentro do container, não passa pelo proxy do EasyPanel. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Assinatura de mais de um minuto atrás não serve mais. Mesma janela do `run-job`. */
const JANELA_MS = 60_000;

/** Corpo minúsculo de propósito: no máximo um `organizationId`. */
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

  const assinatura = req.headers.get("x-semear-signature") ?? "";
  const momento = Number.parseInt(req.headers.get("x-semear-ts") ?? "", 10);

  const bruto = await req.text();
  if (bruto.length > MAX_CORPO_BYTES) return textoPuro("Pedido grande demais.", 413);

  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto === "" ? "{}" : bruto);
  } catch {
    return textoPuro("Não entendi o pedido.", 400);
  }

  const organizationId = (corpo as { organizationId?: unknown })?.organizationId;
  const pedido = semearRequestSchema.safeParse({ organizationId, ts: momento });
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
    logError("api/internal/semear/segredo", err);
    return textoPuro(
      "O app não conseguiu montar o segredo da chamada interna (falta a ENCRYPTION_KEY).",
      500,
    );
  }

  const confere = conferirAssinaturaSemear(
    segredo,
    pedido.data.organizationId ?? "",
    pedido.data.ts,
    assinatura,
  );

  if (!confere) {
    // A frase é específica de propósito: o motivo REAL disto, na máquina do
    // aluno, é quase sempre "o site e o script estão com .env diferentes".
    logError(
      "api/internal/semear",
      new Error("assinatura da chamada interna não confere (ENCRYPTION_KEY diferente?)"),
    );
    return textoPuro("Assinatura da chamada interna não confere.", 401);
  }

  const resultado = await semearWorkspaces(pedido.data.organizationId);

  return new Response(JSON.stringify(resultado), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
