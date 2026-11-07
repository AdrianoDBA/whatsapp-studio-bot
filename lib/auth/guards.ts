import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { logError } from "@/lib/logger";
import { getOrgBySlug, getUserOrgs } from "@/lib/orgs/queries";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

type OrgRole = Database["public"]["Enums"]["org_role"];

/**
 * `cache()` faz a resposta ser reaproveitada dentro da MESMA requisição.
 * Sem isso, uma única navegação perguntava "quem é essa pessoa?" pro Supabase
 * três vezes (porteiro, layout e página) — três idas na rede pra saber a mesma
 * coisa. Só funciona com argumentos simples (texto, número), por isso
 * `requireOrgMember` (que recebe um objeto) fica de fora.
 */
export const requireUser = cache(async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
});

export const getCurrentUser = cache(async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireOrgMember(opts: { orgSlug: string }) {
  const user = await requireUser();
  const membership = await getOrgBySlug(opts.orgSlug, user.id);

  if (!membership) {
    const allOrgs = await getUserOrgs(user.id);
    if (allOrgs.length === 0) redirect("/onboarding");
    redirect(`/app/${allOrgs[0]!.organization.slug}/dashboard`);
  }

  return { user, org: membership.organization, role: membership.role };
}

export async function requireOrgRole(opts: { orgSlug: string; roles: OrgRole[] }) {
  const ctx = await requireOrgMember({ orgSlug: opts.orgSlug });
  if (!opts.roles.includes(ctx.role)) {
    redirect(`/app/${opts.orgSlug}/dashboard`);
  }
  return ctx;
}

// -----------------------------------------------------------------------------
// Dono da plataforma
// -----------------------------------------------------------------------------
// Papel que existe FORA de qualquer workspace: é quem cadastra a chave de IA
// que vale pra todo mundo (a tela /plataforma/configuracoes). Normalmente é
// uma pessoa só — quem instalou o app.
//
// Quem é dono está na tabela `platform_admins`, e a regra de segurança dela só
// deixa dono ler a lista. Ou seja: pra quem não é dono, a consulta abaixo volta
// vazia — não existe caminho de "consultei e vi que não sou".

/**
 * Essa pessoa é dona da plataforma?
 *
 * `cache()` = uma ida ao banco por requisição, mesmo que o layout, a página e
 * a barra lateral perguntem cada um por sua conta. `cache()` só funciona com
 * argumento simples, e é por isso que esta função recebe o id em vez de ler a
 * sessão sozinha.
 */
export const isPlatformAdmin = cache(async function isPlatformAdmin(
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // Falhou a consulta? Trata como "não é dono". Errar pro lado de negar
    // acesso é o único erro seguro aqui.
    logError("auth.isPlatformAdmin", error);
    return false;
  }
  return data !== null;
});

/**
 * Pra `page.tsx` e `layout.tsx` de `/plataforma`.
 *
 * Sem sessão → vai pro login (o `requireUser` cuida disso).
 * Logado mas não é dono → volta pro painel do primeiro workspace dele (ou pro
 * onboarding, se ele ainda não tiver nenhum). NUNCA conta pra pessoa que a
 * página existe: quem não pode entrar simplesmente é levado pra casa.
 *
 * Devolve o `User` direto, igual ao `requireUser()` — é o guard irmão dele.
 */
export async function requirePlatformAdmin(): Promise<User> {
  const user = await requireUser();
  if (await isPlatformAdmin(user.id)) return user;

  const orgs = await getUserOrgs(user.id);
  if (orgs.length === 0) redirect("/onboarding");
  redirect(`/app/${orgs[0]!.organization.slug}/dashboard`);
}

/**
 * Pra função do servidor (Server Action): devolve `true`/`false` e NÃO
 * redireciona.
 *
 * Toda função marcada com "use server" é um endereço público da internet —
 * dá pra chamar ela sem passar pela tela. Por isso a checagem de quem pode
 * fazer o quê mora DENTRO da função, e não só na página que mostra o botão.
 */
export async function assertPlatformAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return isPlatformAdmin(user.id);
}
