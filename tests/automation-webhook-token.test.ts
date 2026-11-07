/**
 * O TOKEN DO WEBHOOK: como ele nasce e como ele é conferido.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ O QUE ESTE ARQUIVO PROTEGE (ameaça T14 do contrato)                     │
 * │                                                                          │
 * │ Um webhook é um endereço que dispara um agente SEM ninguém logado. O    │
 * │ token é a única coisa entre a internet e o agente do aluno. Então:      │
 * │                                                                          │
 * │  • o token é sorteado (32 bytes), nunca previsível;                     │
 * │  • o banco guarda SÓ o sha256 dele — quem lê o banco não consegue       │
 * │    chamar o webhook;                                                     │
 * │  • a comparação é em TEMPO CONSTANTE: com `===`, o tempo de resposta    │
 * │    contaria quantos caracteres do começo estavam certos, e o ataque     │
 * │    viraria caractere por caractere;                                      │
 * │  • quem não provou o token não descobre NADA — nem se o endereço está   │
 * │    ligado;                                                               │
 * │  • organização, agente e identidade saem SEMPRE da linha do banco,      │
 * │    nunca de quem chamou.                                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * A fila fala com o banco por `pg`. Aqui ela é de mentira: o que está sendo
 * testado é a decisão, não a consulta.
 */
const fila = vi.hoisted(() => ({
  webhookEndpointForCheck: vi.fn(),
  webhookTouch: vi.fn(),
}));

vi.mock("@/lib/automation/queue", () => fila);

import {
  gerarTokenDeWebhook,
  hashDeToken,
  LIMITE_DE_CHAMADAS_POR_MINUTO,
  montarUrlDoWebhook,
  PREFIXO_DO_TOKEN,
  TAMANHO_DO_APELIDO_DO_TOKEN,
  tokenDoPedido,
  verificarWebhook,
} from "@/lib/automation/webhooks";

const ENDPOINT = "aaaaaaaa-1111-4111-8111-111111111111";
const ORG = "bbbbbbbb-2222-4222-8222-222222222222";
const AGENTE = "cccccccc-3333-4333-8333-333333333333";
const DONO = "dddddddd-4444-4444-8444-444444444444";

/** A linha do banco, do jeito que `webhook_endpoint_for_check` devolve. */
function linhaDoBanco(token: string, extra: Record<string, unknown> = {}) {
  return {
    id: ENDPOINT,
    organizationId: ORG,
    agentId: AGENTE,
    tokenHash: hashDeToken(token),
    isActive: true,
    runAs: DONO,
    ...extra,
  };
}

