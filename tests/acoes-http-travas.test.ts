/**
 * AS TRAVAS DO ENDEREÇO DE SAÍDA.
 *
 * A partir desta onda o agente alcança a internet. Duas travas são contra
 * ataque e duas são contra acidente:
 *
 *   • `169.254.169.254` é o endereço de metadados da nuvem — devolve a
 *     credencial da própria máquina. É o alvo clássico de SSRF;
 *   • um domínio comum pode apontar pra `127.0.0.1`, então conferir só o texto
 *     do endereço não basta (ver o aviso em `acoes.ts` sobre o IP resolvido);
 *   • prazo e teto de tamanho quebram por acidente, não por ataque: a resposta
 *     vira ENTRADA DO MODELO, e 40 MB de JSON estoura a janela e o processo.
 *
 * O último bloco é o único que sai de `acoes-url.ts` e olha o `fetch` de
 * verdade: `redirect: "error"` mora em `acoes.ts`, e é a trava que fecha o
 * buraco que a conferência de texto deixa aberto de propósito.
 */
import { describe, expect, it, vi } from "vitest";
import { criarAcoes } from "@/lib/agents/acoes";
import {
  conferirEnderecoDeSaida,
  ehIpInterno,
  PRAZO_DA_ACAO_MS,
  TETO_DA_RESPOSTA_BYTES,
} from "@/lib/agents/acoes-url";

describe("só https", () => {
  it("recusa http", () => {
    const r = conferirEnderecoDeSaida("http://api.exemplo.com/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("https");
  });

  it("recusa esquema esquisito", () => {
    for (const u of ["file:///etc/passwd", "ftp://x.com", "javascript:alert(1)"]) {
      expect(conferirEnderecoDeSaida(u).ok).toBe(false);
    }
  });

  it("aceita https", () => {
    expect(conferirEnderecoDeSaida("https://api.exemplo.com/pedidos").ok).toBe(true);
  });
});

describe("rede interna", () => {
  it("recusa loopback, privado e link-local", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.10",
      "169.254.169.254",
      "[::1]",
      "0.0.0.0",
    ]) {
      expect(conferirEnderecoDeSaida(`https://${host}/x`).ok, host).toBe(false);
    }
  });

  it("o endereço de metadados da nuvem tem que estar coberto", () => {
    expect(ehIpInterno("169.254.169.254")).toBe(true);
  });

  it("endereço público passa", () => {
    expect(ehIpInterno("8.8.8.8")).toBe(false);
    expect(ehIpInterno("api.exemplo.com")).toBe(false);
  });

  it("notações alternativas de IPv4 também são bloqueadas", () => {
    // 2130706433 é a representação decimal de 127.0.0.1
    expect(ehIpInterno("2130706433")).toBe(true);
    // 0177.0.0.1 é a representação octal de 127.0.0.1
    expect(ehIpInterno("0177.0.0.1")).toBe(true);
    // 127.1 é a forma abreviada de 127.0.0.1 (o último número vira o resto)
    expect(ehIpInterno("127.1")).toBe(true);
  });

  it("faixa CGNAT também é bloqueada", () => {
    expect(ehIpInterno("100.64.0.1")).toBe(true);
    expect(ehIpInterno("100.127.255.255")).toBe(true);
  });

  /**
   * ⚠️ O PONTO FINAL É A RAIZ DO DNS, e todo resolvedor trata `localhost.` e
   * `localhost` como o MESMO endereço. Achado (e reproduzido) na revisão da
   * onda 7: `conferirEnderecoDeSaida("https://localhost./x")` devolvia
   * `ok: true`, e a ação saía pra dentro da própria máquina do servidor.
   *
   * O IPv4 escrito na mão furava por um caminho diferente e igualmente
   * silencioso: `127.0.0.1.` tem CINCO partes depois do `split(".")`, e a
   * função concluía "não é IPv4 literal, é um nome".
   */
  it("⚠️ ponto final não fura a trava (localhost. é localhost)", () => {
    for (const host of [
      "localhost.",
      "localhost..",
      "LOCALHOST.",
      "ip6-localhost.",
      "127.0.0.1.",
      "10.0.0.5.",
      "192.168.1.10.",
      "172.16.0.1.",
      "169.254.169.254.",
      "100.64.0.1.",
      // As notações alternativas também têm que continuar cobertas com ponto.
      "2130706433.",
      "0177.0.0.1.",
      "127.1.",
    ]) {
      expect(ehIpInterno(host), host).toBe(true);
      expect(conferirEnderecoDeSaida(`https://${host}/x`).ok, host).toBe(false);
    }
  });

  it("mas o ponto final NÃO transforma endereço público em interno", () => {
    expect(ehIpInterno("api.exemplo.com.")).toBe(false);
    expect(ehIpInterno("8.8.8.8.")).toBe(false);
    expect(conferirEnderecoDeSaida("https://api.exemplo.com./pedidos").ok).toBe(true);
  });

  it("texto que é só ponto não quebra nem vira interno", () => {
    expect(ehIpInterno(".")).toBe(false);
    expect(ehIpInterno("..")).toBe(false);
  });
});

