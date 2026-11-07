import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";

/**
 * Cliente Supabase pro NAVEGADOR.
 *
 * ATENÇÃO: hoje NENHUMA tela do template usa esse arquivo — tudo fala com o
 * banco pelo servidor (páginas e funções do servidor), que é mais seguro e
 * mais rápido. Ele está aqui só como ponto de partida caso você precise de
 * algo ao vivo no navegador (ex: chat em tempo real).
 *
 * Se você for usar isto, as duas variáveis abaixo PRECISAM ter o prefixo
 * NEXT_PUBLIC_ (é o que faz o Next mandar o valor pro navegador) e você vai
 * precisar reconstruir a imagem toda vez que trocar as chaves. Por isso o
 * resto do template não usa.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Pra usar o Supabase direto no navegador, defina NEXT_PUBLIC_SUPABASE_URL e " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY antes de construir a imagem. " +
        "Na maioria dos casos você não precisa disso — use lib/supabase/server.ts.",
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
