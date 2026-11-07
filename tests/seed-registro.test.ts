import { describe, expect, it } from "vitest";
import { blueprintToInsert } from "@/lib/agents/blueprint";
import { agendamentoParaInsert, webhookParaInsert } from "@/lib/automation/blueprint";
import { baseParaInsert } from "@/lib/knowledge/blueprint";
import { AGENDAMENTOS, AGENTES, BASES, WEBHOOKS } from "@/lib/seed/registro";

/**
 * O registro é a lista única do que existe em código. Ele é lido pelo
 * materializador, e um item inválido aqui só apareceria na hora de criar um
 * workspace — longe daqui, como "não deu pra criar o workspace".
 * Validar no `npm run verify` transforma isso em erro com endereço.
 */
describe("registro de declarações", () => {
  it("todo agente declarado é válido", () => {
    for (const bp of AGENTES) {
      expect(() => blueprintToInsert(bp, "org-1", "user-1"), bp.slug).not.toThrow();
    }
  });

  /**
   * ⚠️ `BASES` nasce vazia por design (`lib/seed/registro.ts`, até este
   * produto declarar a primeira base). Um `for` sobre lista vazia nunca roda
   * o `expect` de dentro — este teste passa por VACUIDADE enquanto isso. A
   * cobertura de verdade de `baseParaInsert` está em
   * `tests/knowledge-blueprint.test.ts`, com fixtures concretas. Este teste
   * volta a validar algo real assim que `BASES` ganhar o primeiro item.
   */
  it("toda base declarada é válida", () => {
    for (const bp of BASES) {
      expect(() => baseParaInsert(bp, "org-1", "user-1"), bp.slug).not.toThrow();
    }
  });

  /**
   * ⚠️ Mesma vacuidade do teste de `BASES`, acima: `AGENDAMENTOS` nasce vazio
   * por design, então este `for` não roda nenhum `expect` hoje. Cobertura de
   * verdade de `agendamentoParaInsert` está em
   * `tests/automation-blueprint.test.ts`.
   */
  it("todo agendamento declarado é válido", () => {
    for (const bp of AGENDAMENTOS) {
      expect(() => agendamentoParaInsert(bp, "org-1", "a-1", "u-1"), bp.slug).not.toThrow();
    }
  });

  /**
   * ⚠️ Mesma vacuidade: `WEBHOOKS` nasce vazio por design. Cobertura de
   * verdade de `webhookParaInsert` está em `tests/automation-blueprint.test.ts`.
   */
  it("todo webhook declarado é válido", () => {
    for (const bp of WEBHOOKS) {
      expect(() => webhookParaInsert(bp, "org-1", "a-1", "u-1"), bp.slug).not.toThrow();
    }
  });

  /**
   * Apelido repetido não daria erro de compilação: daria um `upsert` sobrescrevendo
   * o outro, e o aluno veria uma das duas declarações simplesmente não existir.
   */
  it.each([
    ["agentes", () => AGENTES.map((b) => b.slug)],
    ["bases", () => BASES.map((b) => b.slug)],
    ["agendamentos", () => AGENDAMENTOS.map((b) => b.slug)],
    ["webhooks", () => WEBHOOKS.map((b) => b.slug)],
  ])("não tem apelido repetido em %s", (_nome, pegar) => {
    const slugs = pegar();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  /**
   * Automação aponta pra agente por APELIDO, e o apelido é resolvido só na
   * materialização. Um apelido errado viraria "workspace criado sem a
   * automação", sem erro nenhum na tela.
   */
  it("toda automação aponta pra um agente que existe no registro", () => {
    const conhecidos = new Set(AGENTES.map((a) => a.slug));
    for (const bp of [...AGENDAMENTOS, ...WEBHOOKS]) {
      expect(conhecidos, `"${bp.slug}" aponta pro agente "${bp.agentSlug}"`).toContain(
        bp.agentSlug,
      );
    }
  });
});

/**
 * 🔴 Sem painel de publicação, `draft` deixaria todo agente invisível pra
 * sempre — o arquivo é o ato deliberado.
 */
describe("agente nasce publicado", () => {
  it("blueprintToInsert marca active, não draft", () => {
    const bp = AGENTES[0];
    expect(bp, "o registro precisa ter ao menos um agente de exemplo").toBeDefined();
    expect(blueprintToInsert(bp!, "org-1", "user-1").status).toBe("active");
  });
});
