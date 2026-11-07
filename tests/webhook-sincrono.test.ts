// tests/webhook-sincrono.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `queue.ts` fala com o banco por `systemPool()` (`lib/automation/pg.ts`).
 * Mockar só o `pg` (e não `queue.ts` inteiro) deixa a gente testar a
 * DECISÃO real de `esperarResultadoDoTrabalho`/`buscarResultadoDoTrabalho` —
 * o mapeamento de `status` pra `ResultadoDoTrabalho`, incluindo `cancelled`
 * — sem precisar de um banco de verdade.
 */
const pg = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/automation/pg", () => ({
  systemPool: () => pg,
  impersonatedPool: () => pg,
  closeAutomationPools: vi.fn(),
}));

import {
  buscarResultadoDoTrabalho,
  esperarResultadoDoTrabalho,
  PRAZO_DO_WEBHOOK_MS,
} from "@/lib/automation/queue";

const ENDPOINT = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB = "bbbbbbbb-2222-4222-8222-222222222222";

function linhaCrua(extra: Record<string, unknown> = {}) {
  return {
    status: "done",
    last_error: null,
    run_id: "cccccccc-3333-4333-8333-333333333333",
    output: "a resposta do agente",
    cost_micros: "1500000",
    run_status: "succeeded",
    // De `agent_runs.modo`, NUNCA de `webhook_endpoints.modo` — ver o bloco
    // "o modo vem da execução" lá embaixo.
    run_modo: "real",
    ...extra,
  };
}

beforeEach(() => {
  pg.query.mockReset();
});

describe("o prazo do webhook síncrono", () => {
  it("fica abaixo do corte da camada de cima, com margem", () => {
    // Ver o passo 1 desta tarefa: o número de cima precisa estar confirmado.
    expect(PRAZO_DO_WEBHOOK_MS).toBeLessThan(60_000);
    expect(PRAZO_DO_WEBHOOK_MS).toBeGreaterThanOrEqual(30_000);
  });
});

describe("buscarResultadoDoTrabalho", () => {
  it("traduz a linha do banco, convertendo cost_micros (bigint→string) pra number", async () => {
    pg.query.mockResolvedValueOnce({ rows: [linhaCrua()] });

    const linha = await buscarResultadoDoTrabalho(ENDPOINT, JOB);

    expect(linha).toEqual({
      status: "done",
      lastError: null,
      runId: "cccccccc-3333-4333-8333-333333333333",
      output: "a resposta do agente",
      costMicros: 1_500_000,
      runStatus: "succeeded",
      runModo: "real",
    });
  });

  it("nenhuma linha (jobId de outro endereço, ou inexistente): null", async () => {
    pg.query.mockResolvedValueOnce({ rows: [] });
    expect(await buscarResultadoDoTrabalho(ENDPOINT, JOB)).toBeNull();
  });

  it("cost_micros nulo (execução ainda sem custo gravado) vira null, não 0", async () => {
    pg.query.mockResolvedValueOnce({
      rows: [linhaCrua({ status: "running", output: null, cost_micros: null })],
    });
    const linha = await buscarResultadoDoTrabalho(ENDPOINT, JOB);
    expect(linha?.costMicros).toBeNull();
  });
});

