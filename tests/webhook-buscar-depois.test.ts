/**
 * A ROTA DE "BUSCAR DEPOIS": `app/api/webhooks/[endpointId]/j/[jobId]/route.ts`.
 *
 * Endereço novo, alcançável de fora, com um contrato de segurança que não
 * pode regredir em silêncio numa refatoração futura:
 *
 *  - as recusas ANTERIORES ao token (endereço inexistente e token errado)
 *    colapsam no MESMO 403 genérico;
 *  - "desligado" e "limite" (que só existem DEPOIS do token provado) NÃO
 *    colapsam — cada uma tem a resposta certa (403 específico / 429), a
 *    mesma leitura da rota irmã;
 *  - a leitura NÃO conta contra o balde de chamadas por minuto do endereço
 *    (rodada de correção 1 da Task 8 — ver `verificarWebhook(..., false)`);
 *  - "cancelled" é tratado como falha, não como "ainda rodando".
 *
 * Mocka `@/lib/automation/webhooks` e `@/lib/automation/queue` — a mesma
 * ideia de `tests/automation-webhook-token.test.ts`, aplicada à ROTA em vez
 * da função de conferência.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const webhooks = vi.hoisted(() => ({
  tokenDoPedido: vi.fn(),
  verificarWebhook: vi.fn(),
}));
vi.mock("@/lib/automation/webhooks", () => webhooks);

const queue = vi.hoisted(() => ({
  buscarResultadoDoTrabalho: vi.fn(),
}));
vi.mock("@/lib/automation/queue", () => queue);

import { GET } from "@/app/api/webhooks/[endpointId]/j/[jobId]/route";

const ENDPOINT = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB = "bbbbbbbb-2222-4222-8222-222222222222";
const ORG = "cccccccc-3333-4333-8333-333333333333";
const AGENTE = "dddddddd-4444-4444-8444-444444444444";

function chamar(endpointId = ENDPOINT, jobId = JOB, token = "whk_qualquer") {
  const req = new Request(`https://meuapp.com/api/webhooks/${endpointId}/j/${jobId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return GET(req, { params: Promise.resolve({ endpointId, jobId }) });
}

function verificacaoOk(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    endpointId: ENDPOINT,
    organizationId: ORG,
    agentId: AGENTE,
    runAs: null,
    modo: "real",
    esperarResposta: true,
    ...extra,
  };
}

beforeEach(() => {
  webhooks.tokenDoPedido.mockReset().mockImplementation((h: Headers) => {
    const auth = h.get("authorization") ?? "";
    return /^bearer\s+(.+)$/i.exec(auth.trim())?.[1] ?? "";
  });
  webhooks.verificarWebhook.mockReset();
  queue.buscarResultadoDoTrabalho.mockReset();
});

describe("o que é anterior ao token: sempre o mesmo 403 genérico", () => {
  test("id malformado (nem chega a olhar o banco)", async () => {
    const resp = await chamar("nao-e-um-uuid", JOB);
    expect(resp.status).toBe(403);
    expect(await resp.json()).toEqual({ ok: false, error: "Token inválido pra esse endereço." });
    expect(webhooks.verificarWebhook).not.toHaveBeenCalled();
  });

  test("token errado", async () => {
    webhooks.verificarWebhook.mockResolvedValue({ ok: false, motivo: "token-invalido" });
    const resp = await chamar();
    expect(resp.status).toBe(403);
    expect(await resp.json()).toEqual({ ok: false, error: "Token inválido pra esse endereço." });
  });

  test("endereço que não existe dá a mesma resposta de token errado", async () => {
    webhooks.verificarWebhook.mockResolvedValue({ ok: false, motivo: "nao-encontrado" });
    const resp = await chamar();
    expect(resp.status).toBe(403);
    expect(await resp.json()).toEqual({ ok: false, error: "Token inválido pra esse endereço." });
  });
});

describe("o que é depois do token: revela igual a rota irma", () => {
  test("desligado: 403 com a frase especifica (diferente da generica de token)", async () => {
    webhooks.verificarWebhook.mockResolvedValue({ ok: false, motivo: "desligado" });
    const resp = await chamar();
    expect(resp.status).toBe(403);
    const corpo = (await resp.json()) as { ok: boolean; error: string };
    expect(corpo.ok).toBe(false);
    expect(corpo.error).not.toBe("Token inválido pra esse endereço.");
    expect(corpo.error).toMatch(/desligado/);
  });

  test("limite: 429 com Retry-After, nunca o 403 de token errado", async () => {
    webhooks.verificarWebhook.mockResolvedValue({ ok: false, motivo: "limite" });
    const resp = await chamar();
    expect(resp.status).toBe(429);
    expect(resp.headers.get("retry-after")).toBe("60");
    expect(await resp.json()).toEqual({
      ok: false,
      error: "Muitas chamadas em pouco tempo nesse endereço. Espere um minuto.",
      code: "limite_de_chamadas",
    });
  });
});

describe("a leitura nao gasta o balde de chamadas por minuto", () => {
  test("verificarWebhook e chamado com contar=false", async () => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk());
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status: "running",
      lastError: null,
      runId: null,
      output: null,
      costMicros: null,
      runStatus: null,
      runModo: null,
    });

    await chamar();

    expect(webhooks.verificarWebhook).toHaveBeenCalledWith(ENDPOINT, "whk_qualquer", false);
  });

  test("consulta repetida nao derruba o cliente por limite (e o que motivou o conserto)", async () => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk());
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status: "running",
      lastError: null,
      runId: null,
      output: null,
      costMicros: null,
      runStatus: null,
      runModo: null,
    });

    // Simula um cliente fazendo polling: várias chamadas seguidas continuam
    // 202, nunca viram 403/429 só por terem se repetido.
    for (let i = 0; i < 5; i++) {
      const resp = await chamar();
      expect(resp.status).toBe(202);
    }
  });
});

describe("o resultado do trabalho, depois do token", () => {
  test("trabalho de outro endereço (ou inexistente): 404 sem detalhe de schema", async () => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk());
    queue.buscarResultadoDoTrabalho.mockResolvedValue(null);

    const resp = await chamar();

    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ ok: false, error: "Esse trabalho não foi encontrado." });
  });

  test.each(["pending", "running"] as const)("%s: 202 com status running", async (status) => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk());
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status,
      lastError: null,
      runId: null,
      output: null,
      costMicros: null,
      runStatus: null,
      runModo: null,
    });

    const resp = await chamar();

    expect(resp.status).toBe(202);
    expect(await resp.json()).toEqual({ status: "running" });
  });

  test("done: 200 com a resposta, o custo e o distintivo de ensaio", async () => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk({ modo: "ensaio" }));
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status: "done",
      lastError: null,
      runId: "eeeeeeee-5555-4555-8555-555555555555",
      output: "a resposta do agente",
      costMicros: 1_500_000,
      runStatus: "succeeded",
      runModo: "ensaio",
    });

    const resp = await chamar();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({
      ok: true,
      resposta: "a resposta do agente",
      custoMicros: 1_500_000,
      ensaio: true,
    });
  });

  /**
   * ⚠️ O CAMPO `ensaio` VEM DA EXECUÇÃO, NÃO DO ENDEREÇO.
   *
   * Aqui a distância entre o disparo e a leitura é a maior de todas: quem
   * busca depois volta minutos mais tarde. Enquanto a resposta lia
   * `webhook_endpoints.modo` (o estado ATUAL do endereço, que vem junto com o
   * token), bastava alguém virar a chavinha na tela de Automações nesse
   * intervalo pra ela afirmar "nenhum email saiu" numa rodada em que saiu.
   */
  test("⚠️ ligar o modo real depois do disparo NÃO reescreve a rodada", async () => {
    // O endereço já está em "real" AGORA…
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk({ modo: "real" }));
    // …mas a execução que rodou foi um ensaio.
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status: "done",
      lastError: null,
      runId: "eeeeeeee-5555-4555-8555-555555555555",
      output: "a resposta do agente",
      costMicros: 1_500_000,
      runStatus: "succeeded",
      runModo: "ensaio",
    });

    const corpo = (await (await chamar()).json()) as { ensaio: boolean };
    expect(corpo.ensaio).toBe(true);
  });

  test("⚠️ e o contrário: endereço em ensaio, rodada real, o email saiu mesmo", async () => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk({ modo: "ensaio" }));
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status: "done",
      lastError: null,
      runId: "eeeeeeee-5555-4555-8555-555555555555",
      output: "a resposta do agente",
      costMicros: 1_500_000,
      runStatus: "succeeded",
      runModo: "real",
    });

    const corpo = (await (await chamar()).json()) as { ensaio: boolean };
    expect(corpo.ensaio).toBe(false);
  });

  test("execução que nem abriu (runModo nulo) não promete que nada saiu", async () => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk({ modo: "ensaio" }));
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status: "done",
      lastError: null,
      runId: null,
      output: "a resposta do agente",
      costMicros: null,
      runStatus: null,
      runModo: null,
    });

    const corpo = (await (await chamar()).json()) as { ensaio: boolean };
    expect(corpo.ensaio).toBe(false);
  });

  test("failed: 200 (a chamada teve sucesso) com o erro do trabalhador", async () => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk());
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status: "failed",
      lastError: "a ferramenta X não respondeu",
      runId: null,
      output: null,
      costMicros: null,
      runStatus: "failed",
      runModo: "real",
    });

    const resp = await chamar();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: false, error: "a ferramenta X não respondeu" });
  });

  test("cancelled e falha, nao ainda rodando - sem last_error, a frase e a padrao", async () => {
    webhooks.verificarWebhook.mockResolvedValue(verificacaoOk());
    queue.buscarResultadoDoTrabalho.mockResolvedValue({
      status: "cancelled",
      lastError: null,
      runId: null,
      output: null,
      costMicros: null,
      runStatus: "cancelled",
      runModo: "real",
    });

    const resp = await chamar();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({
      ok: false,
      error: "O agente não conseguiu terminar essa execução.",
    });
  });
});
