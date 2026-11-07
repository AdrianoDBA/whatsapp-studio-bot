/**
 * Leitura dos agentes gravados no banco.
 *
 * A regra de segurança do banco já prende cada consulta ao workspace de quem
 * está logado; o `.eq("organization_id", orgId)` daqui é o cinto além do
 * suspensório — e é o que faz a consulta continuar certa se um dia alguém
 * afrouxar a regra sem perceber.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com "use client".
 */
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type { AgentRecord } from "./types";

/** Um agente, do jeito que ele está gravado. */
export type Agent = AgentRecord;

/**
 * `select("*")` é intencional aqui: a tabela é estreita e o tipo é a linha
 * inteira. Lista explícita de colunas faria toda coluna nova voltar
 * `undefined` em silêncio até alguém lembrar de editar esta consulta. É o
 * oposto da escolha de `lib/secrets`, onde a lista é obrigatória porque uma
 * coluna é proibida de sair.
 */
export async function listAgents(orgId: string): Promise<Agent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false });

  if (error) {
    logError("agents.listAgents", error);
    throw new Error("Não deu pra carregar os agentes agora. Atualize a página.");
  }
  return data ?? [];
}

/** O agente daquele apelido (o pedaço que aparece na URL), ou `null`. */
export async function getAgentBySlug(orgId: string, slug: string): Promise<Agent | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    logError("agents.getAgentBySlug", error);
    throw new Error("Não deu pra carregar esse agente agora. Atualize a página.");
  }
  return data;
}

/** O agente daquele id, ou `null`. É o caminho que as funções do servidor usam. */
export async function getAgentById(orgId: string, id: string): Promise<Agent | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logError("agents.getAgentById", error);
    throw new Error("Não deu pra carregar esse agente agora. Atualize a página.");
  }
  return data;
}
