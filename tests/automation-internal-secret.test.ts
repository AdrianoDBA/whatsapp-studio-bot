/**
 * O SEGREDO DA CHAMADA INTERNA (trabalhador → /api/internal/run-job).
 *
 * Três coisas que este arquivo trava:
 *
 * 1. **O site e o trabalhador derivam o MESMO segredo.** Se eles discordarem,
 *    o sintoma é 401 na chamada interna e nenhuma automação roda — e ninguém
 *    adivinha o motivo olhando o log.
 * 2. **Nenhuma variável de ambiente nova.** O segredo sai da ENCRYPTION_KEY,
 *    que já é obrigatória.
 * 3. **A assinatura amarra o trabalho, o trabalhador e o momento.** Uma
 *    assinatura capturada não serve pra outro trabalho, nem pra amanhã.
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import { chamadaVeioDeFora } from "@/lib/automation/chamada-interna";
import { internalJobSecret } from "@/lib/env";
import {
  assinarChamada,
  assinarChamadaSemear,
  conferirAssinatura,
  conferirAssinaturaSemear,
  derivarSegredoInterno,
} from "@/scripts/lib/segredo-interno.mjs";

const CHAVE = randomBytes(32).toString("base64");
const JOB = "aaaa1111-1111-4111-8111-111111111111";
const OUTRO_JOB = "bbbb2222-2222-4222-8222-222222222222";
const TRABALHADOR = "container-1234";
const ORG = "cccc3333-3333-4333-8333-333333333333";
const OUTRA_ORG = "dddd4444-4444-4444-8444-444444444444";

describe("o segredo deriva da ENCRYPTION_KEY, e de mais nada", () => {
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  test("são 32 bytes em hexadecimal", () => {
    const segredo = derivarSegredoInterno(CHAVE);
    expect(segredo).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a mesma chave sempre dá o mesmo segredo", () => {
    expect(derivarSegredoInterno(CHAVE)).toBe(derivarSegredoInterno(CHAVE));
  });

  test("chave diferente dá segredo diferente", () => {
    const outra = randomBytes(32).toString("base64");
    expect(derivarSegredoInterno(CHAVE)).not.toBe(derivarSegredoInterno(outra));
  });

  test("chave vazia estoura com instrução em português", () => {
    expect(() => derivarSegredoInterno("")).toThrow(/ENCRYPTION_KEY/);
    expect(() => derivarSegredoInterno(null)).toThrow(/npm run gerar-chave/);
  });

  test("o SITE (lib/env.ts) e o TRABALHADOR derivam exatamente o mesmo segredo", () => {
    // Este é o teste que impede o 401 misterioso. Os dois processos calculam
    // o segredo em lugares diferentes; aqui a gente prova que eles concordam.
    process.env.ENCRYPTION_KEY = CHAVE;
    expect(internalJobSecret()).toBe(derivarSegredoInterno(CHAVE));
  });

  test("o segredo NÃO é a própria ENCRYPTION_KEY", () => {
    // Se fosse, um vazamento do segredo interno seria um vazamento da chave
    // mestra do cofre — ou seja, de todas as chaves de API cadastradas.
    expect(derivarSegredoInterno(CHAVE)).not.toContain(CHAVE);
    expect(Buffer.from(derivarSegredoInterno(CHAVE), "hex").toString("base64")).not.toBe(CHAVE);
  });
});

describe("a assinatura amarra trabalho, trabalhador e momento", () => {
  const segredo = derivarSegredoInterno(CHAVE);
  const momento = 1_700_000_000_000;

  test("a assinatura certa confere", () => {
    const assinatura = assinarChamada(segredo, JOB, TRABALHADOR, momento);
    expect(conferirAssinatura(segredo, JOB, TRABALHADOR, momento, assinatura)).toBe(true);
  });

  test("assinatura de OUTRO trabalho não confere", () => {
    const assinatura = assinarChamada(segredo, JOB, TRABALHADOR, momento);
    expect(conferirAssinatura(segredo, OUTRO_JOB, TRABALHADOR, momento, assinatura)).toBe(false);
  });

  test("assinatura de OUTRO trabalhador não confere", () => {
    const assinatura = assinarChamada(segredo, JOB, TRABALHADOR, momento);
    expect(conferirAssinatura(segredo, JOB, "outro-container", momento, assinatura)).toBe(false);
  });

  test("assinatura de OUTRO momento não confere", () => {
    const assinatura = assinarChamada(segredo, JOB, TRABALHADOR, momento);
    expect(conferirAssinatura(segredo, JOB, TRABALHADOR, momento + 1, assinatura)).toBe(false);
  });

  test("assinatura feita com outro segredo não confere", () => {
    const outro = derivarSegredoInterno(randomBytes(32).toString("base64"));
    const assinatura = assinarChamada(outro, JOB, TRABALHADOR, momento);
    expect(conferirAssinatura(segredo, JOB, TRABALHADOR, momento, assinatura)).toBe(false);
  });

  test("lixo no lugar da assinatura devolve false em vez de estourar", () => {
    for (const lixo of ["", "abc", "não é hex", "0".repeat(63), "0".repeat(65)]) {
      expect(conferirAssinatura(segredo, JOB, TRABALHADOR, momento, lixo)).toBe(false);
    }
    // Sem `as any`: a função é declarada aceitando string, e o teste do
    // caminho "veio undefined" passa por uma conversão explícita.
    expect(conferirAssinatura(segredo, JOB, TRABALHADOR, momento, String(undefined))).toBe(false);
  });

  test("um caractere trocado no meio já derruba", () => {
    const assinatura = assinarChamada(segredo, JOB, TRABALHADOR, momento);
    const primeiro = assinatura[0] === "a" ? "b" : "a";
    const mexida = primeiro + assinatura.slice(1);
    expect(conferirAssinatura(segredo, JOB, TRABALHADOR, momento, mexida)).toBe(false);
  });
});

/**
 * A ASSINATURA DE `npm run semear` — mesmo segredo (deriva da mesma
 * ENCRYPTION_KEY), texto assinado DIFERENTE (`semear-v1
...`, sem `jobId`
 * nem `workerId`).
 *
 * ⚠️ RODADA DE CONSERTO 1 (I3): antes deste teste, nada travava a separação
 * de domínio entre `assinarChamada` e `assinarChamadaSemear`. Um refactor que
 * "simplificasse" `assinarChamadaSemear` reaproveitando `assinarChamada`
 * (por exemplo `assinarChamada(segredo, "", "", ts)`) deixaria o cliente
 * legítimo passando, o `npm run verify` verde, e uma assinatura de `run-job`
 * capturada dentro do container valendo como assinatura de `semear` — sem
 * teste nenhum acusando. Os dois testes de cruzamento abaixo existem
 * exatamente pra prender essa garantia.
 */