describe("esperarResultadoDoTrabalho: o mapeamento de status", () => {
  it("done: concluído, com a resposta e o custo", async () => {
    pg.query.mockResolvedValueOnce({ rows: [linhaCrua()] });

    const fim = await esperarResultadoDoTrabalho({
      endpointId: ENDPOINT,
      jobId: JOB,
      prazoMs: PRAZO_DO_WEBHOOK_MS,
    });

    expect(fim).toEqual({
      tipo: "concluido",
      output: "a resposta do agente",
      costMicros: 1_500_000,
      ensaio: false,
    });
    // Terminou na primeira volta: não ficou perguntando de novo.
    expect(pg.query).toHaveBeenCalledTimes(1);
  });

  it("failed com last_error: falhou, com a frase do trabalhador", async () => {
    pg.query.mockResolvedValueOnce({
      rows: [linhaCrua({ status: "failed", last_error: "a ferramenta X não respondeu" })],
    });

    const fim = await esperarResultadoDoTrabalho({
      endpointId: ENDPOINT,
      jobId: JOB,
      prazoMs: PRAZO_DO_WEBHOOK_MS,
    });

    expect(fim).toEqual({ tipo: "falhou", erro: "a ferramenta X não respondeu" });
  });

  it("⚠️ cancelled também é falha (não fica esperando pra sempre um trabalho cancelado)", async () => {
    pg.query.mockResolvedValueOnce({
      rows: [linhaCrua({ status: "cancelled", last_error: null, output: null })],
    });

    const fim = await esperarResultadoDoTrabalho({
      endpointId: ENDPOINT,
      jobId: JOB,
      prazoMs: PRAZO_DO_WEBHOOK_MS,
    });

    // Sem last_error, a frase é a padrão — nunca undefined/vazio.
    expect(fim).toEqual({
      tipo: "falhou",
      erro: "O agente não conseguiu terminar essa execução.",
    });
  });

  it("pending/running: continua perguntando até o prazo estourar", async () => {
    // Sempre "running": nunca sai do laço por conta própria.
    pg.query.mockResolvedValue({ rows: [linhaCrua({ status: "running", output: null })] });

    const fim = await esperarResultadoDoTrabalho({
      endpointId: ENDPOINT,
      jobId: JOB,
      // Prazo minúsculo: a checagem de tempo estoura antes do próximo sono de
      // 500 ms, então o teste não fica 500 ms+ esperando de verdade.
      prazoMs: 1,
    });

    expect(fim).toEqual({ tipo: "prazo" });
  });

  it("nenhuma linha (ainda não visível pro banco): trata como pendente, não como falha", async () => {
    pg.query.mockResolvedValue({ rows: [] });

    const fim = await esperarResultadoDoTrabalho({
      endpointId: ENDPOINT,
      jobId: JOB,
      prazoMs: 1,
    });

    expect(fim).toEqual({ tipo: "prazo" });
  });

  it("⚠️ quem chamou desistiu (signal abortado): para na hora, sem gastar outra consulta", async () => {
    const controle = new AbortController();
    controle.abort();

    const fim = await esperarResultadoDoTrabalho({
      endpointId: ENDPOINT,
      jobId: JOB,
      prazoMs: PRAZO_DO_WEBHOOK_MS,
      signal: controle.signal,
    });

    expect(fim).toEqual({ tipo: "prazo" });
    expect(pg.query).not.toHaveBeenCalled();
  });
});

/**
 * ⚠️ O MODO VEM DA EXECUÇÃO, NÃO DA CONFIGURAÇÃO DO ENDEREÇO.
 *
 * `webhook_endpoints.modo` é CONFIGURAÇÃO: alguém vira a chavinha na tela de
 * Automações e ele muda. `agent_runs.modo` é REGISTRO, e é imutável
 * (`freeze_agent_run_keys`). Enquanto a resposta lia o primeiro, bastava
 * alguém ligar o modo real entre o disparo e a leitura pra ela afirmar
 * `ensaio: true` numa rodada em que o email SAIU.
 */
describe("o modo vem da execução (agent_runs.modo)", () => {
  it("run_modo = 'ensaio' vira ensaio: true", async () => {
    pg.query.mockResolvedValueOnce({ rows: [linhaCrua({ run_modo: "ensaio" })] });

    const fim = await esperarResultadoDoTrabalho({
      endpointId: ENDPOINT,
      jobId: JOB,
      prazoMs: PRAZO_DO_WEBHOOK_MS,
    });

    expect(fim).toEqual({
      tipo: "concluido",
      output: "a resposta do agente",
      costMicros: 1_500_000,
      ensaio: true,
    });
  });

  it("nulo (trabalho que nem abriu execução) NÃO promete que nada saiu", async () => {
    pg.query.mockResolvedValueOnce({ rows: [linhaCrua({ run_modo: null })] });

    const linha = await buscarResultadoDoTrabalho(ENDPOINT, JOB);
    expect(linha?.runModo).toBeNull();

    pg.query.mockResolvedValueOnce({ rows: [linhaCrua({ run_modo: null })] });
    const fim = await esperarResultadoDoTrabalho({
      endpointId: ENDPOINT,
      jobId: JOB,
      prazoMs: PRAZO_DO_WEBHOOK_MS,
    });
    if (fim.tipo !== "concluido") throw new Error("devia ter concluído");
    expect(fim.ensaio).toBe(false);
  });

  it("texto torto cai em 'real' — o silêncio, nunca a promessa", async () => {
    pg.query.mockResolvedValueOnce({ rows: [linhaCrua({ run_modo: "ENSAIO " })] });
    const linha = await buscarResultadoDoTrabalho(ENDPOINT, JOB);
    expect(linha?.runModo).toBe("real");
  });
});
