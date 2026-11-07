/**
 * A GUARDA DA REGRA 6 NO CAMINHO DO EMAIL.
 *
 * O caso que deu origem a este arquivo foi medido em produção: o aluno abriu
 * Automações e leu, em inglês, "The recipient domain is not allowed to receive
 * emails from this account." — texto cru do Resend, dentro de
 * `jobs.last_error`.
 *
 * Uma família por caso, porque é assim que o defeito volta: alguém acrescenta
 * uma pista nova e derruba outra sem perceber.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  erroDeEmailParaOAluno,
  familiaDoErroDeEmail,
  traduzirErroDeEmail,
} from "@/lib/email/erros";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("familiaDoErroDeEmail", () => {
  it("domínio/destinatário recusado — a frase exata que apareceu na tela", () => {
    expect(
      familiaDoErroDeEmail(
        "The recipient domain is not allowed to receive emails from this account.",
      ),
    ).toBe("destinatario");
  });

  it("domínio não verificado também é da família do destinatário", () => {
    expect(familiaDoErroDeEmail("The example.com domain is not verified.")).toBe("destinatario");
  });

  it("chave inválida", () => {
    expect(familiaDoErroDeEmail("API key is invalid")).toBe("chave");
  });

  it("chave faltando (o código do provedor basta)", () => {
    expect(familiaDoErroDeEmail("missing_api_key")).toBe("chave");
  });

  it("limite de envio", () => {
    expect(familiaDoErroDeEmail("rate_limit_exceeded: too many requests")).toBe("limite");
  });

  it("o resto cai em desconhecido", () => {
    expect(familiaDoErroDeEmail("Something exploded on our side")).toBe("desconhecido");
  });

  it("chave restrita a um domínio conta como problema de CHAVE, não de destinatário", () => {
    // Este texto casa com as duas famílias; quem manda é a ordem das pistas,
    // porque o conserto é trocar a chave.
    expect(
      familiaDoErroDeEmail("restricted_api_key: this key can only send from example.com domain"),
    ).toBe("chave");
  });
});

describe("traduzirErroDeEmail", () => {
  const CASOS = [
    "The recipient domain is not allowed to receive emails from this account.",
    "API key is invalid",
    "rate_limit_exceeded",
    "Something exploded on our side",
  ];

  it("toda frase sai em português, sem devolver o texto do provedor", () => {
    for (const caso of CASOS) {
      const frase = traduzirErroDeEmail(caso);
      expect(frase).not.toContain(caso);
      expect(frase).not.toMatch(/[a-z]+_[a-z]+/);
      // Uma palavra que só existe em português garante que não voltou inglês.
      expect(frase.toLowerCase()).toMatch(/não|email/);
    }
  });

  it("cada família tem a SUA frase — nenhuma repete", () => {
    const frases = CASOS.map(traduzirErroDeEmail);
    expect(new Set(frases).size).toBe(CASOS.length);
  });
});

describe("erroDeEmailParaOAluno", () => {
  it("grava o motivo técnico no registro do servidor", () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    erroDeEmailParaOAluno("email/resend", {
      name: "validation_error",
      message: "The recipient domain is not allowed to receive emails from this account.",
    });
    expect(espiao).toHaveBeenCalledTimes(1);
    const escrito = String(espiao.mock.calls[0]?.[0] ?? "");
    expect(escrito).toContain("email/resend");
    expect(escrito).toContain("recipient domain");
  });

  it("mas NÃO devolve esse motivo técnico pra tela", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const frase = erroDeEmailParaOAluno("email/resend", {
      name: "validation_error",
      message: "The recipient domain is not allowed to receive emails from this account.",
    });
    expect(frase).not.toContain("recipient domain");
    expect(frase).toContain("Resend");
    expect(frase).toContain("Plataforma");
  });

  it("string crua também é logada (o caso que `logError` sozinho perderia)", () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    erroDeEmailParaOAluno("email/resend", "fetch failed");
    expect(String(espiao.mock.calls[0]?.[0] ?? "")).toContain("fetch failed");
  });

  it("`Error` de rede vira a frase genérica", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const frase = erroDeEmailParaOAluno("email/resend", new Error("fetch failed"));
    expect(frase).toBe(traduzirErroDeEmail("qualquer coisa que ninguém mapeou"));
  });
});
