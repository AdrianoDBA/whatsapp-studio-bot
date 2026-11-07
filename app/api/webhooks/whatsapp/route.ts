import { NextResponse } from "next/server";
import { logError } from "@/lib/logger";

const GATEWAY_URL = process.env.WHATSAPP_GATEWAY_URL || "http://127.0.0.1:5006";
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "studio_verify_token_2026";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge || "", { status: 200 });
  }

  return NextResponse.json({ error: "Token de verificação inválido" }, { status: 403 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // 1. Suporte ao formato Baileys Gateway
    if (body.from && body.text) {
      const from = body.from;
      const text = body.text;
      const sessionId = body.sessionId || "default";

      // Responde com mensagem de atendimento padrão ou invoca o agente
      const resposta = `Olá! Agradecemos o contato. Sou o assistente virtual de atendimento da empresa. Como posso te ajudar hoje?`;

      // Envia resposta de volta pelo gateway de forma assíncrona
      fetch(`${GATEWAY_URL}/session/${sessionId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: from, text: resposta }),
      }).catch((err) => logError("whatsapp.sendReply", err));

      return NextResponse.json({ ok: true, status: "processed" });
    }

    // 2. Suporte ao formato Meta Cloud API
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (message && message.from) {
      const from = message.from;
      const text = message.text?.body || "";
      const phoneNumberId = value.metadata?.phone_number_id;

      // Resposta padrão
      return NextResponse.json({ ok: true, received: true });
    }

    return NextResponse.json({ ok: true, ignored: true });
  } catch (err: any) {
    logError("whatsapp.webhook", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
