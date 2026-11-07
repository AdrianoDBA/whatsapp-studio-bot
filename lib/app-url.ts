import { headers } from "next/headers";
import { appUrlFromEnv } from "@/lib/env";

/**
 * Descobre o endereço público do app (ex: https://meusaas.com.br).
 *
 * Ordem:
 * 1. A variável APP_URL, se você preencheu.
 * 2. O endereço que o próprio visitante usou pra chegar aqui — lido dos
 *    cabeçalhos que o proxy do EasyPanel manda. É por isso que o aluno não
 *    precisa configurar nada: assim que ele liga o domínio, os links dos
 *    emails já saem certos.
 * 3. localhost:3000, pra quando roda na máquina dele.
 *
 * Só funciona dentro de uma requisição (página, função do servidor, rota de
 * API). Em código que roda fora de requisição, use APP_URL.
 */
export async function getAppUrl(): Promise<string> {
  const doEnv = appUrlFromEnv();
  if (doEnv) return doEnv;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
        (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // Fora de uma requisição — cai no padrão abaixo.
  }

  return "http://localhost:3000";
}
