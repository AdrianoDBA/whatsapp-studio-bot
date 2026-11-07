"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { getAppUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth/guards";
import { systemPool } from "@/lib/automation/pg";
import { getEmailProvider } from "@/lib/email";
import { InvitationEmail } from "@/lib/email/templates/invitation";
import { logError } from "@/lib/logger";
import { materializarWorkspace } from "@/lib/seed/materializar";
import { createClient } from "@/lib/supabase/server";
import { buildSecretaryPrompt, type SecretaryConfig, type SecretaryTone } from "@/lib/whatsapp/secretary-prompt";
import {
  criarNovoClienteSchema,
  type CriarNovoClienteInput,
  type CriarNovoClienteOutput,
} from "./novo-cliente-schema";
import { slugify } from "./slug";


/**
 * Gera um slug amigável e único para a nova organização
 */
async function gerarSlugDisponivel(baseName: string, supabase: any): Promise<string> {
  let baseSlug = slugify(baseName);
  if (!baseSlug || baseSlug.length < 3) {
    baseSlug = `empresa-${Math.random().toString(36).substring(2, 6)}`;
  }

  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", baseSlug)
    .maybeSingle();

  if (!existing) {
    return baseSlug;
  }

  for (let i = 2; i <= 50; i++) {
    const candidate = `${baseSlug.slice(0, 36)}-${i}`;
    const { data: found } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!found) return candidate;
  }

  return `${baseSlug.slice(0, 33)}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Cria o workspace de um novo cliente, materializa o agente de atendimento com nome
 * e empresa personalizados, e gera o link de ativação com mensagem pronta para WhatsApp.
 */
export async function criarNovoClienteAction(
  input: CriarNovoClienteInput,
): Promise<ActionResult<CriarNovoClienteOutput>> {
  const parsed = criarNovoClienteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await requireUser();
  const supabase = await createClient();

  const slug = await gerarSlugDisponivel(parsed.data.empresaNome, supabase);

  // 1. Cria a organização via RPC atômica (inclui o usuário atual como owner)
  const { data: org, error: orgError } = await supabase
    .rpc("create_organization_with_owner", {
      _name: parsed.data.empresaNome.trim(),
      _slug: slug,
    })
    .single();

  if (orgError || !org?.id) {
    if (orgError?.message?.includes("23505") || orgError?.message?.toLowerCase().includes("duplicate")) {
      return { ok: false, error: "Um workspace com este nome já existe. Tente outro nome." };
    }
    logError("novo-cliente.create_org", orgError);
    return { ok: false, error: "Falha ao criar o ambiente do cliente. Tente novamente." };
  }

  // 2. Materializa os agentes e bases da organização
  try {
    const resultado = await materializarWorkspace(supabase, org.id, user.id);
    if (resultado.agendamentosPulados.length > 0) {
      logError("novo-cliente.semear.pulados", new Error(resultado.agendamentosPulados.join(", ")));
    }
  } catch (err) {
    logError("novo-cliente.semear", err);
  }

  // 3. Inicializa a configuração da secretária virtual com os dados da empresa
  const assistantName = parsed.data.assistenteNome?.trim() || "Sofia";
  const tone: SecretaryTone = parsed.data.tom || "acolhedor";
  const initialConfig: SecretaryConfig = {
    assistantName,
    companyName: parsed.data.empresaNome.trim(),
    tone,
    servicesText: parsed.data.servicosIniciais?.trim() || "",
    businessHours: "Segunda a Sexta das 08h às 18h",
    paymentMethods: "Pix, Cartão de Crédito e Dinheiro",
    humanHandoff: "Caso o cliente solicite falar com um atendente humano ou precise de algo urgente, informe que nossa equipe entrará em contato em breve.",
    additionalNotes: "",
  };

  const initialPrompt = buildSecretaryPrompt(initialConfig);

  try {
    const pool = systemPool();
    await pool.query(
      `UPDATE public.agents
       SET name = $1,
           system_prompt = $2,
           config = $3,
           updated_at = now()
       WHERE organization_id = $4 AND slug = 'atendimento'`,
      [
        `Secretária (${assistantName})`,
        initialPrompt,
        JSON.stringify(initialConfig),
        org.id,
      ],
    );
  } catch (err) {
    logError("novo-cliente.personalizar_secretaria", err);
  }

  // 4. Cria o convite de Admin para o cliente
  const emailLower = parsed.data.clienteEmail.toLowerCase().trim();
  const { data: invitation, error: inviteError } = await supabase
    .from("invitations")
    .insert({
      organization_id: org.id,
      email: emailLower,
      role: "admin",
      invited_by: user.id,
    })
    .select("token")
    .single();

  if (inviteError || !invitation?.token) {
    logError("novo-cliente.create_invitation", inviteError);
    return { ok: false, error: "Ambiente criado, mas houve falha ao gerar o convite do cliente." };
  }

  // 5. Monta a URL de ativação e a mensagem personalizada do WhatsApp
  const appUrl = await getAppUrl();
  const acceptUrl = `${appUrl}/aceitar-convite?token=${invitation.token}`;

  const whatsappMessage = `Olá! O ambiente exclusivo da *${parsed.data.empresaNome.trim()}* no AtendeAI já está pronto 🎉

Acesse o link abaixo para criar sua senha de acesso e ativar sua secretária com inteligência artificial:
👉 ${acceptUrl}

*Passo a passo rápido (menos de 2 minutos):*
1️⃣ Abra o link acima e crie sua senha de acesso.
2️⃣ Conecte o WhatsApp lendo o QR Code com a câmera do seu celular (igual ao WhatsApp Web).
3️⃣ Ajuste o nome da sua secretária, horários e seus serviços/preços.

Assim que conectar, a sua secretária já começará a atender seus clientes automaticamente! Qualquer dúvida estou à disposição.`;

  let whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;
  if (parsed.data.telefone) {
    const cleanPhone = parsed.data.telefone.replace(/\D/g, "");
    if (cleanPhone) {
      whatsappShareUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(whatsappMessage)}`;
    }
  }

  // 6. Envio opcional de e-mail (caso o serviço de e-mail esteja configurado)
  let emailSent = false;
  try {
    const provider = await getEmailProvider({ organizationId: org.id, supabase });
    const emailResult = await provider.send({
      to: emailLower,
      subject: `Seu ambiente AtendeAI está pronto - ${parsed.data.empresaNome}`,
      react: InvitationEmail({
        inviterName: "AtendeAI",
        orgName: parsed.data.empresaNome,
        acceptUrl,
      }),
    });
    emailSent = emailResult.ok;
  } catch {
    // E-mail é secundário no fluxo via WhatsApp
  }

  revalidatePath("/app");

  return {
    ok: true,
    data: {
      orgId: org.id,
      orgSlug: org.slug,
      orgName: parsed.data.empresaNome.trim(),
      acceptUrl,
      whatsappMessage,
      whatsappShareUrl,
      token: invitation.token,
      emailSent,
    },
  };
}
