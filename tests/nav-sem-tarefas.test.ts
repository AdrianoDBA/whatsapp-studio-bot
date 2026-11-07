import { describe, expect, it } from "vitest";
import { navItems } from "@/config/nav.config";

/**
 * A demo de tarefas saiu: ela ensinava a montar CRUD clicando, e neste template
 * quem monta é o Claude Code escrevendo arquivo. Um item de menu sobrevivente
 * viraria 404 na cara do aluno — que é como um link morto sempre aparece.
 */
describe("barra lateral", () => {
  it("não aponta mais para /tarefas", () => {
    expect(navItems.map((i) => i.path)).not.toContain("/tarefas");
  });

  it("continua com as telas que ficaram", () => {
    const paths = navItems.map((i) => i.path);
    for (const esperado of ["/dashboard", "/agentes", "/conhecimento", "/execucoes"]) {
      expect(paths).toContain(esperado);
    }
  });
});
