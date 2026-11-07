import { describe, expect, it } from "vitest";
import { criarNovoClienteSchema } from "@/lib/orgs/novo-cliente-schema";

describe("Novo Cliente Action Schema", () => {
  it("valida dados corretos de criação de novo cliente", () => {
    const dados = {
      empresaNome: "Clínica Vida Saudável",
      clienteEmail: "contato@vidasaudavel.com.br",
      assistenteNome: "Helena",
      tom: "acolhedor" as const,
      telefone: "11988887777",
      servicosIniciais: "Consulta Médica: R$ 300\nRetorno: Grátis até 30 dias",
    };

    const parsed = criarNovoClienteSchema.safeParse(dados);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.empresaNome).toBe("Clínica Vida Saudável");
      expect(parsed.data.clienteEmail).toBe("contato@vidasaudavel.com.br");
      expect(parsed.data.assistenteNome).toBe("Helena");
      expect(parsed.data.tom).toBe("acolhedor");
    }
  });

  it("aceita apenas campos obrigatórios (nome da empresa e email)", () => {
    const dados = {
      empresaNome: "Estúdio Alpha",
      clienteEmail: "alpha@estudio.com",
    };

    const parsed = criarNovoClienteSchema.safeParse(dados);
    expect(parsed.success).toBe(true);
  });

  it("rejeita email inválido", () => {
    const dados = {
      empresaNome: "Estúdio Alpha",
      clienteEmail: "nao-eh-um-email",
    };

    const parsed = criarNovoClienteSchema.safeParse(dados);
    expect(parsed.success).toBe(false);
  });

  it("rejeita nome de empresa muito curto", () => {
    const dados = {
      empresaNome: "A",
      clienteEmail: "alpha@estudio.com",
    };

    const parsed = criarNovoClienteSchema.safeParse(dados);
    expect(parsed.success).toBe(false);
  });

  it("rejeita tom inválido", () => {
    const dados = {
      empresaNome: "Estúdio Alpha",
      clienteEmail: "alpha@estudio.com",
      tom: "tom_inexistente" as any,
    };

    const parsed = criarNovoClienteSchema.safeParse(dados);
    expect(parsed.success).toBe(false);
  });
});
