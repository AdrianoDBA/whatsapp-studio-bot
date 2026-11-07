/**
 * Leitura da instância de WhatsApp associada à organização.
 */
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { WhatsAppInstance } from "./types";

export async function getWhatsAppInstance(orgId: string): Promise<WhatsAppInstance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    logError("whatsapp.getWhatsAppInstance", error);
    return null;
  }

  // Auto-sincronização caso o gateway já tenha conectado mas o banco não tenha sido atualizado
  if (!data || data.status !== "connected") {
    try {
      const GATEWAY_URL = process.env.WHATSAPP_GATEWAY_URL || "http://127.0.0.1:5006";
      const res = await fetch(`${GATEWAY_URL}/session/${orgId}/status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(1200),
      });

      if (res.ok) {
        const body = await res.json();
        if (body.connected || body.status === "connected") {
          const updated = {
            organization_id: orgId,
            provider: "baileys" as const,
            status: "connected" as const,
            phone_number: body.connectedNumber || data?.phone_number || null,
            qr_code: null,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          await supabase.from("whatsapp_instances").upsert(updated, { onConflict: "organization_id" });
          return { ...(data || {}), ...updated } as WhatsAppInstance;
        }
      }
    } catch {
      // Ignora erro de rede com o gateway na leitura inicial
    }
  }

  return data as WhatsAppInstance | null;
}
