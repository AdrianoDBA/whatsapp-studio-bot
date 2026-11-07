/**
 * A ENTREGA — e as duas regras que vieram do contrato.
 *
 * 1. Entrega NÃO é ferramenta: é passo do trabalho. O modelo não decide se
 *    entrega e não pode esquecer.
 * 2. Falha de entrega NÃO transforma a execução em `failed`. O agente fez o
 *    trabalho dele; o email é que não saiu.
 */
import { describe, expect, it, vi } from "vitest";
import type { Acoes } from "@/lib/agents/acoes";
import { mandarEmail } from "@/lib/agents/tools/mandar-email";
import {
  entregaDeEntradaSchema,
  entregarResultado,
  entregaSchema,
  MAX_DESTINATARIOS_DA_ENTREGA,
} from "@/lib/automation/entrega";

// ⚠️ `over.email` é tipado com `ReturnType<typeof vi.fn<Acoes["email"]>>`,
// com o GENÉRICO explícito. Sem ele, `vi.fn` sem argumento nenhum infere o
// tipo mais genérico possível (`Mock<Procedure | Constructable>`), que o
// `tsc` recusa quando a função é passada como `Acoes` de verdade — e o `npx
// vitest run` sozinho não pegava isso, porque não faz checagem de tipo.
// Achado ao rodar `npm run verify` (typecheck) sobre o teste do brief.
function acoesFalsas(over: Partial<{ email: ReturnType<typeof vi.fn<Acoes["email"]>> }> = {}) {
  return {
    email: over.email ?? vi.fn(async () => ({ ok: true as const, simulado: false as const })),
    http: vi.fn(async () => ({ ok: true as const, simulado: false as const })),
  };
}

const BASE = {
  output: "3 pedidos atrasados.",
  nomeDaAutomacao: "Resumo de segunda",
  linkDaExecucao: "https://app.exemplo.com/app/acme/execucoes/1",
};

describe("tipo nenhuma", () => {
  it("não chama ação nenhuma", async () => {
    const acoes = acoesFalsas();
    const r = await entregarResultado({ ...BASE, entrega: { tipo: "nenhuma" }, acoes });
    expect(r.ok).toBe(true);
    expect(acoes.email).not.toHaveBeenCalled();
  });
});

