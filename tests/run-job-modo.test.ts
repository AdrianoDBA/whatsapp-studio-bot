/**
 * QUE `modo` chega ao `runAgent`, pra cada `sourceKind` — e o outro lado do
 * contrato da entrega: falha de entrega NÃO vira falha de execução.
 *
 * ⚠️ ESTE TESTE EXISTE PORQUE A ROLINDA 1 DE REVISÃO DA TASK 6 TINHA UMA
 * REGRESSÃO QUE SÓ UM TESTE COMO ESTE PEGARIA: a primeira versão de
 * `run-job.ts` só lia `modo` de `schedules`, então todo trabalho de WEBHOOK
 * caía em `"ensaio"` pra sempre — a coluna `webhook_endpoints.modo` ficava
 * inerte, e ninguém descobria sem ler o código (o trabalho terminava `done`,
 * sem `last_error`). Ver o passo 6b de `lib/automation/run-job.ts` pro
 * porquê da correção (ler `webhook_endpoints` pela mesma sessão impersonada,
 * sem migration nova).
 *
 * O motor (`runAgent`) é mockado: este teste é sobre a LÓGICA de
 * `run-job.ts` (qual `modo` ele decide passar), não sobre o motor em si —
 * isso já é coberto em `tests/acoes-*.test.ts`. A entrega (`entrega.ts` +
 * `acoes.ts`) roda DE VERDADE, só com `resolveEmailSender` mockado (a única
 * borda de rede/cofre que ela toca).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModoDeExecucao } from "@/lib/agents/acoes";
import type { AutomationSource, JobParaRodar } from "@/lib/automation/types";
import type { Database } from "@/types/supabase";

const {
  runAgentMock,
  createImpersonatedClientMock,
  loadJobForRunMock,
  markJobStartedMock,
  orgBudgetStatusMock,
  automationBudgetLeftMock,
  finishJobBestEffortMock,
  reportScheduleResultMock,
  resolveEmailSenderMock,
  getAppUrlMock,
} = vi.hoisted(() => ({
  runAgentMock: vi.fn(),
  createImpersonatedClientMock: vi.fn(),
  loadJobForRunMock: vi.fn(),
  markJobStartedMock: vi.fn(),
  orgBudgetStatusMock: vi.fn(),
  automationBudgetLeftMock: vi.fn(),
  finishJobBestEffortMock: vi.fn(),
  reportScheduleResultMock: vi.fn(),
  resolveEmailSenderMock: vi.fn(),
  getAppUrlMock: vi.fn(async () => "https://app.exemplo.com"),
}));

vi.mock("@/lib/agents/engine", () => ({ runAgent: runAgentMock }));
vi.mock("@/lib/automation/impersonate", () => ({
  createImpersonatedClient: createImpersonatedClientMock,
}));
vi.mock("@/lib/automation/queue", () => ({
  loadJobForRun: loadJobForRunMock,
  markJobStarted: markJobStartedMock,
  orgBudgetStatus: orgBudgetStatusMock,
  automationBudgetLeft: automationBudgetLeftMock,
  finishJobBestEffort: finishJobBestEffortMock,
  reportScheduleResult: reportScheduleResultMock,
}));
vi.mock("@/lib/secrets", () => ({ resolveEmailSender: resolveEmailSenderMock }));
vi.mock("@/lib/app-url", () => ({ getAppUrl: getAppUrlMock }));

// Não usados nestes testes (nenhum job aqui é `ingest_document`) — mockados
// vazios só pra não puxar dependência sem necessidade.
vi.mock("@/lib/knowledge/ingest", () => ({ processarDocumento: vi.fn() }));

const { executarTrabalho, AVISO_DE_ENTREGA_QUE_FALHOU } = await import("@/lib/automation/run-job");
const { MENSAGEM_EMAIL_NAO_CONFIGURADO } = await import("@/lib/agents/acoes");

type LinhaFalsa = { data: unknown; error: { message: string } | null };

/** Um `SupabaseClient` de mentira: só `.from(t).select().eq().maybeSingle()`. */
function supabaseFalso(linhas: Record<string, LinhaFalsa>): SupabaseClient<Database> {
  const consulta = (tabela: string) => {
    const resultado: LinhaFalsa = linhas[tabela] ?? { data: null, error: null };
    const encadeavel = {
      select: () => encadeavel,
      eq: () => encadeavel,
      maybeSingle: async () => resultado,
    };
    return encadeavel;
  };
  return { from: consulta } as unknown as SupabaseClient<Database>;
}

