"use server";

/**
 * As funções do servidor da tela de Automações.
 *
 * ⚠️ TODA FUNÇÃO AQUI CHAMA O GUARD DENTRO DELA MESMA.
 * Função marcada com "use server" é um endereço público da internet: dá pra
 * chamar sem passar pela tela. "A página só mostra o botão pra quem pode" não
 * protege nada sozinho.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️ A REGRA MAIS FÁCIL DE ERRAR AQUI: NINGUÉM ARMA AUTOMAÇÃO NO NOME DE   │
 * │ OUTRA PESSOA.                                                            │
 * │                                                                          │
 * │ As policies de `schedules` e `webhook_endpoints` exigem, no INSERT,      │
 * │ `auth.uid() = created_by` E `auth.uid() = run_as`; no UPDATE, exigem     │
 * │ `auth.uid() = run_as` no `with check`. Ou seja: o banco recusa qualquer  │
 * │ tentativa de fazer o agente rodar no nome de outro (ameaças T1 e T2).    │
 * │                                                                          │
 * │ A consequência prática, e é ela que morde: **editar o agendamento de     │
 * │ outra pessoa FALHA**, mesmo sendo administrador. Por isso existe o botão │
 * │ "Assumir" — ele aponta o `run_as` pra si mesmo primeiro. Toda função que │
 * │ dá `update` aqui confere isso ANTES, pra devolver uma frase que explica  │
 * │ em vez de um erro cru do banco.                                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { getAppUrl } from "@/lib/app-url";
import { requireOrgRole } from "@/lib/auth/guards";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import {
  type AcaoEmAgendamentoInput,
  type AcaoEmWebhookInput,
  type AlternarModoDoAgendamentoInput,
  type AlternarModoDoWebhookInput,
  acaoEmAgendamentoSchema,
  acaoEmWebhookSchema,
  alternarModoDoAgendamentoSchema,
  alternarModoDoWebhookSchema,
  type GirarTokenInput,
  girarTokenSchema,
  type LigarDesligarAgendamentoInput,
  ligarDesligarAgendamentoSchema,
  type RodarAgoraInput,
  rodarAgoraSchema,
} from "./schemas";
import { gerarTokenDeWebhook, montarUrlDoWebhook } from "./webhooks";

/** A primeira mensagem de erro do formato, ou uma frase genérica. */
function primeiroErro(issues: { message: string }[]): string {
  return issues[0]?.message ?? "Confira os dados e tente de novo.";
}

/**
 * Traduz o que o banco reclamou quando alguém tenta enfileirar um trabalho.
 *
 * ⚠️ NUNCA devolva `error.message` do Postgres direto (regra 6 do CLAUDE.md):
 * ele vem em inglês e mostra o nome interno das tabelas.
 */
function traduzirErroDeFila(mensagem: string): string {
  if (mensagem.includes("too many jobs")) {
    return (
      "Esse workspace já tem muitos trabalhos esperando na fila. Espere os que estão " +
      "rodando terminarem e tente de novo."
    );
  }
  if (mensagem.includes("agent is archived")) {
    return "Esse agente está aposentado. Reative ele na tela de Agentes antes de rodar.";
  }
  if (mensagem.includes("agent not found") || mensagem.includes("schedule not found")) {
    return "Essa automação aponta pra um agente que não existe mais neste workspace.";
  }
  return "Não deu pra colocar essa automação na fila agora. Tente de novo.";
}

// ---------------------------------------------------------------------------
// Agendamentos — não têm função que CRIE. Um agendamento nasce de arquivo
// (`lib/automation/blueprint.ts`) e é gravado por `materializarWorkspace`,
// sempre DESLIGADO e em modo ensaio (regras 10-L). O que sobra aqui é operar
// o que já existe: ligar/desligar, trocar o modo, assumir e rodar agora.
// ---------------------------------------------------------------------------

/**
 * A linha do agendamento que as funções de edição precisam conferir antes de
 * tocar no banco.
 */
async function lerAgendamento(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedules")
    .select("id, name, agent_id, run_as, is_active, input")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logError("automation.lerAgendamento", error);
    throw new Error("Não deu pra carregar esse agendamento agora. Tente de novo.");
  }
  return data;
}