describe("tipo email", () => {
  it("manda pro destinatário, com o nome da automação no assunto", async () => {
    const acoes = acoesFalsas();
    await entregarResultado({
      ...BASE,
      entrega: { tipo: "email", para: ["chefe@empresa.com"] },
      acoes,
    });
    expect(acoes.email).toHaveBeenCalledTimes(1);
    const arg = acoes.email.mock.calls[0]?.[0] as { assunto: string; para: string[] };
    expect(arg.para).toEqual(["chefe@empresa.com"]);
    expect(arg.assunto).toContain("Resumo de segunda");
  });

  it("falha de envio NÃO derruba: devolve ok falso, sem lançar", async () => {
    const acoes = acoesFalsas({
      email: vi.fn(async () => ({ ok: false as const, erro: "A chave do Resend expirou." })),
    });
    const r = await entregarResultado({
      ...BASE,
      entrega: { tipo: "email", para: ["a@b.com"] },
      acoes,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("Resend");
  });

  it("em ensaio, o resultado diz simulado", async () => {
    const acoes = acoesFalsas({
      email: vi.fn(async () => ({ ok: true as const, simulado: true as const, oQueEuFaria: {} })),
    });
    const r = await entregarResultado({
      ...BASE,
      entrega: { tipo: "email", para: ["a@b.com"] },
      acoes,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.simulado).toBe(true);
  });
});

describe("o formato guardado no banco", () => {
  it("aceita os três tipos", () => {
    expect(entregaSchema.safeParse({ tipo: "nenhuma" }).success).toBe(true);
    expect(entregaSchema.safeParse({ tipo: "email", para: ["a@b.com"] }).success).toBe(true);
    expect(
      entregaSchema.safeParse({ tipo: "conexao", slug: "https://x.com", caminho: "/y" }).success,
    ).toBe(true);
  });

  it("recusa email sem destinatário e endereço que não é email", () => {
    expect(entregaSchema.safeParse({ tipo: "email", para: [] }).success).toBe(false);
    expect(entregaSchema.safeParse({ tipo: "email", para: ["nao-e-email"] }).success).toBe(false);
  });

  it("linha antiga do banco (jsonb solto) não quebra a tela", () => {
    // Coluna `jsonb` aceita qualquer coisa; a `check` do banco cobre o `tipo`,
    // mas não o resto. Quem lê tem que aguentar lixo.
    expect(entregaSchema.safeParse({}).success).toBe(false);
    expect(entregaSchema.safeParse(null).success).toBe(false);
  });
});

/**
 * ⚠️ ESTE BLOCO É UMA TRAVA DE SEGURANÇA, NÃO UM TESTE DE FORMATO.
 *
 * Agendamento não tem mais função do servidor que CRIE (nasce de arquivo,
 * `lib/automation/blueprint.ts`) — mas `entregaDeEntradaSchema` continua sendo
 * o formato que qualquer futura escrita de `entrega` precisa usar, nunca
 * `entregaSchema` (o de LEITURA, que conhece um terceiro caso, `conexao`,
 * guardado pra a onda das conexões). O caso abaixo volta calado se alguém
 * trocar um pelo outro numa refatoração.
 */
describe("o que se aceita GRAVAR é menos que o que se LÊ", () => {
  it("a entrada não conhece `conexao` — nem com endereço de aparência inocente", () => {
    for (const slug of ["https://coletor.exemplo.com", "https://x.com", "qualquer-coisa"]) {
      expect(
        entregaDeEntradaSchema.safeParse({ tipo: "conexao", slug, caminho: "/x" }).success,
        slug,
      ).toBe(false);
    }
  });

  it("a LEITURA continua aceitando `conexao` (o formato fica guardado pra a onda das conexões)", () => {
    expect(
      entregaSchema.safeParse({ tipo: "conexao", slug: "https://x.com", caminho: "/y" }).success,
    ).toBe(true);
  });
});

/**
 * ⚠️ OS DOIS TETOS TÊM QUE ANDAR JUNTOS.
 *
 * A entrega por email e a ferramenta `mandar-email` terminam na MESMA porta
 * (`ctx.acao.email`), que dispara um `fetch` por destinatário em `Promise.all`
 * com o remetente que `resolveEmailSender` achar — e ele cai workspace →
 * PLATAFORMA. Teto num caminho só deixaria o outro fazer disparo em massa com
 * a chave do dono do sistema.
 */
describe("o teto de destinatários é o mesmo nos dois caminhos", () => {
  const emails = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@exemplo.com`);
  const noTeto = emails(MAX_DESTINATARIOS_DA_ENTREGA);
  const umAMais = emails(MAX_DESTINATARIOS_DA_ENTREGA + 1);

  it("a ENTREGA aceita até o teto e recusa um a mais", () => {
    expect(entregaDeEntradaSchema.safeParse({ tipo: "email", para: noTeto }).success).toBe(true);
    expect(entregaDeEntradaSchema.safeParse({ tipo: "email", para: umAMais }).success).toBe(false);
  });

  it("a FERRAMENTA corta no mesmo número", () => {
    expect(
      mandarEmail.inputSchema.safeParse({ para: noTeto, assunto: "x", corpo: "y" }).success,
    ).toBe(true);
    expect(
      mandarEmail.inputSchema.safeParse({ para: umAMais, assunto: "x", corpo: "y" }).success,
    ).toBe(false);
  });

  it("a leitura do banco também corta (linha grande demais não vira disparo em massa)", () => {
    // Errar pro lado de "não mandei" é o único erro seguro aqui.
    expect(entregaSchema.safeParse({ tipo: "email", para: umAMais }).success).toBe(false);
  });

  it("a frase da recusa é PT-BR leigo, sem jargão", () => {
    const r = entregaDeEntradaSchema.safeParse({ tipo: "email", para: umAMais });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join(" ");
      expect(msg).toContain("no máximo");
      expect(msg.toLowerCase()).not.toContain("array");
    }
  });
});
