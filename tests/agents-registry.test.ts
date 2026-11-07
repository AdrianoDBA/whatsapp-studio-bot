/**
 * O registro de ferramentas e o `defineTool`.
 *
 * O que estes testes protegem, na prática:
 *   • nome de ferramenta que o provedor recusaria (acento, espaço, maiúscula)
 *     não chega em produção — quebra no `npm run verify`;
 *   • duas ferramentas com o mesmo nome não fazem uma sumir em silêncio;
 *   • entrada fora do formato vira `{ erro: … }` em português, nunca exceção;
 *   • o molde `_TEMPLATE_ferramenta.ts` não entra no registro por engano.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineTool,
  falhaDeFerramenta,
  isToolFailure,
  TOOL_ID_PATTERN,
} from "@/lib/agents/define-tool";
import type { ToolContext } from "@/lib/agents/tool-context";
import { getTool, getToolCatalog, resolveTools, TOOL_REGISTRY } from "@/lib/agents/tools";

/** Um contexto de mentira, só pra `run` ter o que receber. */
const ctxFalso = { role: "member" } as unknown as ToolContext;

describe("TOOL_REGISTRY", () => {
  it("tem pelo menos a ferramenta de exemplo", () => {
    expect(TOOL_REGISTRY.map((f) => f.id)).toContain("buscar-na-base");
  });

  it("não tem nome repetido", () => {
    const ids = TOOL_REGISTRY.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo nome está no formato que Anthropic e OpenAI aceitam", () => {
    for (const f of TOOL_REGISTRY) {
      expect(TOOL_ID_PATTERN.test(f.id), `id inválido: ${f.id}`).toBe(true);
      // Nome com acento passa no regex se o acento vier como caractere
      // combinante. Esta linha pega esse caso.
      expect(f.id).toBe(f.id.normalize("NFD").replace(/[̀-ͯ]/g, ""));
    }
  });

  it("toda ferramenta tem rótulo e descrição de verdade (é o que o modelo lê)", () => {
    for (const f of TOOL_REGISTRY) {
      expect(f.label.trim().length).toBeGreaterThan(0);
      expect(f.description.trim().length).toBeGreaterThanOrEqual(10);
    }
  });

  it("o molde NÃO está registrado — ele é pra copiar, não pra usar", () => {
    expect(TOOL_REGISTRY.map((f) => f.id)).not.toContain("minha-ferramenta");
  });

  it("getTool acha pelo nome e devolve undefined pro que não existe", () => {
    expect(getTool("buscar-na-base")?.label).toBe("Buscar na base de conhecimento");
    expect(getTool("nao-existe")).toBeUndefined();
  });

  it("getToolCatalog é síncrono e devolve a ficha que a tela precisa", () => {
    const catalogo = getToolCatalog();
    expect(catalogo).toHaveLength(TOOL_REGISTRY.length);
    expect(Object.keys(catalogo[0] ?? {}).sort()).toEqual([
      "description",
      "id",
      "label",
      "requiresRole",
    ]);
  });

  it("resolveTools separa o que existe do que não existe e ignora repetido", () => {
    const r = resolveTools(["buscar-na-base", "buscar-na-base", "ferramenta-apagada"]);
    expect(r.found.map((f) => f.id)).toEqual(["buscar-na-base"]);
    expect(r.unknownIds).toEqual(["ferramenta-apagada"]);
  });
});

describe("defineTool — o que ele recusa no carregamento do módulo", () => {
  const base = {
    label: "Teste",
    description: "Uma descrição comprida o bastante pra passar.",
    inputSchema: z.object({}),
    execute: async () => ({ ok: true }),
  };

  it("recusa nome com acento, espaço ou maiúscula", () => {
    expect(() => defineTool({ ...base, id: "ferramentá-ruim" })).toThrow(/formato/);
    expect(() => defineTool({ ...base, id: "ferramenta ruim" })).toThrow(/formato/);
    expect(() => defineTool({ ...base, id: "FerramentaRuim" })).toThrow(/formato/);
    expect(() => defineTool({ ...base, id: "-comeca-com-hifen" })).toThrow(/formato/);
  });

  it("recusa nome curto demais e longo demais", () => {
    expect(() => defineTool({ ...base, id: "a" })).toThrow(/curto/);
    expect(() => defineTool({ ...base, id: `a${"b".repeat(60)}` })).toThrow(/longo/);
  });

  it("recusa descrição vazia ou curta — é ela que o modelo lê", () => {
    expect(() => defineTool({ ...base, id: "ok-assim", description: "curta" })).toThrow(/curta/);
  });

  it("aceita um nome bem formado", () => {
    const f = defineTool({ ...base, id: "ferramenta-boa-2" });
    expect(f.id).toBe("ferramenta-boa-2");
    expect(f.requiresRole).toBeNull();
  });
});

describe("defineTool — o run", () => {
  const somar = defineTool({
    id: "somar-numeros",
    label: "Somar números",
    description: "Soma dois números inteiros e devolve o total.",
    inputSchema: z.object({
      a: z.number().int(),
      b: z.number().int(),
    }),
    async execute(input) {
      return { total: input.a + input.b };
    },
  });

  it("valida a entrada ANTES de chamar o código do autor", async () => {
    const r = await somar.run({ a: "dois", b: 3 }, ctxFalso);
    expect(isToolFailure(r)).toBe(true);
    expect(isToolFailure(r) ? r.erro : "").toContain("Somar números");
  });

  it("com entrada certa, chama o autor e devolve o resultado", async () => {
    expect(await somar.run({ a: 2, b: 3 }, ctxFalso)).toEqual({ total: 5 });
  });

  it("recusa por papel antes de rodar qualquer coisa", async () => {
    let rodou = false;
    const soDono = defineTool({
      id: "so-dono",
      label: "Só dono",
      description: "Ferramenta de teste que só o dono do workspace pode usar.",
      inputSchema: z.object({}),
      requiresRole: ["owner"],
      async execute() {
        rodou = true;
        return { ok: true };
      },
    });

    const r = await soDono.run({}, ctxFalso);
    expect(isToolFailure(r)).toBe(true);
    expect(rodou).toBe(false);
  });
});

describe("isToolFailure / falhaDeFerramenta", () => {
  it("reconhece a falha e não confunde com um resultado normal", () => {
    expect(isToolFailure(falhaDeFerramenta("deu ruim"))).toBe(true);
    expect(isToolFailure({ total: 5 })).toBe(false);
    expect(isToolFailure({ erro: 42 })).toBe(false);
    expect(isToolFailure(null)).toBe(false);
    expect(isToolFailure("erro")).toBe(false);
  });
});
