/**
 * OS DOIS CAMINHOS DE EMAIL — e a promessa que o app não pode voltar a fazer.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * O cartão da Resend, na tela de Configurações da plataforma, dizia que ela
 * entrega "convite, **recuperação de senha**". A metade da frase era mentira, e
 * ela custava caro: o dono do sistema cadastrava a chave achando que tinha
 * resolvido o gargalo de email, e não tinha resolvido nada.
 *
 * Os emails saem por DOIS caminhos, e a chave cadastrada alcança um só:
 *
 *   convite / boas-vindas / resultado de automação
 *     → `getEmailProvider()` → Resend  ✅
 *
 *   confirmação de conta / recuperação de senha
 *     → `supabase.auth.signUp()` / `resetPasswordForEmail()` → SMTP do Supabase  ❌
 *
 * Nenhum teste pegava isso porque não é um erro de código: as duas metades
 * funcionam, cada uma no seu caminho. É a FRASE que estava errada.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_DO_SMTP_DA_RESEND,
  EMAILS_POR_HORA_COM_SMTP_PROPRIO,
  EMAILS_POR_HORA_SEM_SMTP_PROPRIO,
  ENDERECO_DO_SMTP_NO_SUPABASE,
} from "@/lib/email/smtp-do-supabase";
import { getProviderInfo } from "@/lib/secrets/providers";

describe("os valores do SMTP da Resend", () => {
  it("são os que a Resend documenta", () => {
    // Conferidos em resend.com/docs/send-with-smtp. Um valor errado aqui vira
    // uma pessoa colando coisa que não funciona no painel do Supabase, sem ter
    // como saber que o errado era a nossa tela.
    const porRotulo = new Map(CAMPOS_DO_SMTP_DA_RESEND.map((c) => [c.rotulo, c.valor]));
    expect(porRotulo.get("Host")).toBe("smtp.resend.com");
    expect(porRotulo.get("Username")).toBe("resend");
    // 465 é SMTPS: já sobe criptografada. As 25/587/2587 começam em texto puro.
    expect(porRotulo.get("Port number")).toBe("465");
  });

  it("a senha e o remetente são explicados, nunca preenchidos", () => {
    // A chave é segredo — ela NÃO pode aparecer nesta tela (regra 10-B). O que
    // vai aqui é a instrução de onde a pessoa pega o valor.
    for (const rotulo of ["Password", "Sender email"]) {
      const campo = CAMPOS_DO_SMTP_DA_RESEND.find((c) => c.rotulo === rotulo);
      expect(campo?.valor, `${rotulo} não pode ter valor fixo`).toBeUndefined();
      expect(campo?.explicacao?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it("o link leva pra tela de SMTP do projeto, não pra home do Supabase", () => {
    expect(ENDERECO_DO_SMTP_NO_SUPABASE).toContain("/auth/smtp");
  });

  it("configurar SMTP próprio aumenta o limite (senão o aviso não faz sentido)", () => {
    expect(EMAILS_POR_HORA_COM_SMTP_PROPRIO).toBeGreaterThan(EMAILS_POR_HORA_SEM_SMTP_PROPRIO);
  });
});

describe("o app não promete que a Resend cobre recuperação de senha", () => {
  /** O texto que aparece no cartão da Resend, nas duas telas de chave. */
  const descricaoDaResend = getProviderInfo("resend").description;

  it("a descrição do cartão diz quais emails ela entrega DE VERDADE", () => {
    expect(descricaoDaResend).toContain("convite");
    // Se falar de recuperação de senha, tem que ser pra dizer que NÃO passa.
    if (/recupera[çc][ãa]o de senha/i.test(descricaoDaResend)) {
      expect(
        descricaoDaResend,
        "citar recuperação de senha sem dizer que ela NÃO passa pela Resend é a mentira antiga",
      ).toMatch(/N[ÃA]O passam|n[ãa]o passa/i);
    }
  });

  it("o cartão mostra o passo do Supabase quando a chave está cadastrada", () => {
    // A tela precisa CHAMAR o bloco — sem isso a explicação existe no código e
    // ninguém vê. Verificado no navegador em 30/08/2026, mas a chamada some
    // fácil num refactor.
    const tela = readFileSync(
      join(process.cwd(), "app/(app)/plataforma/configuracoes/platform-credentials.tsx"),
      "utf8",
    );
    expect(tela).toContain("PassoNoSupabase");
    expect(tela).toContain('data.id === "resend"');
  });

  it("os dois caminhos de email continuam sendo dois (o motivo do aviso existir)", () => {
    // No dia em que o app passar a mandar a recuperação de senha por conta
    // própria, este teste quebra — e aí o aviso todo pode sair.
    const auth = readFileSync(join(process.cwd(), "lib/auth/actions.ts"), "utf8");
    expect(auth).toContain("resetPasswordForEmail");
    expect(auth).not.toContain("getEmailProvider");
  });
});
