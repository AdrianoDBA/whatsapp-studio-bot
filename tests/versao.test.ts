/**
 * A VERSÃO DO APP — um número só, em três lugares que precisam concordar.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * O rodapé da barra lateral dizia `v1.0` escrito na mão dentro do componente.
 * Ele nasceu certo e envelheceu sozinho: o template já ia na `v1.0.1` e a tela
 * continuava dizendo `v1.0`, sem nada quebrar. Número em tela que ninguém
 * confere é pior do que não ter número — o aluno lê e acha que está atrasado
 * (ou atualizado) quando não está.
 *
 * Agora o dono é `appConfig.version`, e este teste é quem cobra que o
 * `package.json` diga o mesmo.
 *
 * ⚠️ O TERCEIRO LUGAR É A TAG DO GIT, e ele NÃO dá pra testar aqui: o aluno
 * recebe o tarball de uma tag `vX.Y.Z`, e a tag é cortada DEPOIS deste teste
 * rodar (é o commit que ela aponta). Subiu versão? Os três juntos:
 *
 *     config/app.config.ts  →  package.json  →  git tag -a vX.Y.Z
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appConfig } from "@/config/app.config";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};

describe("a versão do app", () => {
  it("é `MAJOR.MINOR.PATCH` — o mesmo formato da tag entregue", () => {
    // A área de membros valida a tag contra `^v\d+\.\d+\.\d+$` e trata qualquer
    // outra coisa como "ainda não publicamos". Um "1.0" aqui viraria uma tag
    // "v1.0" que ninguém consegue baixar.
    expect(appConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("é a mesma no `config/app.config.ts` e no `package.json`", () => {
    expect(
      pkg.version,
      `package.json diz "${pkg.version}" e appConfig diz "${appConfig.version}"`,
    ).toBe(appConfig.version);
  });

  it("não está escrita na mão em nenhuma tela", () => {
    // Era `<span className="label-mono">v1.0</span>` no rodapé da barra
    // lateral. Quem mostra versão agora lê de `appConfig.version`.
    const sidebar = readFileSync(join(process.cwd(), "components/app/sidebar.tsx"), "utf8");
    expect(sidebar).toContain("appConfig.version");
    expect(sidebar).not.toMatch(/>v\d+\.\d+/);
  });
});
