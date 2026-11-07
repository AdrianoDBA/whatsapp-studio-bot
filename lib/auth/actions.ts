"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { getAppUrl } from "@/lib/app-url";
import { verifyRecoveryCookie } from "@/lib/auth/recovery-cookie";
import { safeNext } from "@/lib/auth/safe-next";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import {
  type ResetPasswordInput,
  resetPasswordSchema,
  type SignInInput,
  type SignUpInput,
  signInSchema,
  signUpSchema,
  type UpdatePasswordInput,
  updatePasswordSchema,
} from "./schemas";

/**
 * Padding constante reduz timing side-channel em auth.
 * Aplicado em signUp, signIn E reset password (R4-HIGH-3).
 */
const AUTH_MIN_LATENCY_MS = 800;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function padLatency(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < AUTH_MIN_LATENCY_MS) {
    await sleep(AUTH_MIN_LATENCY_MS - elapsed);
  }
}

export async function signUpAction(input: SignUpInput): Promise<ActionResult> {
  const startedAt = Date.now();

  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    await padLatency(startedAt);
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos",
    };
  }

  const appUrl = await getAppUrl();
  const destino = safeNext(input.next, appUrl);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      // Leva junto pra onde a pessoa deve ir depois de confirmar o email.
      // Sem isso, quem foi convidado confirma o email e cai no lugar errado,
      // criando um workspace próprio em vez de entrar no que foi convidado.
      emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(destino)}`,
    },
  });

  if (error) {
    const lower = error.message.toLowerCase();
    if (lower.includes("already registered") || lower.includes("user already")) {
      // Resposta de propósito igual à de sucesso: não confirmamos pra
      // estranhos se um email já tem conta aqui. Não logamos também, senão o
      // log enche de linha sobre gente que só tentou entrar duas vezes.
      await padLatency(startedAt);
      return { ok: true };
    }
    logError("auth.signUp", error);
    await padLatency(startedAt);
    return { ok: false, error: traduzirErroSupabase(error.message) };
  }
  await padLatency(startedAt);
  return { ok: true };
}

export async function signInAction(input: SignInInput): Promise<ActionResult> {
  const startedAt = Date.now();

  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    await padLatency(startedAt);
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    logError("auth.signIn", error);
    await padLatency(startedAt);
    return {
      ok: false,
      error: "Email ou senha incorretos. Se não confirmou o email ainda, cheque sua caixa.",
    };
  }
  await padLatency(startedAt);
  return { ok: true };
}

/**
 * R4-AUTH-003: try/catch evita silenciar falha de signOut. Se a chamada
 * falhar (network/5xx), loga e re-throw — redirect só roda se signOut
 * realmente revogou a sessão server-side.
 */
export async function signOutAction(): Promise<never> {
  const supabase = await createClient();
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch (err) {
    logError("auth.signOut", err);
    throw err;
  }
  redirect("/login");
}

/**
 * R4-HIGH-3: padding constante (signUp/signIn já tinham; reset estava sem).
 * `resetPasswordForEmail` tem latência distinta entre email existente
 * (~SMTP enqueue) vs novo (~early return) — atacante mede e enumera.
 */
export async function requestPasswordResetAction(input: ResetPasswordInput): Promise<ActionResult> {
  const startedAt = Date.now();

  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    await padLatency(startedAt);
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Email inválido" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await getAppUrl()}/auth/callback?next=/reset-password/confirm`,
  });

  if (error) {
    logError("auth.resetPassword", error);
    await padLatency(startedAt);
    return { ok: false, error: traduzirErroSupabase(error.message) };
  }
  await padLatency(startedAt);
  return { ok: true };
}

export async function updatePasswordAction(input: UpdatePasswordInput): Promise<ActionResult> {
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();

  // TRAVA DE SEGURANÇA — não remova.
  // Toda função marcada com "use server" é um endereço público da internet:
  // dá pra chamá-la sem passar pela tela. Se a checagem do cookie ficasse só
  // na página, qualquer sessão roubada trocaria a senha da vítima sem saber a
  // senha antiga, e isso derrubaria a vítima de todos os aparelhos.
  // Por isso a checagem é feita AQUI também.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sua sessão expirou. Peça um novo link de recuperação." };
  }

  const cookieDeRecuperacao = (await cookies()).get("recovery_flow")?.value;
  if (!verifyRecoveryCookie(cookieDeRecuperacao, user.id)) {
    logError("auth.updatePassword", new Error("recovery cookie ausente ou inválido"));
    return {
      ok: false,
      error:
        "Esse link de recuperação não vale mais (ele dura 10 minutos). " +
        "Peça um novo em 'Esqueci minha senha'.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    logError("auth.updatePassword", error);
    return { ok: false, error: traduzirErroSupabase(error.message) };
  }

  await supabase.auth.signOut({ scope: "others" });

  const cookieStore = await cookies();
  cookieStore.delete({ name: "recovery_flow", path: "/reset-password" });

  return { ok: true };
}

/**
 * L-1: "sair de todos os dispositivos".
 */
export async function signOutEverywhereAction(): Promise<never> {
  const supabase = await createClient();
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch (err) {
    logError("auth.signOutEverywhere", err);
    throw err;
  }
  redirect("/login");
}

function traduzirErroSupabase(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos";
  if (lower.includes("password")) return "Senha não atende aos requisitos mínimos";
  return "Não foi possível completar a operação. Tente novamente.";
}
