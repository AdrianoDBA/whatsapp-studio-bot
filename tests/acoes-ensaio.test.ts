/**
 * O FREIO: em ensaio, NADA sai daqui.
 *
 * Este é o teste mais importante da onda 7. A primeira versão do contrato punha
 * a segurança numa DECLARAÇÃO da ferramenta (`age: true`) conferida por um
 * teste que vasculha o código atrás de `fetch(` — e uma ferramenta que chamasse
 * um ajudante que por dentro faz `fetch` passaria pelo grep e agiria em ensaio,
 * calada.
 *
 * Agora agir só é possível por `ctx.acao`, e é este arquivo que prova que em
 * ensaio ele não faz nada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarAcoes } from "@/lib/agents/acoes";
import { TETO_DA_RESPOSTA_BYTES } from "@/lib/agents/acoes-url";

const enviados: unknown[] = [];
const passos: unknown[] = [];

/** Um "mandar email de verdade" de mentira, pra saber se foi chamado. */
const mandarDeVerdade = vi.fn(async (p: unknown) => {
  enviados.push(p);
  return { ok: true as const, id: "msg_1" };
});

function acoes(modo: "ensaio" | "real") {
  return criarAcoes({
    modo,
    organizationId: "11111111-1111-1111-1111-111111111111",
    registrar: async (p) => {
      passos.push(p);
    },
    enviarEmail: mandarDeVerdade,
    // Em teste, o `fetch` é nosso.
    buscar: vi.fn(async () => new Response("ok", { status: 200 })),
  });
}

beforeEach(() => {
  enviados.length = 0;
  passos.length = 0;
  mandarDeVerdade.mockClear();
});

