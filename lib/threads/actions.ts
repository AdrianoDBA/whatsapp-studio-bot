"use server";

/**
 * As funções do servidor da conversa: começar, renomear e apagar.
 *
 * ⚠️ TODA FUNÇÃO AQUI CHAMA O GUARD DENTRO DELA MESMA.
 * Função marcada com "use server" é um endereço público da internet: dá pra
 * chamar sem passar pela tela. "A página só mostra o botão pra quem pode" não
 * protege nada sozinho.
 *
 * Repare no que NÃO tem aqui: mandar mensagem. Mensagem vai pela rota
 * `/api/chat`, porque a resposta chega letra por letra e função do servidor não
 * sabe fazer isso.
 */
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { getAgentBySlug } from "@/lib/agents/queries";
import { requireOrgMember } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import {
  type DeleteThreadInput,
  deleteThreadSchema,
  type RenameThreadInput,
  renameThreadSchema,
  type StartThreadInput,
  startThreadSchema,
} from "./schemas";

/**
 * Começa uma conversa nova com aquele agente.
 *
 * Qualquer membro do workspace pode. Agente aposentado é recusado AQUI, antes
 * de criar a linha — abrir uma conversa que não vai responder nada seria só um
 * beco sem saída.
 */
export async function startThreadAction(
  input: StartThreadInput,
): Promise<ActionResult<{ threadId: string }>> {
  const parsed = startThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Não entendi qual conversa você quer começar." };
  }

  const { user, org } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });

  const agent = await getAgentBySlug(org.id, parsed.data.agentSlug);
  if (!agent) {
    return { ok: false, error: "Esse agente não existe mais neste workspace." };
  }
  if (agent.status === "archived") {
    return {
      ok: false,
      error:
        `O agente "${agent.name}" está aposentado, então ele não conversa. Abra ele no ` +
        'painel e mude a situação pra "No ar".',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("threads")
    .insert({
      organization_id: org.id,
      agent_id: agent.id,
      // A policy do banco exige `auth.uid() = user_id`: não dá pra abrir
      // conversa no nome de outra pessoa.
      user_id: user.id,
      title: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    logError("threads.startThreadAction", error);
    return {
      ok: false,
      error: "Não deu pra começar a conversa agora. Tente de novo em alguns segundos.",
    };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/agentes/${parsed.data.agentSlug}/conversar`);
  return { ok: true, data: { threadId: data.id } };
}

/**
 * Renomeia a conversa.
 *
 * Só quem COMEÇOU renomeia — quem decide isso é a policy de UPDATE do banco, e
 * a permissão de escrita é **só da coluna `title`**. Contador e data do último
 * balão são do gatilho; ninguém escreve neles na mão.
 */
export async function renameThreadAction(input: RenameThreadInput): Promise<ActionResult> {
  const parsed = renameThreadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Escreva um nome pra conversa.",
    };
  }

  const { org } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("threads")
    .update({ title: parsed.data.title })
    .eq("organization_id", org.id)
    .eq("id", parsed.data.threadId)
    .select("id");

  if (error) {
    logError("threads.renameThreadAction", error);
    return { ok: false, error: "Não deu pra renomear essa conversa agora. Tente de novo." };
  }
  // Zero linha mexida = a regra de segurança do banco recusou. Quem não começou
  // a conversa não renomeia ela.
  if ((data ?? []).length === 0) {
    return { ok: false, error: "Só quem começou a conversa pode renomear ela." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}`);
  return { ok: true };
}

/**
 * Apaga a conversa inteira.
 *
 * Quem começou apaga a dele; dono e admin apagam a de qualquer um (é a mesma
 * regra do resto do workspace). Quem decide é a policy de DELETE do banco.
 *
 * ⚠️ O RASTRO NÃO SOME. `agent_runs` e `agent_run_steps` continuam lá, com a
 * pergunta, a resposta e o custo — a tela avisa isso com essas palavras.
 */
export async function deleteThreadAction(input: DeleteThreadInput): Promise<ActionResult> {
  const parsed = deleteThreadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Não entendi qual conversa você quer apagar." };
  }

  const { org } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("threads")
    .delete()
    .eq("organization_id", org.id)
    .eq("id", parsed.data.threadId)
    .select("id");

  if (error) {
    logError("threads.deleteThreadAction", error);
    return { ok: false, error: "Não deu pra apagar essa conversa agora. Tente de novo." };
  }
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      error: "Essa conversa não existe mais, ou você não pode apagar a conversa de outra pessoa.",
    };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}`);
  return { ok: true };
}
