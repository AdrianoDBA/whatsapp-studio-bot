/**
 * Leituras do nível "plataforma" — o que está FORA de qualquer workspace.
 *
 * Hoje tem só uma: quem são os donos da plataforma. A tela
 * `/plataforma/configuracoes` mostra essa lista pra pessoa conferir que ela
 * não é a única (se for, e a conta dela sumir, ninguém mais cadastra chave de
 * plataforma — a saída está comentada no topo da migration
 * `20260820010000_platform_admins.sql`).
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com "use client".
 */
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export type PlatformAdmin = {
  userId: string;
  /** `null` quando o perfil não está visível pra quem consultou. */
  fullName: string | null;
  createdAt: string;
};

/**
 * Quem é dono da plataforma.
 *
 * A regra de segurança da tabela só deixa DONO ler essa lista. Pra qualquer
 * outra pessoa a resposta vem vazia — o que é o certo: a lista de quem manda
 * não é informação pública.
 */
export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id, created_at, profile:profiles(full_name)")
    .order("created_at", { ascending: true });

  if (error) {
    logError("platform.listPlatformAdmins", error);
    throw new Error("Não deu pra carregar a lista de donos agora. Atualize a página.");
  }

  return (data ?? []).map((linha) => ({
    userId: linha.user_id,
    fullName: linha.profile?.full_name ?? null,
    createdAt: linha.created_at,
  }));
}
