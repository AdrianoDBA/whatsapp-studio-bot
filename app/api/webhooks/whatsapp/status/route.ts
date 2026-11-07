import { NextResponse } from "next/server";
import { systemPool } from "@/lib/automation/pg";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId = body.sessionId || body.profile;
    const status = body.status;
    const connectedNumber = body.connectedNumber;
    const lastConnected = body.lastConnected;

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "sessionId obrigatório" }, { status: 400 });
    }

    const pool = systemPool();
    if (status === "connected") {
      await pool.query(
        `UPDATE public.whatsapp_instances
         SET status = 'connected',
             phone_number = COALESCE($1, phone_number),
             connected_at = COALESCE($2, NOW()),
             qr_code = NULL,
             updated_at = NOW()
         WHERE organization_id = $3`,
        [connectedNumber || null, lastConnected || new Date().toISOString(), sessionId],
      );
    } else if (status === "disconnected") {
      await pool.query(
        `UPDATE public.whatsapp_instances
         SET status = 'disconnected',
             phone_number = NULL,
             connected_at = NULL,
             qr_code = NULL,
             updated_at = NOW()
         WHERE organization_id = $1`,
        [sessionId],
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    logError("whatsapp.statusWebhook", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