describe("modo ensaio", () => {
  it("email NÃO sai, e o retorno diz o que teria feito", async () => {
    const r = await acoes("ensaio").email({
      para: ["chefe@empresa.com"],
      assunto: "3 pedidos atrasados",
      corpo: "Segue o resumo.",
    });

    expect(mandarDeVerdade).not.toHaveBeenCalled();
    expect(enviados).toHaveLength(0);
    expect(r.ok).toBe(true);
    if (r.ok && r.simulado) {
      expect(r.oQueEuFaria.para).toEqual(["chefe@empresa.com"]);
    } else {
      throw new Error("devia ter voltado simulado");
    }
  });

  it("http NÃO sai", async () => {
    const a = acoes("ensaio");
    const r = await a.http({ metodo: "POST", url: "https://api.exemplo.com/x", corpo: { a: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.simulado).toBe(true);
  });

  it("grava o passo marcado como simulado", async () => {
    await acoes("ensaio").email({ para: ["a@b.com"], assunto: "x", corpo: "y" });
    expect(passos).toHaveLength(1);
    expect((passos[0] as { simulado: boolean }).simulado).toBe(true);
  });
});

describe("modo real", () => {
  it("email SAI", async () => {
    const r = await acoes("real").email({
      para: ["chefe@empresa.com"],
      assunto: "3 pedidos atrasados",
      corpo: "Segue o resumo.",
    });
    expect(mandarDeVerdade).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.simulado).toBe(false);
  });

  it("grava o passo com simulado falso", async () => {
    await acoes("real").email({ para: ["a@b.com"], assunto: "x", corpo: "y" });
    expect((passos[0] as { simulado: boolean }).simulado).toBe(false);
  });
});

describe("as travas valem nos DOIS modos", () => {
  it("endereço interno é recusado mesmo em ensaio", async () => {
    // Em ensaio nada sai, mas a recusa precisa aparecer AGORA — senão o aluno
    // liga o modo real achando que o ensaio validou o endereço.
    const r = await acoes("ensaio").http({ metodo: "GET", url: "https://169.254.169.254/" });
    expect(r.ok).toBe(false);
  });

  it("http:// é recusado em modo real", async () => {
    const r = await acoes("real").http({ metodo: "GET", url: "http://api.exemplo.com/" });
    expect(r.ok).toBe(false);
  });
});

describe("o email precisa de destinatário", () => {
  it("lista vazia vira erro em PT-BR, não exceção", async () => {
    const r = await acoes("real").email({ para: [], assunto: "x", corpo: "y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.toLowerCase()).not.toContain("undefined");
  });

  it("em ensaio dá a MESMA resposta que em modo real — a checagem vem antes do desvio", async () => {
    // A checagem de destinatário vazio precisa valer nos dois modos, e não só
    // no real: senão o aluno testaria em ensaio, veria "sucesso simulado" e só
    // descobriria que faltava destinatário quando ligasse o modo de verdade.
    const rEnsaio = await acoes("ensaio").email({ para: [], assunto: "x", corpo: "y" });
    const rReal = await acoes("real").email({ para: [], assunto: "x", corpo: "y" });
    expect(rEnsaio.ok).toBe(false);
    expect(rReal.ok).toBe(false);
    if (!rEnsaio.ok && !rReal.ok) expect(rEnsaio.erro).toBe(rReal.erro);
  });
});

describe("gravar o rastro nunca esconde o resultado da ação", () => {
  it("registrar lança, mas a ação que deu certo ainda devolve o resultado dela", async () => {
    const a = criarAcoes({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      registrar: async () => {
        throw new Error("banco fora do ar");
      },
      enviarEmail: mandarDeVerdade,
      buscar: vi.fn(async () => new Response("ok", { status: 200 })),
    });

    const r = await a.email({ para: ["a@b.com"], assunto: "x", corpo: "y" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.simulado).toBe(false);
  });

  it("registrar lança, mas a ação que falhou ainda devolve o erro dela", async () => {
    const a = criarAcoes({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      registrar: async () => {
        throw new Error("banco fora do ar");
      },
      enviarEmail: mandarDeVerdade,
      buscar: vi.fn(async () => new Response("ok", { status: 200 })),
    });

    // Lista vazia: a ação falha por conta própria, sem nunca chamar registrar
    // de verdade — e mesmo assim o erro tem que voltar pra quem chamou.
    const r = await a.email({ para: [], assunto: "x", corpo: "y" });
    expect(r.ok).toBe(false);
  });
});

describe("o rastro guarda o que a ação fez de verdade (não só o erro)", () => {
  it("email real: o passo grava o id da mensagem em detalhe", async () => {
    await acoes("real").email({ para: ["a@b.com"], assunto: "x", corpo: "y" });
    expect((passos[0] as { detalhe: string | null }).detalhe).toBe("msg_1");
  });

  it("http real: o passo grava o começo da resposta em detalhe", async () => {
    const a = criarAcoes({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      registrar: async (p) => {
        passos.push(p);
      },
      buscar: vi.fn(async () => new Response("tudo certo por aqui", { status: 200 })),
    });
    await a.http({ metodo: "GET", url: "https://api.exemplo.com/x" });
    expect((passos[0] as { detalhe: string | null }).detalhe).toBe("tudo certo por aqui");
  });

  it("em erro o passo NÃO grava detalhe (o que houve já mora em `erro`)", async () => {
    // Lista vazia: falha antes de qualquer envio, nos dois modos.
    await acoes("real").email({ para: [], assunto: "x", corpo: "y" });
    expect((passos[0] as { detalhe: string | null }).detalhe).toBeNull();
  });
});

/**
 * O AVISO DE ENSAIO NO RASTRO PRECISA DIZER O QUÊ.
 *
 * Ensaio é o PADRÃO de agendamento e webhook (regra 10-L do CLAUDE.md), então
 * esta é a frase que o aluno mais lê no rastro. Antes desta revisão o `detalhe`
 * ficava `null` em ensaio e a tela só sabia escrever "eu teria feito isso" —
 * que não informa nada. Agora o `detalhe` é "o que a ação fez OU teria feito",
 * e é ele que `<RunTrace>` desenha depois de "✋ Ensaio — ".
 */
describe("a frase do ensaio: o que eu TERIA feito", () => {
  it("email: o passo do rastro diz pra quem e com que assunto", async () => {
    await acoes("ensaio").email({
      para: ["chefe@empresa.com"],
      assunto: "3 pedidos atrasados",
      corpo: "Segue o resumo.",
    });

    const detalhe = (passos[0] as { detalhe: string | null }).detalhe ?? "";
    expect(detalhe).toContain("chefe@empresa.com");
    expect(detalhe).toContain("3 pedidos atrasados");
    // Ela é escrita pra ser lida logo depois de "✋ Ensaio — ".
    expect(detalhe.startsWith("eu teria mandado um email para")).toBe(true);
  });

  it("email: a MESMA frase volta pra quem chamou, no `detalhe` do resultado", async () => {
    const r = await acoes("ensaio").email({
      para: ["chefe@empresa.com"],
      assunto: "3 pedidos atrasados",
      corpo: "Segue o resumo.",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.detalhe).toBe((passos[0] as { detalhe: string | null }).detalhe);
  });

  it("email com mais de um destinatário: todos aparecem", async () => {
    await acoes("ensaio").email({
      para: ["a@b.com", "c@d.com"],
      assunto: "x",
      corpo: "y",
    });
    const detalhe = (passos[0] as { detalhe: string | null }).detalhe ?? "";
    expect(detalhe).toContain("a@b.com");
    expect(detalhe).toContain("c@d.com");
  });

  it("http: o passo do rastro diz o endereço e o método", async () => {
    await acoes("ensaio").http({ metodo: "POST", url: "https://api.exemplo.com/pedidos" });
    const detalhe = (passos[0] as { detalhe: string | null }).detalhe ?? "";
    expect(detalhe).toContain("https://api.exemplo.com/pedidos");
    expect(detalhe).toContain("POST");
  });

  it("assunto gigante é cortado ANTES de virar frase — a linha do rastro não estoura", async () => {
    await acoes("ensaio").email({
      para: ["a@b.com"],
      assunto: "P".repeat(5_000),
      corpo: "y",
    });

    const detalhe = (passos[0] as { detalhe: string | null }).detalhe ?? "";
    // Bem abaixo do corte de 500 do rastro: quem cortou foi o pedaço, não a
    // frase inteira...
    expect(detalhe.length).toBeLessThan(300);
    expect(detalhe).toContain("…");
    // ...e por isso ela ainda termina inteira, com aspas e ponto final, em vez
    // de parar no meio de uma palavra.
    expect(detalhe.endsWith('".')).toBe(true);
  });
});

describe("erro de prazo tem frase própria", () => {
  it("o fetch estourando o prazo vira uma frase de 'não respondeu a tempo', não a genérica", async () => {
    const a = criarAcoes({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      registrar: async (p) => {
        passos.push(p);
      },
      // Simula o que o `fetch` do Node de verdade rejeita quando o
      // `AbortSignal.timeout()` estoura (confirmado rodando contra um
      // servidor que nunca responde — ver relatório).
      buscar: vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    });

    const r = await a.http({ metodo: "GET", url: "https://api.exemplo.com/lento" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("não respondeu a tempo");
      expect(r.erro).not.toBe("Não deu pra completar essa ação agora.");
    }
  });
});

describe("o teto de bytes não materializa a resposta inteira", () => {
  it("corpo bem maior que o teto: corta no tamanho certo e cancela o leitor", async () => {
    const TAMANHO_DO_PEDACO = 64 * 1024; // 64 KiB por pedaço
    let cancelado = false;
    let pedacosEntregues = 0;

    // Um "servidor" que nunca para de mandar bytes — se o leitor não for
    // cancelado, isso continuaria pra sempre.
    const corpoGigante = new ReadableStream<Uint8Array>({
      pull(controlador) {
        pedacosEntregues += 1;
        controlador.enqueue(new Uint8Array(TAMANHO_DO_PEDACO).fill(65)); // 'A'
      },
      cancel() {
        cancelado = true;
      },
    });

    const buscarGigante = vi.fn(
      async () =>
        new Response(corpoGigante, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );

    const a = criarAcoes({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      registrar: async (p) => {
        passos.push(p);
      },
      buscar: buscarGigante,
    });

    const r = await a.http({ metodo: "GET", url: "https://api.exemplo.com/gigante" });

    expect(r.ok).toBe(true);
    if (r.ok && !r.simulado) {
      const detalhe = r.detalhe ?? "";
      expect(detalhe.endsWith("… (resposta cortada)")).toBe(true);
      const conteudo = detalhe.slice(0, detalhe.length - "\n… (resposta cortada)".length);
      // Cortado EXATAMENTE no teto, não "mais ou menos" — prova que a conta é
      // em bytes.
      expect(conteudo.length).toBe(TETO_DA_RESPOSTA_BYTES);
    } else {
      throw new Error("devia ter voltado sucesso não simulado");
    }

    // O leitor foi cancelado — a leitura não drenou o stream "infinito" até o
    // fim (ele nunca teria fim).
    expect(cancelado).toBe(true);
    // Só um punhado de pedaços foi puxado antes de parar — não milhares.
    expect(pedacosEntregues).toBeLessThan(50);
  });

  it("Content-Length já anuncia um corpo maior que o teto: nem começa a ler", async () => {
    let cancelado = false;
    const corpo = new ReadableStream<Uint8Array>({
      start(controlador) {
        controlador.enqueue(new Uint8Array(1024).fill(66)); // 'B'
        controlador.close();
      },
      cancel() {
        cancelado = true;
      },
    });

    const buscarAnunciado = vi.fn(
      async () =>
        new Response(corpo, {
          status: 200,
          headers: { "content-length": String(TETO_DA_RESPOSTA_BYTES + 1024) },
        }),
    );

    const a = criarAcoes({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      registrar: async (p) => {
        passos.push(p);
      },
      buscar: buscarAnunciado,
    });

    const r = await a.http({ metodo: "GET", url: "https://api.exemplo.com/anunciado" });
    expect(r.ok).toBe(true);
    if (r.ok && !r.simulado) {
      // Nada foi lido: o texto é só o aviso de corte, sem conteúdo nenhum.
      expect(r.detalhe).toBe("\n… (resposta cortada)");
    }
    expect(cancelado).toBe(true);
  });
});
