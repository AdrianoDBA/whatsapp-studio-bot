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
  return data as WhatsAppInstance | null;
}
