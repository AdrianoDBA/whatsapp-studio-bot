import { beforeEach, describe, expect, it, vi } from "vitest";

const materializar = vi.fn();
vi.mock("@/lib/seed/materializar", () => ({
  materializarWorkspace: (...a: unknown[]) => materializar(...a),
}));
const erros: string[] = [];
vi.mock("@/lib/logger", () => ({ logError: (etapa: string) => erros.push(etapa) }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));
vi.mock("@/lib/auth/guards", () => ({
  requireUser: async () => ({ id: "dono-1" }),
  requireOrgRole: async () => ({ org: { id: "org-1" }, user: { id: "dono-1" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

import { createOrganizationAction } from "@/lib/orgs/actions";

beforeEach(() => {
  materializar.mockReset().mockResolvedValue({
    agentes: 1,
    bases: 0,
    agendamentos: 0,
    webhooks: 0,
    agendamentosPulados: [],
  });
  rpc.mockReset().mockReturnValue({
    single: () => Promise.resolve({ data: { id: "org-1", slug: "meu-time" }, error: null }),
  });
  erros.length = 0;
});

describe("workspace novo já nasce com o produto dentro", () => {
  it("materializa depois da RPC", async () => {
    const r = await createOrganizationAction({ name: "Meu time", slug: "meu-time" });
    expect(r.ok).toBe(true);
    expect(materializar).toHaveBeenCalledOnce();
    // O `id` que vem da RPC, não o slug — é a chave que `materializarWorkspace` usa.
    expect(materializar).toHaveBeenCalledWith(expect.anything(), "org-1", "dono-1");
  });

  /**
   * 🔴 MATERIALIZAR NÃO PODE DERRUBAR A CRIAÇÃO DO WORKSPACE.
   * As declarações moram em TypeScript e a criação é uma RPC do Postgres, então
   * não há transação comum: se a materialização falhar depois do commit, o
   * workspace já existe. Abortar aqui deixaria a pessoa SEM workspace nenhum
   * por causa de um agente — e workspace vazio é reparável com `npm run semear`.
   */
  it("falha de materialização não derruba a criação, mas deixa rastro", async () => {
    materializar.mockRejectedValue(new Error("banco fora do ar"));
    const r = await createOrganizationAction({ name: "Meu time", slug: "meu-time" });
    expect(r.ok).toBe(true);
    expect(erros).toContain("orgs.create.semear");
  });

  it("não materializa quando a RPC falhou", async () => {
    rpc.mockReturnValue({
      single: () => Promise.resolve({ data: null, error: { message: "23505 duplicate" } }),
    });
    const r = await createOrganizationAction({ name: "Meu time", slug: "meu-time" });
    expect(r.ok).toBe(false);
    expect(materializar).not.toHaveBeenCalled();
  });

  /**
   * Agendamento pulado não é erro de materialização — as outras três tabelas
   * nasceram normalmente. É uma automação que outra pessoa já assumiu
   * (`run_as` diferente do dono). O campo não pode ser descartado calado.
   */
  it("registra quando materializarWorkspace devolve agendamentos pulados", async () => {
    materializar.mockResolvedValue({
      agentes: 1,
      bases: 0,
      agendamentos: 0,
      webhooks: 0,
      agendamentosPulados: ["relatorio-semanal"],
    });
    const r = await createOrganizationAction({ name: "Meu time", slug: "meu-time" });
    expect(r.ok).toBe(true);
    expect(erros).toContain("orgs.create.semear.pulados");
  });
});
