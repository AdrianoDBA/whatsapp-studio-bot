/**
 * A checagem de saúde do container (o EasyPanel e o Docker usam ela).
 *
 * Ela olha DUAS coisas:
 *
 * 1. o site responde? (o simples fato de esta função rodar já prova que sim);
 * 2. o TRABALHADOR da automação deu sinal de vida nos últimos 2 minutos?
 *
 * Por que a segunda: sem ela, um trabalhador morto passaria despercebido e o
 * site continuaria no ar com os agendamentos e webhooks mortos — em silêncio,
 * que é o pior jeito de falhar. Respondendo 503, o painel reinicia o container
 * e o log conta o que aconteceu.
 *
 * ⚠️ A SEGUNDA CHECAGEM SÓ VALE QUANDO EXISTE `DATABASE_URL`.
 * Sem endereço de banco o trabalhador nem sobe (é um cenário suportado: o
 * `migrate.mjs` só avisa e segue). Se o 503 valesse nesse caso, um app que
 * hoje funciona passaria a REINICIAR PRA SEMPRE. Não toque nesta condição.
 *
 * Não renderiza página e não toca no banco.
 */

import { trabalhadorEstaVivo } from "@/lib/automation/heartbeat";
import { databaseUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responder(texto: string, status: number): Response {
  return new Response(texto, {
    status,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}

export async function GET() {
  const temBanco = Boolean(databaseUrl());

  if (temBanco && !trabalhadorEstaVivo()) {
    return responder("o site está no ar, mas o trabalhador da automação não dá sinal de vida", 503);
  }

  return responder("ok", 200);
}