describe("a assinatura de semear amarra organizationId e momento", () => {
  const segredo = derivarSegredoInterno(CHAVE);
  const momento = 1_700_000_000_000;

  test("a assinatura certa confere", () => {
    const assinatura = assinarChamadaSemear(segredo, ORG, momento);
    expect(conferirAssinaturaSemear(segredo, ORG, momento, assinatura)).toBe(true);
  });

  test("funciona também com organizationId vazio (varredura completa)", () => {
    const assinatura = assinarChamadaSemear(segredo, "", momento);
    expect(conferirAssinaturaSemear(segredo, "", momento, assinatura)).toBe(true);
  });

  test("assinatura de OUTRO workspace não confere", () => {
    const assinatura = assinarChamadaSemear(segredo, ORG, momento);
    expect(conferirAssinaturaSemear(segredo, OUTRA_ORG, momento, assinatura)).toBe(false);
  });

  test("assinatura de OUTRO momento não confere", () => {
    const assinatura = assinarChamadaSemear(segredo, ORG, momento);
    expect(conferirAssinaturaSemear(segredo, ORG, momento + 1, assinatura)).toBe(false);
  });

  test("assinatura feita com outro segredo não confere", () => {
    const outro = derivarSegredoInterno(randomBytes(32).toString("base64"));
    const assinatura = assinarChamadaSemear(outro, ORG, momento);
    expect(conferirAssinaturaSemear(segredo, ORG, momento, assinatura)).toBe(false);
  });

  test("lixo no lugar da assinatura devolve false em vez de estourar", () => {
    for (const lixo of ["", "abc", "não é hex", "0".repeat(63), "0".repeat(65)]) {
      expect(conferirAssinaturaSemear(segredo, ORG, momento, lixo)).toBe(false);
    }
  });

  test("um caractere trocado no meio já derruba", () => {
    const assinatura = assinarChamadaSemear(segredo, ORG, momento);
    const primeiro = assinatura[0] === "a" ? "b" : "a";
    const mexida = primeiro + assinatura.slice(1);
    expect(conferirAssinaturaSemear(segredo, ORG, momento, mexida)).toBe(false);
  });
});

/**
 * O CRUZAMENTO — o ponto central do I3. `run-job` e `semear` derivam do
 * MESMO segredo (mesma ENCRYPTION_KEY), então a única coisa que impede uma
 * assinatura de servir pra outra é o texto assinado ser diferente
 * (`v1
...` vs `semear-v1
...`). Se algum dia as duas funções colapsarem
 * pro mesmo texto — por "simplificação" —, estes dois testes quebram.
 */
describe("run-job e semear nunca aceitam a assinatura um do outro", () => {
  const segredo = derivarSegredoInterno(CHAVE);
  const momento = 1_700_000_000_000;

  test("assinatura de run-job não confere como assinatura de semear", () => {
    const assinaturaDeJob = assinarChamada(segredo, JOB, TRABALHADOR, momento);
    expect(conferirAssinaturaSemear(segredo, JOB, momento, assinaturaDeJob)).toBe(false);
  });

  test("assinatura de semear não confere como assinatura de run-job", () => {
    const assinaturaDeSemear = assinarChamadaSemear(segredo, ORG, momento);
    expect(conferirAssinatura(segredo, ORG, TRABALHADOR, momento, assinaturaDeSemear)).toBe(false);
  });
});

