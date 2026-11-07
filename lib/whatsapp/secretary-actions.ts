"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireOrgMember } from "@/lib/auth/guards";
import { systemPool } from "@/lib/automation/pg";
import { buildSecretaryPrompt, type SecretaryConfig, type SecretaryTone } from "./secretary-prompt";

const secretaryConfigSchema = z.object({
  orgSlug: z.string().min(1, "Slug da organização é obrigatório"),
  agentId: z.string().uuid("ID do agente inválido"),
  assistantName: z.string().min(1, "Nome da assistente é obrigatório").max(60, "Máximo de 60 caracteres"),
  companyName: z.string().min(1, "Nome da empresa é obrigatório").max(80, "Máximo de 80 caracteres"),
  tone: z.enum(["acolhedor", "profissional", "objetivo", "descontraido"]),
  servicesText: z.string().max(8000, "Tabela de serviços muito longa (máximo 8.000 caracteres)"),
  businessHours: z.string().max(500, "Horários muito longos (máximo 500 caracteres)"),
  paymentMethods: z.string().max(500, "Formas de pagamento muito longas (máximo 500 caracteres)"),
  humanHandoff: z.string().max(1000, "Regra de transbordo muito longa (máximo 1.000 caracteres)"),
  additionalNotes: z.string().max(3000, "Observações muito longas (máximo 3.000 caracteres)"),
  directPrompt: z.string().max(18000, "Prompt muito longo").optional(),
  botActive: z.boolean().optional(),
});

export type SalvarConfiguracaoInput = z.infer<typeof secretaryConfigSchema>;

/**
 * Salva as configurações da secretária virtual diretamente pelo workspace,
 * atualizando o banco de dados e o prompt do WhatsApp em tempo real sem precisar recompilar.
 */
export async function salvarConfiguracaoSecretariaAction(
  input: SalvarConfiguracaoInput,
): Promise<ActionResult<{ systemPrompt: string; config: SecretaryConfig }>> {
  try {
    const parsed = secretaryConfigSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Dados de configuração inválidos.",
      };
    }

    const { org, role } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });

    if (role !== "owner" && role !== "admin") {
      return {
        ok: false,
        error: "Apenas donos ou administradores do workspace podem alterar a configuração da secretária.",
      };
    }

    const pool = systemPool();

    // 1. Localiza o agente no workspace
    const agentRes = await pool.query(
      `SELECT id, slug, name, system_prompt, config
       FROM public.agents
       WHERE id = $1 AND organization_id = $2
       LIMIT 1`,
      [parsed.data.agentId, org.id],
    );

    if (agentRes.rows.length === 0) {
      return {
        ok: false,
        error: "Agente não encontrado neste workspace.",
      };
    }

    const currentAgent = agentRes.rows[0];

    const config: SecretaryConfig = {
      assistantName: parsed.data.assistantName.trim(),
      companyName: parsed.data.companyName.trim(),
      tone: parsed.data.tone as SecretaryTone,
      servicesText: parsed.data.servicesText.trim(),
      businessHours: parsed.data.businessHours.trim(),
      paymentMethods: parsed.data.paymentMethods.trim(),
      humanHandoff: parsed.data.humanHandoff.trim(),
      additionalNotes: parsed.data.additionalNotes.trim(),
      botActive: parsed.data.botActive ?? currentAgent.config?.botActive ?? true,
    };

    // Compila o prompt novo (ou usa o prompt direto se o usuário editou na aba avançada)
    const systemPrompt = parsed.data.directPrompt?.trim()
      ? parsed.data.directPrompt.trim()
      : buildSecretaryPrompt(config, org.name);

    const agentName = `Secretária ${config.assistantName || "Virtual"}`;
    const agentDescription = `Assistente virtual inteligente e secretária de ${config.companyName || org.name}.`;

    // 2. Atualiza a tabela public.agents
    await pool.query(
      `UPDATE public.agents
       SET config = $1,
           system_prompt = $2,
           name = $3,
           description = $4,
           updated_at = now()
       WHERE id = $5 AND organization_id = $6`,
      [
        JSON.stringify(config),
        systemPrompt,
        agentName,
        agentDescription,
        currentAgent.id,
        org.id,
      ],
    );

    // Sincroniza também com whatsapp_instances
    await pool.query(
      `UPDATE public.whatsapp_instances
       SET bot_enabled = $1, updated_at = now()
       WHERE organization_id = $2`,
      [config.botActive, org.id],
    );

    // 3. Revalida as páginas do workspace
    revalidatePath(`/app/${parsed.data.orgSlug}/agentes`);
    revalidatePath(`/app/${parsed.data.orgSlug}/agentes/${currentAgent.slug}`);
    revalidatePath(`/app/${parsed.data.orgSlug}/whatsapp`);
    revalidatePath(`/app/${parsed.data.orgSlug}/dashboard`);

    return {
      ok: true,
      data: {
        systemPrompt,
        config,
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err.message || "Erro inesperado ao salvar configuração da secretária.",
    };
  }
}