describe("os números", () => {
  it("prazo de 20 s e teto de 256 KB", () => {
    expect(PRAZO_DA_ACAO_MS).toBe(20_000);
    expect(TETO_DA_RESPOSTA_BYTES).toBe(262_144);
  });
});

describe("a mensagem é pro modelo ler, em PT-BR", () => {
  it("sem jargão em inglês", () => {
    const r = conferirEnderecoDeSaida("http://x.com");
    if (r.ok) throw new Error("devia ter recusado");
    expect(r.erro.toLowerCase()).not.toContain("invalid");
    expect(r.erro.toLowerCase()).not.toContain("protocol");
  });
});

/**
 * ⚠️ ESTE BLOCO EXISTE PRA IMPEDIR QUE ALGUÉM TIRE `redirect: "error"`.
 *
 * A conferência de endereço (`conferirEnderecoDeSaida`) olha só o TEXTO do
 * endereço — está escrito no cabeçalho de `acoes-url.ts` que a resolução de
 * nome não é conferida em lugar nenhum, e isso é risco conhecido e aceito. O
 * que fecha a porta mais óbvia desse buraco é o `fetch` recusar seguir
 * redirecionamento: sem isso, `https://um-dominio-inocente.com/x` responde
 * `302 → http://169.254.169.254/latest/meta-data/` e a credencial da máquina
 * volta como resposta pro modelo, com o endereço de saída tendo passado por
 * todas as conferências.
 *
 * A trava já existia; o que faltava era o teste. Tirar a linha não quebrava
 * nada, e o `npm run verify` continuava verde.
 */
describe("a ação HTTP recusa seguir redirecionamento", () => {
  function acoesComFetchFalso(buscar: typeof fetch) {
    return criarAcoes({
      modo: "real",
      organizationId: "11111111-1111-1111-1111-111111111111",
      registrar: async () => {},
      buscar,
    });
  }

  it('o `fetch` é chamado com redirect: "error"', async () => {
    const chamadas: RequestInit[] = [];
    const buscar = vi.fn(async (_url: unknown, init?: RequestInit) => {
      chamadas.push(init ?? {});
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const r = await acoesComFetchFalso(buscar).http({
      metodo: "GET",
      url: "https://api.exemplo.com/pedidos",
    });

    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.redirect).toBe("error");
    // Nunca "follow" nem "manual": os dois deixariam o 302 pra dentro passar
    // (o "manual" devolveria a resposta do redirecionamento pro modelo ler).
    expect(chamadas[0]?.redirect).not.toBe("follow");
    expect(chamadas[0]?.redirect).not.toBe("manual");
  });

  it("vale pra POST também, não só pra GET", async () => {
    const chamadas: RequestInit[] = [];
    const buscar = vi.fn(async (_url: unknown, init?: RequestInit) => {
      chamadas.push(init ?? {});
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;

    await acoesComFetchFalso(buscar).http({
      metodo: "POST",
      url: "https://api.exemplo.com/pedidos",
      corpo: { a: 1 },
    });

    expect(chamadas[0]?.redirect).toBe("error");
  });

  it("quando o outro lado redireciona, o modelo lê uma frase leiga — não o erro cru", async () => {
    // É assim que o `fetch` do Node reage a um 302 com `redirect: "error"`.
    const buscar = vi.fn(async () => {
      throw new TypeError("fetch failed: unexpected redirect");
    }) as unknown as typeof fetch;

    const r = await acoesComFetchFalso(buscar).http({
      metodo: "GET",
      url: "https://api.exemplo.com/pedidos",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBe("Não deu pra completar essa ação agora.");
      expect(r.erro).not.toContain("redirect");
    }
  });
});