/** Liga ou desliga o agendamento. Desligado, ele simplesmente não é varrido. */
export async function ligarDesligarAgendamentoAction(
  input: LigarDesligarAgendamentoInput,
): Promise<ActionResult> {
  const parsed = ligarDesligarAgendamentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { user, org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const agendamento = await lerAgendamento(org.id, parsed.data.id);
  if (!agendamento) {
    return { ok: false, error: "Esse agendamento não existe mais neste workspace." };
  }

  // Ver o aviso do topo: o banco recusa mexer num agendamento que roda no nome
  // de outra pessoa. Melhor explicar do que deixar estourar lá.
  if (agendamento.run_as !== user.id) {
    return {
      ok: false,
      error:
        "Essa automação roda no nome de outra pessoa. Clique em “Assumir” primeiro — aí ela " +
        "passa a rodar no seu nome e você consegue ligar e desligar.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedules")
    .update(
      parsed.data.ativo
        ? // Ligar de novo limpa o último erro: senão a tela continua mostrando
          // um problema que já foi resolvido.
          { is_active: true, last_error: null }
        : { is_active: false },
    )
    .eq("organization_id", org.id)
    .eq("id", parsed.data.id);

  if (error) {
    logError("automation.ligarDesligarAgendamento", error);
    return { ok: false, error: "Não deu pra mudar esse agendamento agora. Tente de novo." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/automacoes`);
  return { ok: true };
}

/**
 * Liga ou desliga o MODO REAL do agendamento.
 *
 * Em ensaio (o padrão de nascença), o agente roda de verdade e mostra o que
 * faria, mas nenhuma ferramenta de ação chega a sair pra fora (não manda
 * email, não chama sistema nenhum de fora) — ver `lib/agents/acoes.ts`. Só
 * este botão liga o modo real; a automação NUNCA nasce ligada.
 *
 * ⚠️ Mesma regra do "Ligar/Desligar": o banco recusa mexer num agendamento
 * que roda no nome de outra pessoa. Confere ANTES pra devolver a frase que
 * manda clicar em "Assumir", em vez do erro cru do banco.
 */
export async function alternarModoDoAgendamentoAction(
  input: AlternarModoDoAgendamentoInput,
): Promise<ActionResult> {
  const parsed = alternarModoDoAgendamentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { user, org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const agendamento = await lerAgendamento(org.id, parsed.data.scheduleId);
  if (!agendamento) {
    return { ok: false, error: "Esse agendamento não existe mais neste workspace." };
  }

  if (agendamento.run_as !== user.id) {
    return {
      ok: false,
      error:
        "Essa automação roda no nome de outra pessoa. Clique em “Assumir” primeiro — aí ela " +
        "passa a rodar no seu nome e você consegue trocar o modo dela.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedules")
    .update({ modo: parsed.data.modo })
    .eq("organization_id", org.id)
    .eq("id", parsed.data.scheduleId);

  if (error) {
    logError("automation.alternarModoDoAgendamento", error);
    return { ok: false, error: "Não deu pra mudar o modo dessa automação agora. Tente de novo." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/automacoes`);
  return { ok: true };
}

/**
 * "Assumir": a automação passa a rodar no SEU nome.
 *
 * É o conserto de dois casos reais:
 *  • quem armou saiu do workspace (o banco desliga a automação sozinho e
 *    escreve o motivo em `last_error`);
 *  • quem administra quer editar/ligar um agendamento que outra pessoa criou.
 *
 * ⚠️ Isto NÃO liga a automação de volta, de propósito. Assumir e ligar são
 * duas decisões: quem assume precisa olhar o que a automação faz antes de
 * soltar ela pra rodar sozinha no seu nome.
 */
export async function assumirAgendamentoAction(
  input: AcaoEmAgendamentoInput,
): Promise<ActionResult> {
  const parsed = acaoEmAgendamentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { user, org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const agendamento = await lerAgendamento(org.id, parsed.data.id);
  if (!agendamento) {
    return { ok: false, error: "Esse agendamento não existe mais neste workspace." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedules")
    .update({ run_as: user.id, last_error: null })
    .eq("organization_id", org.id)
    .eq("id", parsed.data.id);

  if (error) {
    logError("automation.assumirAgendamento", error);
    return { ok: false, error: "Não deu pra assumir esse agendamento agora. Tente de novo." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/automacoes`);
  return { ok: true };
}

/**
 * "Rodar agora": põe UM trabalho na fila, sem esperar a hora marcada.
 *
 * ⚠️ ELE RODA NO SEU NOME, não no de quem armou o agendamento. Quem grava isso
 * é a função do banco (`enqueue_agent_job` usa `auth.uid()`), então não existe
 * caminho pra pedir "rode no nome de outra pessoa" — nem daqui, nem por fora.
 *
 * ⚠️ O trabalho entra na FILA. Quem tira ele de lá é o trabalhador (o segundo
 * processo do container). Se o app estiver rodando sem `DATABASE_URL`, ou sem
 * o trabalhador no ar, o trabalho fica esperando — e é por isso que a tela
 * avisa quando o trabalhador não está batendo ponto.
 */
export async function rodarAgoraAction(
  input: RodarAgoraInput,
): Promise<ActionResult<{ jobId: string }>> {
  const parsed = rodarAgoraSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const agendamento = await lerAgendamento(org.id, parsed.data.scheduleId);
  if (!agendamento) {
    return { ok: false, error: "Esse agendamento não existe mais neste workspace." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enqueue_agent_job", {
    _agent_id: agendamento.agent_id,
    _input: agendamento.input,
    _source_kind: "schedule",
    _source_id: parsed.data.scheduleId,
  });

  if (error || !data) {
    logError("automation.rodarAgora", error);
    return { ok: false, error: traduzirErroDeFila(error?.message ?? "") };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/automacoes`);
  return { ok: true, data: { jobId: data } };
}

// ---------------------------------------------------------------------------
// Webhooks — não têm função que CRIE. Um webhook nasce de arquivo
// (`lib/automation/blueprint.ts`): o token é sorteado e descartado na
// materialização (ninguém vê), o que já nasce inutilizável de propósito. Quem
// precisa do endereço utilizável usa "Gerar token", abaixo.
// ---------------------------------------------------------------------------

/**
 * Girar o segredo, mantendo o endereço.
 *
 * Isto substituiu `revogarWebhookAction`, que APAGAVA a linha. A justificativa
 * antiga ("um endereço desligado seria linha morta, porque o token não pode
 * ser mostrado de novo") deixou de valer: agora o webhook nasce da declaração
 * em arquivo, e o segredo é revelado por esta ação, uma vez.
 *
 * O ganho é grande: a URL vem do `id`, então girar invalida o segredo anterior
 * SEM trocar o endereço. Antes, rotacionar quebrava todo sistema de fora que
 * chamava aquele webhook — o que significava, na prática, nunca rotacionar.
 *
 * Desligar de vez continua sendo `is_active = false` no banco — hoje ainda sem
 * botão nesta tela (só schedules tem `ligarDesligarAgendamentoAction`; o
 * mesmo par pra webhook não existe ainda).
 */
export async function girarTokenDoWebhookAction(
  input: GirarTokenInput,
): Promise<ActionResult<{ url: string; token: string }>> {
  const parsed = girarTokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const supabase = await createClient();
  const novo = gerarTokenDeWebhook();

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update({ token_hash: novo.tokenHash, token_prefix: novo.tokenPrefix })
    .eq("organization_id", org.id)
    .eq("id", parsed.data.endpointId)
    .select("id")
    .single();

  if (error || !data) {
    logError("automation.girarToken", error);
    return { ok: false, error: "Não deu pra gerar um endereço novo agora. Tente de novo." };
  }

  const url = montarUrlDoWebhook(await getAppUrl(), data.id);

  revalidatePath(`/app/${parsed.data.orgSlug}/automacoes`);
  return { ok: true, data: { url, token: novo.token } };
}

/**
 * A linha do webhook que as funções de edição precisam conferir antes de
 * tocar no banco. Mesmo papel de `lerAgendamento`, só que pra webhook.
 */
async function lerWebhook(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select("id, label, agent_id, run_as, is_active")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logError("automation.lerWebhook", error);
    throw new Error("Não deu pra carregar esse endereço agora. Tente de novo.");
  }
  return data;
}

/**
 * "Assumir" um webhook: o endereço passa a rodar no SEU nome.
 *
 * Mesmo conserto do agendamento (ver `assumirAgendamentoAction`): quem armou
 * saiu do workspace, ou quem administra quer mexer num endereço que outra
 * pessoa criou. NÃO liga o modo real sozinho — são duas decisões separadas.
 */
export async function assumirWebhookAction(input: AcaoEmWebhookInput): Promise<ActionResult> {
  const parsed = acaoEmWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { user, org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const webhook = await lerWebhook(org.id, parsed.data.id);
  if (!webhook) {
    return { ok: false, error: "Esse endereço não existe mais neste workspace." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("webhook_endpoints")
    .update({ run_as: user.id })
    .eq("organization_id", org.id)
    .eq("id", parsed.data.id);

  if (error) {
    logError("automation.assumirWebhook", error);
    return { ok: false, error: "Não deu pra assumir esse endereço agora. Tente de novo." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/automacoes`);
  return { ok: true };
}

/**
 * Liga ou desliga o MODO REAL do webhook. Mesma regra do agendamento (ver
 * `alternarModoDoAgendamentoAction`): nasce em ensaio, e o banco recusa mexer
 * num endereço que roda no nome de outra pessoa.
 */
export async function alternarModoDoWebhookAction(
  input: AlternarModoDoWebhookInput,
): Promise<ActionResult> {
  const parsed = alternarModoDoWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primeiroErro(parsed.error.issues) };

  const { user, org } = await requireOrgRole({
    orgSlug: parsed.data.orgSlug,
    roles: ["owner", "admin"],
  });

  const webhook = await lerWebhook(org.id, parsed.data.id);
  if (!webhook) {
    return { ok: false, error: "Esse endereço não existe mais neste workspace." };
  }

  if (webhook.run_as !== user.id) {
    return {
      ok: false,
      error:
        "Esse endereço roda no nome de outra pessoa. Clique em “Assumir” primeiro — aí ele " +
        "passa a rodar no seu nome e você consegue trocar o modo dele.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("webhook_endpoints")
    .update({ modo: parsed.data.modo })
    .eq("organization_id", org.id)
    .eq("id", parsed.data.id);

  if (error) {
    logError("automation.alternarModoDoWebhook", error);
    return { ok: false, error: "Não deu pra mudar o modo desse endereço agora. Tente de novo." };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/automacoes`);
  return { ok: true };
}
