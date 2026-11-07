/**
 * `semearWorkspaces` — a lógica por trás de `npm run semear`.
 *
 * Cobre exatamente as decisões que o coordenador pediu pra confirmar antes de
 * implementar: zero ou dois+ donos nunca adivinha (pula e registra), a sessão
 * nunca carrega `jobId` (não é trabalho da fila), e a conexão impersonada
 * sempre fecha — inclusive quando a materialização falha no meio.
 *
 * ⚠️ RODADA DE CONSERTO 1 (I2): `ownerMembershipsForSeed` devolve `userId:
 * null` pra workspace sem dono (é o que o `left join` da função do banco
 * garante) — nunca omite a linha. O teste "acha o órfão no meio da varredura
 * completa" existe porque a versão anterior só pulava-e-registrava quando
 * `organizationId` vinha explícito: na varredura (o modo do deploy), um
 * workspace órfão simplesmente não aparecia em lugar nenhum.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";

const {
  ownerMembershipsForSeedMock,
  createImpersonatedClientMock,
  materializarWorkspaceMock,
  logErrorMock,
} = vi.hoisted(() => ({
  ownerMembershipsForSeedMock: vi.fn(),
  createImpersonatedClientMock: vi.fn(),
  materializarWorkspaceMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock("@/lib/automation/queue", () => ({
  ownerMembershipsForSeed: ownerMembershipsForSeedMock,
}));
vi.mock("@/lib/automation/impersonate", () => ({
  createImpersonatedClient: createImpersonatedClientMock,
}));
vi.mock("@/lib/seed/materializar", () => ({
  materializarWorkspace: materializarWorkspaceMock,
}));
vi.mock("@/lib/logger", () => ({ logError: logErrorMock }));

const { semearWorkspaces } = await import("@/lib/seed/semear");

const FAKE_DB = {} as unknown as SupabaseClient<Database>;

function sessaoOk(close = vi.fn().mockResolvedValue(undefined)) {
  return { ok: true as const, sessao: { supabase: FAKE_DB, close } };
}

beforeEach(() => {
  ownerMembershipsForSeedMock.mockReset();
  createImpersonatedClientMock.mockReset();
  materializarWorkspaceMock.mockReset();
  logErrorMock.mockReset();
});

describe("semearWorkspaces", () => {
  it("materializa um workspace com exatamente um dono", async () => {
    ownerMembershipsForSeedMock.mockResolvedValue([{ organizationId: "org-1", userId: "dono-1" }]);
    const close = vi.fn().mockResolvedValue(undefined);
    createImpersonatedClientMock.mockResolvedValue(sessaoOk(close));
    materializarWorkspaceMock.mockResolvedValue({
      agentes: 1,
      bases: 1,
      agendamentos: 2,
      webhooks: 0,
      agendamentosPulados: [],
    });

    const r = await semearWorkspaces();

    expect(createImpersonatedClientMock).toHaveBeenCalledWith({
      userId: "dono-1",
      organizationId: "org-1",
    });
    // Sem `jobId` — não é trabalho da fila.
    expect(createImpersonatedClientMock.mock.calls[0]![0]).not.toHaveProperty("jobId");
    expect(materializarWorkspaceMock).toHaveBeenCalledWith(FAKE_DB, "org-1", "dono-1");
    expect(close).toHaveBeenCalledOnce();
    expect(r).toEqual({
      workspaces: 1,
      agentes: 1,
      bases: 1,
      agendamentos: 2,
      webhooks: 0,
      agendamentosPulados: [],
      workspacesPulados: [],
    });
  });

  it("soma os totais de múltiplos workspaces", async () => {
    ownerMembershipsForSeedMock.mockResolvedValue([
      { organizationId: "org-1", userId: "dono-1" },
      { organizationId: "org-2", userId: "dono-2" },
    ]);
    createImpersonatedClientMock.mockResolvedValue(sessaoOk());
    materializarWorkspaceMock
      .mockResolvedValueOnce({
        agentes: 1,
        bases: 0,
        agendamentos: 0,
        webhooks: 1,
        agendamentosPulados: [],
      })
      .mockResolvedValueOnce({
        agentes: 2,
        bases: 1,
        agendamentos: 0,
        webhooks: 0,
        agendamentosPulados: ["x"],
      });

    const r = await semearWorkspaces();

    expect(r.workspaces).toBe(2);
    expect(r.agentes).toBe(3);
    expect(r.bases).toBe(1);
    expect(r.webhooks).toBe(1);
    expect(r.agendamentosPulados).toEqual(["x"]);
  });

  it("pula workspace sem dono nenhum (organizationId explícito), sem tentar impersonar", async () => {
    ownerMembershipsForSeedMock.mockResolvedValue([{ organizationId: "org-orfa", userId: null }]);

    const r = await semearWorkspaces("org-orfa");

    expect(createImpersonatedClientMock).not.toHaveBeenCalled();
    expect(materializarWorkspaceMock).not.toHaveBeenCalled();
    expect(r.workspacesPulados).toEqual([
      { organizationId: "org-orfa", motivo: { tipo: "sem-dono" } },
    ]);
    expect(r.workspaces).toBe(0);
  });

  /**
   * I2: o mesmo caso acima, mas na VARREDURA COMPLETA (sem `organizationId`
   * — o modo que o deploy usa), com um workspace de dono normal no meio.
   * Antes do conserto, o órfão simplesmente não aparecia — nem pulado, nem
   * logado, nem contado. `ownerMembershipsForSeed` aqui já reflete o
   * `left join`: toda linha existe, e a órfã vem com `userId: null`.
   */
  it("acha o workspace órfão no meio de uma varredura completa, sem organizationId", async () => {
    ownerMembershipsForSeedMock.mockResolvedValue([
      { organizationId: "org-orfa", userId: null },
      { organizationId: "org-1", userId: "dono-1" },
    ]);
    createImpersonatedClientMock.mockResolvedValue(sessaoOk());
    materializarWorkspaceMock.mockResolvedValue({
      agentes: 1,
      bases: 0,
      agendamentos: 0,
      webhooks: 0,
      agendamentosPulados: [],
    });

    const r = await semearWorkspaces();

    expect(r.workspacesPulados).toEqual([
      { organizationId: "org-orfa", motivo: { tipo: "sem-dono" } },
    ]);
    expect(r.workspaces).toBe(1);
    expect(r.agentes).toBe(1);
    // Nunca tenta impersonar o órfão.
    expect(createImpersonatedClientMock).toHaveBeenCalledTimes(1);
    expect(createImpersonatedClientMock).toHaveBeenCalledWith({
      userId: "dono-1",
      organizationId: "org-1",
    });
  });

  it("pula workspace com dois donos, sem escolher nenhum", async () => {
    ownerMembershipsForSeedMock.mockResolvedValue([
      { organizationId: "org-1", userId: "dono-a" },
      { organizationId: "org-1", userId: "dono-b" },
    ]);

    const r = await semearWorkspaces();

    expect(createImpersonatedClientMock).not.toHaveBeenCalled();
    expect(r.workspacesPulados).toEqual([
      { organizationId: "org-1", motivo: { tipo: "dono-ambiguo" } },
    ]);
  });

  it("pula e registra quando a impersonação falha (ex.: dono saiu do workspace)", async () => {
    ownerMembershipsForSeedMock.mockResolvedValue([{ organizationId: "org-1", userId: "dono-1" }]);
    createImpersonatedClientMock.mockResolvedValue({ ok: false, error: "saiu do time" });

    const r = await semearWorkspaces();

    expect(materializarWorkspaceMock).not.toHaveBeenCalled();
    expect(r.workspacesPulados).toEqual([
      {
        organizationId: "org-1",
        motivo: { tipo: "impersonacao-falhou", mensagem: "saiu do time" },
      },
    ]);
  });

  /**
   * A conexão impersonada MORRE mesmo quando a materialização explode no
   * meio — é a regra R3 da ponte (`postgrest-bridge.ts`): estado de sessão
   * nunca sobrevive além do trabalho.
   */
  it("fecha a sessão mesmo quando materializarWorkspace lança, e registra o workspace como pulado", async () => {
    ownerMembershipsForSeedMock.mockResolvedValue([{ organizationId: "org-1", userId: "dono-1" }]);
    const close = vi.fn().mockResolvedValue(undefined);
    createImpersonatedClientMock.mockResolvedValue(sessaoOk(close));
    materializarWorkspaceMock.mockRejectedValue(new Error("banco fora do ar"));

    const r = await semearWorkspaces();

    expect(close).toHaveBeenCalledOnce();
    expect(logErrorMock).toHaveBeenCalledWith("seed.semear", expect.any(Error));
    expect(r.workspacesPulados).toEqual([
      { organizationId: "org-1", motivo: { tipo: "erro-ao-materializar" } },
    ]);
    expect(r.workspaces).toBe(0);
  });

  it("repassa o organizationId pedido pra ownerMembershipsForSeed", async () => {
    ownerMembershipsForSeedMock.mockResolvedValue([{ organizationId: "org-1", userId: "dono-1" }]);
    createImpersonatedClientMock.mockResolvedValue(sessaoOk());
    materializarWorkspaceMock.mockResolvedValue({
      agentes: 0,
      bases: 0,
      agendamentos: 0,
      webhooks: 0,
      agendamentosPulados: [],
    });

    await semearWorkspaces("org-1");

    expect(ownerMembershipsForSeedMock).toHaveBeenCalledWith("org-1");
  });
});
