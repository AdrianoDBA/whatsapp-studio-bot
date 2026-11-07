/**
 * A IMPERSONAÇÃO: como a automação roda "no nome de" alguém sem que essa
 * pessoa esteja logada.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ A IDEIA, EM UMA FRASE                                                   │
 * │ Um cliente do Supabase DE VERDADE, com o `fetch` trocado pela ponte.    │
 * │ `runAgent`, `createRecorder`, `createOrgScopedDb` e o `ToolContext`     │
 * │ ficam com ZERO mudança, ZERO `any` e ZERO `as unknown as`. O que muda é │
 * │ só o transporte.                                                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ O PAPEL VEM DO BANCO, SEMPRE.
 * Este arquivo LÊ `memberships` pra descobrir se a pessoa é dona, administra
 * ou é membro comum daquele workspace. Nunca chute, nunca fixe no código: é
 * esse papel que decide quais ferramentas com `requiresRole` o agente pode
 * usar (ameaça T9 do contrato). E é essa leitura que também responde "essa
 * pessoa ainda está no time?" — porque a consulta passa pela regra de
 * segurança do banco, então quem saiu simplesmente não tem linha.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/agents/types";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";
import { logError } from "@/lib/logger";
import type { Database } from "@/types/supabase";
import { impersonatedPool } from "./pg";
import { createBridgeFetch, isBridgeUnsupportedError } from "./postgrest-bridge";

export type ImpersonatedSession = {
  /**
   * Um `SupabaseClient<Database>` de verdade. `runAgent` recebe isto sem
   * mudar uma linha.
   */
  supabase: SupabaseClient<Database>;
  /** Quem a automação representa. É o `auth.uid()` de todas as consultas. */
  userId: string;
  organizationId: string;
  /** O papel de `userId` NESTE workspace, lido de `memberships`. */
  role: OrgRole;
  /**
   * O detalhe do último recurso que a ponte não soube servir, ou `null`.
   *
   * É o que deixa `run-job.ts` PAUSAR um agendamento que usa uma ferramenta
   * que ainda não roda fora da tela, em vez de deixar ele falhar todo dia às
   * 8h da manhã sem ninguém entender o motivo.
   */
  recursoNaoSuportado(): string | null;
  /** Destrói a conexão. Obrigatório, inclusive quando deu errado. */
  close(): Promise<void>;
};

export type ImpersonationResult =
  | { ok: true; sessao: ImpersonatedSession }
  | { ok: false; error: string };

/** A frase que a tela mostra quando a automação ficou órfã. */
const SAIU_DO_TIME =
  "Quem essa automação representa não está mais no workspace, então ela não pode rodar. " +
  "Um administrador pode assumir a automação e ligar de novo.";

/**
 * Monta a sessão impersonada de UM trabalho — OU de `npm run semear`, que não
 * é trabalho nenhum da fila.
 *
 * @param params.jobId  vira a marca `app.automation_job` (é o que faz a cota
 *                      de IA sair do balde da automação, e não do balde
 *                      pessoal de quem armou o agendamento).
 *
 *                      OPCIONAL: quem chama de fora de um trabalho da fila
 *                      (hoje, só `npm run semear`) não tem `jobId` nenhum — e
 *                      não deveria fabricar um só pra preencher o campo
 *                      (isso sujaria a fila com trabalho que não existe). Sem
 *                      ele, `createBridgeFetch` cai pra `""`, que o SQL já
 *                      trata como "sem marca" — nunca disparado de qualquer
 *                      forma, porque semear não gasta IA.
 * @param params.userId quem a automação representa — SEMPRE vindo da linha da
 *                      fila (trabalho normal) ou de `owner_memberships_for_seed`
 *                      (semear), nunca do corpo de um pedido HTTP
 */
export async function createImpersonatedClient(params: {
  jobId?: string;
  userId: string;
  organizationId: string;
}): Promise<ImpersonationResult> {
  const { jobId, userId, organizationId } = params;

  const ponte = createBridgeFetch({
    pool: impersonatedPool(),
    claims: { sub: userId, role: "authenticated" },
    jobId,
  });

  const supabase = createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    auth: {
      // Não existe navegador, não existe cookie e não existe token pra
      // renovar. Ligar qualquer uma dessas três faria o cliente tentar falar
      // com `/auth/v1/*` — que a ponte recusa alto, de propósito.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: ponte },
  });

  const fechar = async () => {
    await ponte.encerrar();
  };

  try {
    // A leitura que decide tudo: a pessoa é membro? e com que papel?
    // A regra de segurança do banco já filtra por `auth.uid()`; o
    // `eq("user_id", …)` é o cinto além do suspensório.
    const { data, error } = await supabase
      .from("memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      logError("automation/impersonate", error);
      await fechar();
      return {
        ok: false,
        error:
          "Não deu pra conferir quem essa automação representa. Tente de novo em alguns " +
          "minutos; se continuar, avise quem administra o workspace.",
      };
    }

    if (!data) {
      await fechar();
      return { ok: false, error: SAIU_DO_TIME };
    }

    return {
      ok: true,
      sessao: {
        supabase,
        userId,
        organizationId,
        role: data.role,
        recursoNaoSuportado: () => ponte.recursoNaoSuportado(),
        close: fechar,
      },
    };
  } catch (err) {
    await fechar();
    if (isBridgeUnsupportedError(err)) {
      logError("automation/impersonate", err);
      return { ok: false, error: err.message };
    }
    logError("automation/impersonate", err);
    return {
      ok: false,
      error:
        "A automação não conseguiu entrar no banco com a identidade certa, então não rodou. " +
        "Nenhum dado foi lido nem gravado.",
    };
  }
}
