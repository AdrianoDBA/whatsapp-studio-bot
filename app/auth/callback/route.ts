import { type NextRequest, NextResponse } from "next/server";
import { buildRecoveryCookie } from "@/lib/auth/recovery-cookie";
import { safeNext } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), origin);

  if (code) {
    const supabase = await createClient();

    // RT5-HIGH-4: bloqueia session fixation. Se a vítima já está logada,
    // recusa trocar a sessão pelo callback do atacante.
    const {
      data: { user: existing },
    } = await supabase.auth.getUser();
    if (existing) {
      return NextResponse.redirect(`${origin}/login?error=already_signed_in`);
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      // R3-AUTH-001: cookie HMAC-signed bound ao user.id (não é mais "1").
      if (next.startsWith("/reset-password/confirm")) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          response.cookies.set("recovery_flow", buildRecoveryCookie(user.id), {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 10,
            path: "/reset-password",
          });
        }
      }
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
