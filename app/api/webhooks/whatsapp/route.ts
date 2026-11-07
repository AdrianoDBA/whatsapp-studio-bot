import { NextResponse } from "next/server";
import { generateText } from "ai";
import { buildLanguageModel } from "@/lib/ai/providers";
import { systemPool } from "@/lib/automation/pg";
import { logError } from "@/lib/logger";
import { openSecret } from "@/lib/secrets/crypto";

export const runtime = "nodejs";

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

    let from = "";
    let incomingText = "";
    let sessionId = "default";
    let isBaileys = false;

    // 1. Suporte a Baileys Gateway
    if (body.from && (body.text || body.message)) {
      isBaileys = true;
      from = body.from;
      incomingText = typeof body.text === "string" ? body.text : body.text?.body || body.message?.body || "";
      sessionId = body.sessionId || body.profile || "default";

      // Ignora mensagens do próprio bot (anti-loop)
      if (body.is_self_chat && !body.allow_self) {
        // Ignora
      }
    } else {
      // 2. Suporte a Meta Cloud API
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (message && message.from) {
        from = message.from;
        incomingText = message.text?.body || "";
        sessionId = value.metadata?.phone_number_id || "default";
      }
    }

    if (!from || !incomingText.trim()) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Processa a mensagem em segundo plano com o Agente Inteligente
    (async () => {
      try {
        const pool = systemPool();

        // 1. Localiza a organização correspondente
        let orgId = sessionId;
        const orgRes = await pool.query(
          `SELECT id, slug, name FROM public.organizations WHERE id::text = $1 OR slug = $1 LIMIT 1`,
          [sessionId],
        );

        let orgName = "AtendeAI";
        if (orgRes.rows.length > 0) {
          orgId = orgRes.rows[0].id;
          orgName = orgRes.rows[0].name;
        } else {
          // Se não encontrou por ID direto, pega a primeira organização ativa
          const firstOrg = await pool.query(`SELECT id, slug, name FROM public.organizations LIMIT 1`);
          if (firstOrg.rows.length > 0) {
            orgId = firstOrg.rows[0].id;
            orgName = firstOrg.rows[0].name;
          }
        }

        // 2. Localiza o Agente de Atendimento
        const agentRes = await pool.query(
          `SELECT id, slug, name, system_prompt, model, tools, config
           FROM public.agents
           WHERE organization_id = $1 AND (slug = 'atendimento' OR status = 'active')
           ORDER BY (slug = 'atendimento') DESC
           LIMIT 1`,
          [orgId],
        );

        const agent = agentRes.rows[0];
        const cfg = agent?.config || {};
        const nomeAssistente = cfg.assistantName || "assistente virtual";
        const nomeEmpresa = cfg.companyName || orgName;

        const systemPrompt =
          agent?.system_prompt ||
          `Você é ${nomeAssistente}, a secretária e assistente virtual da empresa ${nomeEmpresa}. Responda com simpatia, cordialidade e precisão em português.`;

        // 3. Localiza as credenciais de IA configuradas para a organização
        const credRes = await pool.query(
          `SELECT provider, ciphertext, key_version
           FROM public.credentials
           WHERE organization_id = $1
           ORDER BY (provider = 'google') DESC, created_at DESC
           LIMIT 1`,
          [orgId],
        );

        let respostaTexto = "";

        if (credRes.rows.length > 0) {
          const cred = credRes.rows[0];
          try {
            const apiKey = openSecret(
              { ciphertext: cred.ciphertext, keyVersion: cred.key_version },
              { organizationId: orgId, provider: cred.provider },
            );

            // Determina o modelo: se for Google, usa o gemini-3.5-flash-lite para estabilidade
            const provider = cred.provider === "google" ? "google" : "openrouter";
            const providerModelId =
              provider === "google" ? "gemini-3.5-flash-lite" : "google/gemini-3.7-flash";

            const model = buildLanguageModel({
              provider,
              providerModelId,
              apiKey,
            });

            const result = await generateText({
              model,
              system: systemPrompt,
              prompt: incomingText,
            });

            respostaTexto = result.text.trim();
          } catch (aiErr: any) {
            logError("whatsapp.aiGenerationError", aiErr);
          }
        }

        // Resposta de fallback caso a IA esteja temporariamente fora ou sem chave
        if (!respostaTexto) {
          respostaTexto = `Olá! Agradecemos sua mensagem. Sou ${nomeAssistente}, assistente virtual da ${nomeEmpresa}. Recebi seu contato e já vou te auxiliar! Em que posso ajudar você hoje?`;
        }

        // 4. Envia de volta pelo Gateway Baileys
        if (isBaileys) {
          await fetch(`${GATEWAY_URL}/session/${sessionId}/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: from, text: respostaTexto }),
          });
        }
      } catch (procErr: any) {
        logError("whatsapp.processMessageError", procErr);
      }
    })().catch((bgErr) => logError("whatsapp.backgroundRunner", bgErr));

    return NextResponse.json({ ok: true, status: "queued" });
  } catch (err: any) {
    logError("whatsapp.webhook", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
