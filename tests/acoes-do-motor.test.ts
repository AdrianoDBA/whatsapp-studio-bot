/**
 * `criarAcoesDoMotor` — o `ctx.acao` de VERDADE, com o remetente de email de
 * verdade.
 *
 * Um achado da rodada 2 de revisão da task 4: `getEmailProvider` (usado no
 * caminho de convite) cai num `ConsoleAdapter` de fallback quando não existe
 * chave cadastrada, e esse adapter responde `{ ok: true, id: "console-..." }`
 * sem mandar nada — comportamento CERTO pra convite, MENTIRA aqui, porque o
 * rastro gravaria "mandei o email" quando nada saiu. Por isso
 * `criarAcoesDoMotor` fala com `resolveEmailSender` direto, e devolve erro
 * explícito quando ele volta `null`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";

const resolveEmailSender = vi.fn();

vi.mock("@/lib/secrets", () => ({
  resolveEmailSender: (...args: unknown[]) => resolveEmailSender(...args),
}));

// Importado DEPOIS do mock: `criarAcoesDoMotor` resolve `@/lib/secrets` no
// carregamento do módulo, e o vitest só troca a implementação se o mock já
// estiver registrado antes do import acontecer.
const { criarAcoesDoMotor, MENSAGEM_EMAIL_NAO_CONFIGURADO } = await import("@/lib/agents/acoes");

const SUPABASE = { marcador: "cliente-de-mentira" } as unknown as SupabaseClient<Database>;

beforeEach(() => {
  resolveEmailSender.mockReset();
});

describe("sem remetente resolvido", () => {
  it("email() em modo real devolve ok:false com a frase de 'não configurado'", async () => {
    resolveEmailSender.mockResolvedValue(null);
    const passos: unknown[] = [];

    const acao = criarAcoesDoMotor({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      supabase: SUPABASE,
      registrar: async (p) => {
        passos.push(p);
      },
    });

    const r = await acao.email({ para: ["a@b.com"], assunto: "x", corpo: "y" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe(MENSAGEM_EMAIL_NAO_CONFIGURADO);
  });

  it("o passo do rastro sai com `erro` preenchido, NÃO com `detalhe`", async () => {
    resolveEmailSender.mockResolvedValue(null);
    const passos: Array<{ erro: string | null; detalhe: string | null }> = [];

    const acao = criarAcoesDoMotor({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      supabase: SUPABASE,
      registrar: async (p) => {
        passos.push(p);
      },
    });

    await acao.email({ para: ["a@b.com"], assunto: "x", corpo: "y" });

    expect(passos).toHaveLength(1);
    expect(passos[0]?.erro).toBe(MENSAGEM_EMAIL_NAO_CONFIGURADO);
    expect(passos[0]?.detalhe).toBeNull();
  });
});