describe("a rota interna", () => {
  test("confere a assinatura ANTES de tocar na fila", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fonte = readFileSync(
      join(process.cwd(), "app", "api", "internal", "run-job", "route.ts"),
      "utf8",
    );

    const posicaoDaConferencia = fonte.indexOf("conferirAssinatura(");
    const posicaoDoTrabalho = fonte.indexOf("executarTrabalho(");
    expect(posicaoDaConferencia).toBeGreaterThan(-1);
    expect(posicaoDoTrabalho).toBeGreaterThan(posicaoDaConferencia);
  });

  test("recusa pedido que chegou de fora, nas DUAS camadas", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fonte = readFileSync(
      join(process.cwd(), "app", "api", "internal", "run-job", "route.ts"),
      "utf8",
    );
    expect(fonte).toContain("chamadaVeioDeFora(req.headers)");
    expect(fonte).toContain("404");

    // E o porteiro faz a mesma coisa, uma camada antes.
    const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    expect(proxy).toContain('pathname.startsWith("/api/internal")');
    expect(proxy).toContain("chamadaVeioDeFora(request.headers)");
  });

  test("a rota de semear também confere a assinatura ANTES de materializar", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fonte = readFileSync(
      join(process.cwd(), "app", "api", "internal", "semear", "route.ts"),
      "utf8",
    );

    const posicaoDaConferencia = fonte.indexOf("conferirAssinaturaSemear(");
    const posicaoDoSemear = fonte.indexOf("semearWorkspaces(");
    expect(posicaoDaConferencia).toBeGreaterThan(-1);
    expect(posicaoDoSemear).toBeGreaterThan(posicaoDaConferencia);
  });

  test("a rota de semear recusa pedido que chegou de fora", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fonte = readFileSync(
      join(process.cwd(), "app", "api", "internal", "semear", "route.ts"),
      "utf8",
    );
    expect(fonte).toContain("chamadaVeioDeFora(req.headers)");
    expect(fonte).toContain("404");
  });

  test("a rota de semear confere a JANELA antes de calcular o HMAC", async () => {
    // Mesma disciplina do run-job: assinatura velha nem chega a ser
    // computada — o relógio decide primeiro, o segredo depois.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fonte = readFileSync(
      join(process.cwd(), "app", "api", "internal", "semear", "route.ts"),
      "utf8",
    );

    const posicaoDaJanela = fonte.indexOf("JANELA_MS");
    const posicaoDoSegredo = fonte.indexOf("internalJobSecret()");
    expect(posicaoDaJanela).toBeGreaterThan(-1);
    expect(posicaoDoSegredo).toBeGreaterThan(-1);
    expect(posicaoDoSegredo).toBeGreaterThan(posicaoDaJanela);
  });
});

describe("de dentro do container ou de fora?", () => {
  function comCabecalhos(pares: Record<string, string>): Headers {
    return new Headers(pares);
  }

  test("chamada do trabalhador (loopback) conta como DE DENTRO", () => {
    // ⚠️ O PRÓPRIO NEXT carimba `x-forwarded-*` em todo pedido, inclusive num
    // pedido feito pra 127.0.0.1. Se a conferência fosse "tem o cabeçalho?",
    // a rota interna responderia 404 pro trabalhador e NENHUMA automação
    // rodaria. Este teste existe por causa disso.
    expect(
      chamadaVeioDeFora(
        comCabecalhos({
          "x-forwarded-for": "127.0.0.1",
          "x-forwarded-host": "127.0.0.1:80",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "80",
        }),
      ),
    ).toBe(false);
  });

  test("as outras formas de escrever loopback também contam como de dentro", () => {
    for (const endereco of ["::1", "::ffff:127.0.0.1", "[::1]:54321", "127.0.0.1:3000"]) {
      expect(chamadaVeioDeFora(comCabecalhos({ "x-forwarded-for": endereco })), endereco).toBe(
        false,
      );
    }
  });

  test("pedido sem cabeçalho nenhum conta como de dentro", () => {
    expect(chamadaVeioDeFora(comCabecalhos({}))).toBe(false);
  });

  test("endereço de internet na cadeia conta como DE FORA", () => {
    expect(chamadaVeioDeFora(comCabecalhos({ "x-forwarded-for": "203.0.113.9" }))).toBe(true);
    expect(chamadaVeioDeFora(comCabecalhos({ "x-real-ip": "203.0.113.9" }))).toBe(true);
  });

  test("loopback FORJADO no começo da cadeia não engana", () => {
    // O proxy do EasyPanel ACRESCENTA o endereço real no fim em vez de trocar.
    // Basta um endereço de fora na lista pra resposta ser "veio de fora".
    expect(chamadaVeioDeFora(comCabecalhos({ "x-forwarded-for": "127.0.0.1, 203.0.113.9" }))).toBe(
      true,
    );
  });
});