const AGENTE_FALSO = { id: "agent-1", organization_id: "org-1", name: "Agente Teste" };
const WORKSPACE_FALSO = { id: "org-1", slug: "acme", name: "Acme" };

const RESULTADO_OK_PADRAO = {
  ok: true as const,
  data: {
    runId: "run-1",
    status: "succeeded" as const,
    output: "resultado do agente",
    tokensInput: 10,
    tokensOutput: 20,
    costMicros: 0,
    stepCount: 1,
    toolsUsed: [] as string[],
    warnings: [] as string[],
  },
};

function jobFalso(over: Partial<JobParaRodar>): JobParaRodar {
  return {
    id: "job-1",
    organizationId: "org-1",
    kind: "run_agent",
    agentId: "agent-1",
    input: {},
    runAs: "user-1",
    sourceKind: "manual",
    sourceId: null,
    attempts: 1,
    maxAttempts: 3,
    lockedBy: "worker-1",
    ...over,
  };
}

function prepararMocks(job: JobParaRodar, linhasExtra: Record<string, LinhaFalsa> = {}) {
  loadJobForRunMock.mockResolvedValue(job);
  markJobStartedMock.mockResolvedValue(true);
  orgBudgetStatusMock.mockResolvedValue(null);
  automationBudgetLeftMock.mockResolvedValue(1000);
  reportScheduleResultMock.mockResolvedValue(undefined);
  finishJobBestEffortMock.mockResolvedValue(undefined);
  resolveEmailSenderMock.mockResolvedValue(null);
  runAgentMock.mockResolvedValue(RESULTADO_OK_PADRAO);

  const linhas: Record<string, LinhaFalsa> = {
    agents: { data: AGENTE_FALSO, error: null },
    organizations: { data: WORKSPACE_FALSO, error: null },
    ...linhasExtra,
  };

  createImpersonatedClientMock.mockResolvedValue({
    ok: true,
    sessao: {
      supabase: supabaseFalso(linhas),
      userId: "user-1",
      organizationId: "org-1",
      role: "member",
      recursoNaoSuportado: () => null,
      close: async () => {},
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// 1. Qual `modo` chega ao `runAgent`, pra cada `sourceKind`
// ===========================================================================

describe("o modo que run-job.ts passa pro runAgent", () => {
  const casos: Array<{
    nome: string;
    sourceKind: AutomationSource;
    sourceId: string | null;
    linhas: Record<string, LinhaFalsa>;
    modoEsperado: ModoDeExecucao;
  }> = [
    {
      nome: "schedule em modo real",
      sourceKind: "schedule",
      sourceId: "sched-1",
      linhas: {
        schedules: {
          data: { name: "Resumo", modo: "real", entrega: { tipo: "nenhuma" } },
          error: null,
        },
      },
      modoEsperado: "real",
    },
    {
      nome: "schedule em modo ensaio",
      sourceKind: "schedule",
      sourceId: "sched-1",
      linhas: {
        schedules: {
          data: { name: "Resumo", modo: "ensaio", entrega: { tipo: "nenhuma" } },
          error: null,
        },
      },
      modoEsperado: "ensaio",
    },
    {
      // A REGRESSÃO da rodada 1: sem a leitura de `webhook_endpoints`, este
      // caso caía em "ensaio" mesmo com a coluna dizendo "real".
      nome: "webhook em modo real",
      sourceKind: "webhook",
      sourceId: "wh-1",
      linhas: { webhook_endpoints: { data: { modo: "real" }, error: null } },
      modoEsperado: "real",
    },
    {
      nome: "webhook em modo ensaio",
      sourceKind: "webhook",
      sourceId: "wh-1",
      linhas: { webhook_endpoints: { data: { modo: "ensaio" }, error: null } },
      modoEsperado: "ensaio",
    },
    {
      nome: "manual (sem linha nenhuma pra ler) cai em ensaio, nunca em real",
      sourceKind: "manual",
      sourceId: null,
      linhas: {},
      modoEsperado: "ensaio",
    },
  ];

  for (const caso of casos) {
    it(caso.nome, async () => {
      const job = jobFalso({ sourceKind: caso.sourceKind, sourceId: caso.sourceId });
      prepararMocks(job, caso.linhas);

      const resultado = await executarTrabalho(job.id, "worker-1");

      expect(resultado.ok).toBe(true);
      expect(runAgentMock).toHaveBeenCalledTimes(1);
      const paramsPassados = runAgentMock.mock.calls[0]?.[0] as { modo?: ModoDeExecucao };
      expect(paramsPassados.modo).toBe(caso.modoEsperado);
    });
  }
});

// ===========================================================================
// 2. Falha de entrega NÃO transforma a execução em `failed`
// ===========================================================================

describe("a entrega, depois que o agente terminou", () => {
  it("falha de entrega mantém o trabalho `done`, com o erro em jobs.last_error", async () => {
    const job = jobFalso({ sourceKind: "schedule", sourceId: "sched-1" });
    prepararMocks(job, {
      schedules: {
        data: {
          name: "Resumo de segunda",
          modo: "real",
          entrega: { tipo: "email", para: ["a@b.com"] },
        },
        error: null,
      },
    });
    // Sem chave do Resend cadastrada: `enviarEmail` falha de forma
    // determinística, sem precisar simular rede.
    resolveEmailSenderMock.mockResolvedValue(null);

    const resultado = await executarTrabalho(job.id, "worker-1");

    // O agente fez o trabalho dele — a execução continua um sucesso.
    expect(resultado).toEqual({ ok: true, runId: "run-1", status: "succeeded" });

    // ⚠️ A PRIMEIRA FRASE É A LEIGA. `jobs.last_error` vai CRU pra tela de
    // Automações: sem ela, o aluno leria só o motivo técnico e não teria como
    // saber que o trabalho deu certo e que o resultado está guardado.
    expect(finishJobBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.id,
        status: "done",
        error: `${AVISO_DE_ENTREGA_QUE_FALHOU} ${MENSAGEM_EMAIL_NAO_CONFIGURADO}`,
        runId: "run-1",
      }),
    );

    const gravado = finishJobBestEffortMock.mock.calls[0]?.[0] as { error: string };
    expect(gravado.error.startsWith(AVISO_DE_ENTREGA_QUE_FALHOU)).toBe(true);
    // O detalhe técnico continua depois — é ele que ajuda a consertar.
    expect(gravado.error).toContain(MENSAGEM_EMAIL_NAO_CONFIGURADO);
  });

  it("entrega 'nenhuma' não chama email nenhum, e o trabalho fecha sem erro", async () => {
    const job = jobFalso({ sourceKind: "schedule", sourceId: "sched-1" });
    prepararMocks(job, {
      schedules: {
        data: { name: "Resumo", modo: "real", entrega: { tipo: "nenhuma" } },
        error: null,
      },
    });

    const resultado = await executarTrabalho(job.id, "worker-1");

    expect(resultado).toEqual({ ok: true, runId: "run-1", status: "succeeded" });
    expect(resolveEmailSenderMock).not.toHaveBeenCalled();
    expect(finishJobBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id, status: "done", error: null, runId: "run-1" }),
    );
  });
});