beforeEach(() => {
  fila.webhookEndpointForCheck.mockReset();
  fila.webhookTouch.mockReset();
  fila.webhookTouch.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Como o token nasce
// ---------------------------------------------------------------------------

describe("gerarTokenDeWebhook", () => {
  test("tem o prefixo que identifica o que é aquilo", () => {
    expect(gerarTokenDeWebhook().token.startsWith(PREFIXO_DO_TOKEN)).toBe(true);
  });

  test("são 32 bytes sorteados, em base64url (nada que precise de escape na URL)", () => {
    const { token } = gerarTokenDeWebhook();
    const corpo = token.slice(PREFIXO_DO_TOKEN.length);
    expect(corpo).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(corpo, "base64url")).toHaveLength(32);
  });

  test("duzentos sorteios seguidos não repetem nenhum", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 200; i++) vistos.add(gerarTokenDeWebhook().token);
    expect(vistos.size).toBe(200);
  });

  test("o hash que vai pro banco é o sha256 do token", () => {
    const novo = gerarTokenDeWebhook();
    expect(novo.tokenHash).toBe(hashDeToken(novo.token));
    expect(novo.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("⚠️ o que vai pro banco NÃO dá pra usar como token", () => {
    // Se alguém trocasse o hash pelo token na hora de gravar, quem lesse o
    // banco chamaria o webhook de todo mundo. Este teste é o alarme disso.
    const novo = gerarTokenDeWebhook();
    expect(novo.tokenHash).not.toBe(novo.token);
    expect(novo.tokenHash.startsWith(PREFIXO_DO_TOKEN)).toBe(false);
  });

  test("o apelido é o começo do token, e cabe na coluna do banco (16)", () => {
    const novo = gerarTokenDeWebhook();
    expect(novo.tokenPrefix).toBe(novo.token.slice(0, TAMANHO_DO_APELIDO_DO_TOKEN));
    expect(novo.tokenPrefix.length).toBeLessThanOrEqual(16);
    // Curto o bastante pra não servir de atalho pra adivinhar o resto.
    expect(novo.tokenPrefix.length).toBeLessThan(novo.token.length / 2);
  });
});

describe("hashDeToken", () => {
  test("o mesmo token dá sempre o mesmo hash", () => {
    expect(hashDeToken("whk_abc")).toBe(hashDeToken("whk_abc"));
  });

  test("um caractere diferente muda o hash inteiro", () => {
    expect(hashDeToken("whk_abc")).not.toBe(hashDeToken("whk_abd"));
  });

  test("é sempre 64 caracteres em hexadecimal — o formato que a coluna exige", () => {
    expect(hashDeToken("")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeToken(gerarTokenDeWebhook().token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// A conferência
// ---------------------------------------------------------------------------

describe("verificarWebhook", () => {
  test("token certo, endpoint ligado: passa, com os dados VINDOS DO BANCO", async () => {
    const { token } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token));

    const resultado = await verificarWebhook(ENDPOINT, token);

    expect(resultado).toEqual({
      ok: true,
      endpointId: ENDPOINT,
      organizationId: ORG,
      agentId: AGENTE,
      runAs: DONO,
    });
  });

  test("⚠️ a identidade sai da LINHA do banco, nunca de quem chamou", async () => {
    // Quem chama o webhook manda um corpo qualquer e um token. Nada mais. Se
    // um dia a organização ou o `run_as` passassem a vir do pedido, dava pra
    // pedir "rode no nome de outra pessoa" — é a ameaça T5, e ela morre aqui.
    const { token } = gerarTokenDeWebhook();
    const outroDono = "eeeeeeee-5555-4555-8555-555555555555";
    fila.webhookEndpointForCheck.mockResolvedValue(
      linhaDoBanco(token, {
        runAs: outroDono,
        organizationId: "ffffffff-6666-4666-8666-666666666666",
      }),
    );

    const resultado = await verificarWebhook(ENDPOINT, token);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.runAs).toBe(outroDono);
      expect(resultado.organizationId).toBe("ffffffff-6666-4666-8666-666666666666");
    }
  });

  test("endpoint que não existe: “não encontrado”, e NÃO conta chamada", async () => {
    fila.webhookEndpointForCheck.mockResolvedValue(null);

    const resultado = await verificarWebhook(ENDPOINT, gerarTokenDeWebhook().token);

    expect(resultado).toEqual({ ok: false, motivo: "nao-encontrado" });
    // Contar a chamada de um endereço que não existe seria contar em cima de
    // nada — e, pior, daria pra medir a diferença de tempo pelo relógio.
    expect(fila.webhookTouch).not.toHaveBeenCalled();
  });

  test("token errado: recusa, e NÃO conta chamada", async () => {
    const bom = gerarTokenDeWebhook().token;
    const ruim = gerarTokenDeWebhook().token;
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(bom));

    const resultado = await verificarWebhook(ENDPOINT, ruim);

    expect(resultado).toEqual({ ok: false, motivo: "token-invalido" });
    expect(fila.webhookTouch).not.toHaveBeenCalled();
  });

  test("token que erra UM caractere é recusado igual", async () => {
    const bom = gerarTokenDeWebhook().token;
    const quaseBom = `${bom.slice(0, -1)}${bom.endsWith("A") ? "B" : "A"}`;
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(bom));

    expect(await verificarWebhook(ENDPOINT, quaseBom)).toEqual({
      ok: false,
      motivo: "token-invalido",
    });
  });

  test("token vazio é recusado", async () => {
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(gerarTokenDeWebhook().token));
    expect(await verificarWebhook(ENDPOINT, "")).toEqual({ ok: false, motivo: "token-invalido" });
  });

  test("⚠️ mandar o HASH no lugar do token NÃO funciona", async () => {
    // Prova que a conferência compara o sha256 DO QUE CHEGOU com o guardado —
    // e não o valor cru com a coluna. Se alguém invertesse isso, quem tivesse
    // acesso de leitura ao banco chamaria todos os webhooks.
    const { token, tokenHash } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token));

    expect(await verificarWebhook(ENDPOINT, tokenHash)).toEqual({
      ok: false,
      motivo: "token-invalido",
    });
  });

  test("endpoint desligado: só quem provou o token descobre isso", async () => {
    const { token } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token, { isActive: false }));

    // Com o token certo, a resposta é específica...
    expect(await verificarWebhook(ENDPOINT, token)).toEqual({ ok: false, motivo: "desligado" });
    expect(fila.webhookTouch).not.toHaveBeenCalled();

    // ...e com o token errado, continua sendo só "token inválido". Quem não
    // tem o token não fica sabendo nem que o endereço existe e está desligado.
    expect(await verificarWebhook(ENDPOINT, gerarTokenDeWebhook().token)).toEqual({
      ok: false,
      motivo: "token-invalido",
    });
  });

  test("estourou o limite do minuto: recusa", async () => {
    const { token } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token));
    fila.webhookTouch.mockResolvedValue(false);

    expect(await verificarWebhook(ENDPOINT, token)).toEqual({ ok: false, motivo: "limite" });
  });

  test("o limite é contado no BANCO, com o id da linha e o teto do código", async () => {
    // Contar na memória do processo não serve: com duas cópias do app no ar,
    // cada uma contaria metade e o teto real viraria o dobro.
    const { token } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token));

    await verificarWebhook("qualquer-coisa-que-veio-do-pedido", token);

    expect(fila.webhookTouch).toHaveBeenCalledWith(ENDPOINT, LIMITE_DE_CHAMADAS_POR_MINUTO);
  });

  // ---------------------------------------------------------------------
  // `contar` (rodada de correção 1 da Task 8): a rota de "buscar depois"
  // (.../j/[jobId]) lê o resultado de um trabalho sem gastar o balde de
  // 60 chamadas/minuto do endereço — `window_count` é uma coluna ÚNICA e
  // compartilhada com o POST, então uma leitura que contasse estouraria o
  // MESMO limite que o POST compara.
  // ---------------------------------------------------------------------
  test("contar: false pula webhookTouch — uma leitura não gasta o balde do POST", async () => {
    const { token } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token));

    const resultado = await verificarWebhook(ENDPOINT, token, false);

    expect(resultado.ok).toBe(true);
    expect(fila.webhookTouch).not.toHaveBeenCalled();
  });

  test("contar: false ainda confere token e estado — token errado continua recusado", async () => {
    const bom = gerarTokenDeWebhook().token;
    const ruim = gerarTokenDeWebhook().token;
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(bom));

    expect(await verificarWebhook(ENDPOINT, ruim, false)).toEqual({
      ok: false,
      motivo: "token-invalido",
    });
    expect(fila.webhookTouch).not.toHaveBeenCalled();
  });

  test("contar: false ainda recusa endereço desligado", async () => {
    const { token } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token, { isActive: false }));

    expect(await verificarWebhook(ENDPOINT, token, false)).toEqual({
      ok: false,
      motivo: "desligado",
    });
    expect(fila.webhookTouch).not.toHaveBeenCalled();
  });

  test("⚠️ contar padrão (sem passar o argumento) continua true — o POST não muda", async () => {
    const { token } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token));

    await verificarWebhook(ENDPOINT, token);

    expect(fila.webhookTouch).toHaveBeenCalledWith(ENDPOINT, LIMITE_DE_CHAMADAS_POR_MINUTO);
  });

  test("banco fora do ar na leitura: falha FECHADA, sem estourar", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    fila.webhookEndpointForCheck.mockRejectedValue(new Error("connection refused"));

    expect(await verificarWebhook(ENDPOINT, gerarTokenDeWebhook().token)).toEqual({
      ok: false,
      motivo: "nao-encontrado",
    });
    silencio.mockRestore();
  });

  test("banco fora do ar na contagem: também falha FECHADA", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    const { token } = gerarTokenDeWebhook();
    fila.webhookEndpointForCheck.mockResolvedValue(linhaDoBanco(token));
    fila.webhookTouch.mockRejectedValue(new Error("connection refused"));

    // Deixar passar sem conseguir contar seria abrir a torneira sem medidor.
    expect(await verificarWebhook(ENDPOINT, token)).toEqual({ ok: false, motivo: "limite" });
    silencio.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// De onde o token é lido no pedido
// ---------------------------------------------------------------------------

describe("tokenDoPedido", () => {
  const url = new URL("https://meuapp.com/api/webhooks/abc");

  test("lê do cabeçalho Authorization: Bearer", () => {
    const h = new Headers({ authorization: "Bearer whk_teste" });
    expect(tokenDoPedido(h, url)).toBe("whk_teste");
  });

  test("aceita “bearer” em minúscula e espaço sobrando", () => {
    const h = new Headers({ authorization: "  bearer   whk_teste  " });
    expect(tokenDoPedido(h, url)).toBe("whk_teste");
  });

  test("aceita o cabeçalho x-webhook-token", () => {
    const h = new Headers({ "x-webhook-token": "whk_teste" });
    expect(tokenDoPedido(h, url)).toBe("whk_teste");
  });

  test("aceita ?token= na URL (o caminho fácil pra sistema simples)", () => {
    const comToken = new URL("https://meuapp.com/api/webhooks/abc?token=whk_teste");
    expect(tokenDoPedido(new Headers(), comToken)).toBe("whk_teste");
  });

  test("o cabeçalho ganha da URL", () => {
    const comToken = new URL("https://meuapp.com/api/webhooks/abc?token=whk_da_url");
    const h = new Headers({ authorization: "Bearer whk_do_cabecalho" });
    expect(tokenDoPedido(h, comToken)).toBe("whk_do_cabecalho");
  });

  test("sem token nenhum, devolve texto vazio (e não `undefined`)", () => {
    expect(tokenDoPedido(new Headers(), url)).toBe("");
  });
});

describe("montarUrlDoWebhook", () => {
  test("monta o endereço completo", () => {
    expect(montarUrlDoWebhook("https://meuapp.com", ENDPOINT)).toBe(
      `https://meuapp.com/api/webhooks/${ENDPOINT}`,
    );
  });

  test("barra sobrando no fim não vira barra dupla", () => {
    expect(montarUrlDoWebhook("https://meuapp.com/", ENDPOINT)).toBe(
      `https://meuapp.com/api/webhooks/${ENDPOINT}`,
    );
  });
});
