import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEmailSender } from "@/lib/secrets";
import type { Database } from "@/types/supabase";
import { ResendAdapter } from "./adapters/resend";
import { ConsoleAdapter } from "./adapters/supabase-smtp";
import type { EmailProvider } from "./provider";

/**
 * Escolhe por onde os emails saem — sem você configurar nada.
 *
 * - Tem chave do Resend cadastrada? Manda de verdade por ela. A busca segue a
 *   mesma escada do resto do app: chave do workspace → chave da plataforma →
 *   variável de ambiente (compatibilidade com quem já tinha deploy no ar).
 * - Não tem nenhuma? Cai no modo "só escreve no registro (log) do servidor",
 *   pra você conseguir copiar o link de convite enquanto ainda não contratou
 *   um serviço de email.
 *
 * ⚠️ SEM CACHE DE MÓDULO, DE PROPÓSITO.
 * Antes esta função guardava o provedor escolhido numa variável do arquivo. Com
 * a chave podendo variar por workspace, esse cache passaria a mandar o email de
 * um time com a chave (e o remetente) de outro. Guardar é barato; vazar não.
 *
 * ⚠️ É `async`. Único ponto de chamada hoje: `lib/invitations/actions.ts`.
 *
 * ⚠️ O `supabase` é OBRIGATÓRIO: é com essa identidade que o cofre é
 * consultado. Ver a justificativa em `lib/secrets/resolve.ts`.
 */
export async function getEmailProvider(opts: {
  organizationId: string | null;
  supabase: SupabaseClient<Database>;
}): Promise<EmailProvider> {
  const remetente = await resolveEmailSender({
    organizationId: opts.organizationId,
    supabase: opts.supabase,
  });
  return remetente ? new ResendAdapter(remetente.apiKey, remetente.from) : new ConsoleAdapter();
}

export type { EmailProvider, SendEmailInput, SendEmailResult } from "./provider";
