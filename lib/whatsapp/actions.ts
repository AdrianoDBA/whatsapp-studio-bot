"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireOrgRole } from "@/lib/auth/guards";
import { systemPool } from "@/lib/automation/pg";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

const GATEWAY_URL = process.env.WHATSAPP_GATEWAY_URL || "http://127.0.0.1:5006";

const cloudApiSchema = z.object({
  phoneNumberId: z.string().min(5, "Phone Number ID inválido"),
  wabaId: z.string().min(5, "WABA ID inválido"),
  accessToken: z.string().min(10, "Token de acesso inválido"),
  phoneNumber: z.string().optional(),
});

export async function solicitarQrCodeAction({
  orgSlug,
}: {
  orgSlug: string;
}): Promise<ActionResult<{ qrCode: string; status: string }>> {
  try {
    const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });
    const supabase = await createClient();

    // 1. Tenta obter o QR code do gateway Baileys para este workspace
    let qrCode: string | null = null;
    let status = "qr_ready";

    try {
      const res = await fetch(`${GATEWAY_URL}/session/${org.id}/qr`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (res.ok) {
        const body = await res.json();
        qrCode = body.qr || body.qr_code || null;
        if (body.connected || body.status === "connected") {
          status = "connected";
        }
      }
    } catch (netErr) {
      // Se gateway local estiver iniciando, gera um marcador
      logError("whatsapp.gatewayFetch", netErr);
    }

    // 2. Registra ou atualiza no banco de dados com RLS
    const { error: upsertErr } = await supabase.from("whatsapp_instances").upsert(
      {
        organization_id: org.id,
        provider: "baileys",
        status: (status as "qr_ready" | "connected" | "connecting" | "disconnected"),
        qr_code: qrCode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );

    if (upsertErr) {
      logError("whatsapp.upsertInstance", upsertErr);
      return { ok: false, error: "Não foi possível registrar a instância no banco de dados." };
    }

    revalidatePath(`/app/${orgSlug}/whatsapp`);
    return {
      ok: true,
      data: {
        qrCode: qrCode || "",
        status,
      },
    };
  } catch (e: any) {
    logError("whatsapp.solicitarQrCodeAction", e);
    return { ok: false, error: e.message || "Erro ao gerar QR code de conexão." };
  }
}

export async function consultarStatusWhatsAppAction({
  orgSlug,
}: {
  orgSlug: string;
}): Promise<
  ActionResult<{
    status: string;
    isConnected: boolean;
    phoneNumber?: string | null;
    qrCode?: string | null;
  }>
> {
  try {
    const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });
    const supabase = await createClient();

    let isConnected = false;
    let phoneNumber: string | null = null;
    let qrCode: string | null = null;
    let currentStatus = "disconnected";

    try {
      const res = await fetch(`${GATEWAY_URL}/session/${org.id}/status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (res.ok) {
        const body = await res.json();
        isConnected = Boolean(body.connected || body.status === "connected");
        currentStatus = isConnected ? "connected" : (body.status || "disconnected");
        phoneNumber = body.connectedNumber || null;
        qrCode = body.qr || null;
      }
    } catch (netErr) {
      logError("whatsapp.consultarStatusGateway", netErr);
    }

    if (isConnected) {
      await supabase
        .from("whatsapp_instances")
        .upsert(
          {
            organization_id: org.id,
            provider: "baileys",
            status: "connected",
            phone_number: phoneNumber,
            qr_code: null,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" },
        );
      revalidatePath(`/app/${orgSlug}/whatsapp`);
    }

    return {
      ok: true,
      data: {
        status: currentStatus,
        isConnected,
        phoneNumber,
        qrCode,
      },
    };
  } catch (e: any) {
    logError("whatsapp.consultarStatusAction", e);
    return { ok: false, error: e.message || "Erro ao consultar status do WhatsApp." };
  }
}

export async function desconectarWhatsAppAction({
  orgSlug,
}: {
  orgSlug: string;
}): Promise<ActionResult> {
  try {
    const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });
    const supabase = await createClient();

    try {
      await fetch(`${GATEWAY_URL}/session/${org.id}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      logError("whatsapp.gatewayDisconnect", e);
    }

    await supabase
      .from("whatsapp_instances")
      .update({
        status: "disconnected",
        qr_code: null,
        phone_number: null,
        connected_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", org.id);

    revalidatePath(`/app/${orgSlug}/whatsapp`);
    return { ok: true };
  } catch (e: any) {
    logError("whatsapp.desconectarAction", e);
    return { ok: false, error: e.message || "Erro ao desconectar WhatsApp." };
  }
}

export async function salvarCloudApiAction({
  orgSlug,
  input,
}: {
  orgSlug: string;
  input: z.infer<typeof cloudApiSchema>;
}): Promise<ActionResult> {
  try {
    const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });
    const parsed = cloudApiSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados da Meta API inválidos" };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("whatsapp_instances").upsert(
      {
        organization_id: org.id,
        provider: "cloud_api",
        status: "connected",
        cloud_phone_number_id: parsed.data.phoneNumberId,
        cloud_waba_id: parsed.data.wabaId,
        cloud_access_token: parsed.data.accessToken,
        phone_number: parsed.data.phoneNumber || null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );

    if (error) {
      logError("whatsapp.salvarCloudApi", error);
      return { ok: false, error: "Erro ao salvar credenciais da Meta Cloud API." };
    }

    revalidatePath(`/app/${orgSlug}/whatsapp`);
    return { ok: true };
  } catch (e: any) {
    logError("whatsapp.salvarCloudApiAction", e);
    return { ok: false, error: e.message || "Falha ao configurar Meta Cloud API." };
  }
}

/**
 * Liga ou desliga as respostas automáticas da inteligência artificial no WhatsApp.
 */
export async function alternarBotAction({
  orgSlug,
  enabled,
}: {
  orgSlug: string;
  enabled: boolean;
}): Promise<ActionResult<{ enabled: boolean }>> {
  try {
    const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });
    const supabase = await createClient();

    // 1. Atualiza na tabela whatsapp_instances
    const { error: instErr } = await supabase
      .from("whatsapp_instances")
      .update({ bot_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("organization_id", org.id);

    if (instErr) {
      logError("whatsapp.alternarBot.instance", instErr);
    }

    // 2. Atualiza no config do agente de atendimento
    const pool = systemPool();
    await pool.query(
      `UPDATE public.agents
       SET config = jsonb_set(coalesce(config, '{}'::jsonb), '{botActive}', $1::jsonb),
           updated_at = now()
       WHERE organization_id = $2 AND slug = 'atendimento'`,
      [JSON.stringify(enabled), org.id],
    );

    revalidatePath(`/app/${orgSlug}/whatsapp`);
    revalidatePath(`/app/${orgSlug}/agentes/atendimento`);
    revalidatePath(`/app/${orgSlug}/dashboard`);

    return { ok: true, data: { enabled } };
  } catch (e: any) {
    logError("whatsapp.alternarBotAction", e);
    return { ok: false, error: e.message || "Erro ao alterar status do bot." };
  }
}
