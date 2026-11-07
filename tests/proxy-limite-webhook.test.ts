/**
 * OS DOIS BALDES DO PORTEIRO (`proxy.ts`), NA PORTA DE FORA.
 *
 * O defeito que este arquivo tranca: `/api/webhooks/**` inteiro dividia UM
 * contador de 60 chamadas/minuto por endereço de origem. O endereço de
 * "buscar depois" (`GET .../j/<jobId>`), que a doc do aluno manda chamar de
 * tempos em tempos até a resposta ficar pronta, gastava o MESMO balde que o
 * POST de negócio — então um trabalho lento levava junto o próximo evento de
 * verdade do mesmo n8n. E o 429 saía em texto puro, sem o `code` que as duas
 * rotas prometem.
 *
 * ⚠️ `TRUST_PROXY=1` é obrigatório aqui: sem confiar no proxy, o porteiro NÃO
 * descobre o endereço de origem e (de propósito) não limita ninguém.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// O caminho do webhook devolve antes de tocar na sessão. O mock existe só pra
// o import do módulo não arrastar o cliente do Supabase pro teste.
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async () => {
    throw new Error("o caminho do webhook nunca deve chegar na sessão");
  }),
}));

process.env.TRUST_PROXY = "1";

const { NextRequest } = await import("next/server");
const { proxy } = await import("@/proxy");

const ENDPOINT = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB = "bbbbbbbb-2222-4222-8222-222222222222";

/** Um IP diferente por teste: o contador vive na memória do módulo. */
let contador = 0;
function ipNovo(): string {
  contador += 1;
  return `203.0.113.${contador}`;
}

function pedido(caminho: string, ip: string, metodo: "GET" | "POST") {
  return new NextRequest(`https://meuapp.com${caminho}`, {
    method: metodo,
    headers: { "x-forwarded-for": ip },
  });
}

function disparar(ip: string) {
  return proxy(pedido(`/api/webhooks/${ENDPOINT}`, ip, "POST"));
}

function buscar(ip: string) {
  return proxy(pedido(`/api/webhooks/${ENDPOINT}/j/${JOB}`, ip, "GET"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("o POST de negócio continua com o teto apertado", () => {
  it("60 passam, a 61ª leva 429", async () => {
    const ip = ipNovo();
    for (let i = 0; i < 60; i++) {
      expect((await disparar(ip)).status).not.toBe(429);
    }
    expect((await disparar(ip)).status).toBe(429);
  });
});

describe("buscar o resultado tem balde próprio", () => {
  it("passa MUITO além das 60 chamadas que derrubariam o POST", async () => {
    const ip = ipNovo();
    for (let i = 0; i < 200; i++) {
      expect((await buscar(ip)).status, `chamada ${i + 1}`).not.toBe(429);
    }
  });

  it("⚠️ o polling não derruba o POST de negócio do mesmo endereço de origem", async () => {
    const ip = ipNovo();
    // Muito mais que as 60 do POST: com um balde só, isto estourava o teto.
    for (let i = 0; i < 120; i++) {
      await buscar(ip);
    }
    // O evento de verdade continua passando.
    expect((await disparar(ip)).status).not.toBe(429);
  });

  it("mas teto existe: o balde de buscar também fecha", async () => {
    const ip = ipNovo();
    for (let i = 0; i < 300; i++) {
      expect((await buscar(ip)).status).not.toBe(429);
    }
    expect((await buscar(ip)).status).toBe(429);
  });

  it("e estourar o balde de buscar NÃO derruba o POST", async () => {
    const ip = ipNovo();
    for (let i = 0; i < 301; i++) {
      await buscar(ip);
    }
    expect((await disparar(ip)).status).not.toBe(429);
  });
});

describe("a recusa fala a mesma língua das rotas", () => {
  it("429 é JSON com `code`, nunca texto puro", async () => {
    const ip = ipNovo();
    for (let i = 0; i < 60; i++) await disparar(ip);

    const resp = await disparar(ip);

    expect(resp.status).toBe(429);
    expect(resp.headers.get("content-type")).toContain("application/json");
    expect(resp.headers.get("retry-after")).toBe("60");
    const corpo = (await resp.json()) as { ok: boolean; code: string; error: string };
    expect(corpo.ok).toBe(false);
    expect(corpo.code).toBe("limite_de_chamadas");
    expect(corpo.error).toMatch(/Espere um minuto/);
  });
});

describe("sem endereço de origem, ninguém é limitado", () => {
  it("preferimos não limitar a jogar todo mundo no mesmo balde", async () => {
    for (let i = 0; i < 100; i++) {
      const req = new NextRequest(`https://meuapp.com/api/webhooks/${ENDPOINT}`, {
        method: "POST",
      });
      expect((await proxy(req)).status).not.toBe(429);
    }
  });
});
