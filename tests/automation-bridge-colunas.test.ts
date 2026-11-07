/**
 * A GUARDA IRMÃ: toda coluna que a automação lê precisa estar na lista da ponte.
 *
 * `automation-bridge-cobertura.test.ts` já confere as FUNÇÕES. Esta metade
 * nunca existiu — e é o mesmo defeito, do outro lado: pelo painel funciona,
 * pela automação volta `undefined` em silêncio.
 *
 * ⚠️ NOME: o brief desta tarefa (e os documentos de planejamento da onda 7)
 * chamam essa lista de `COLUNAS_POR_TABELA`. No código-fonte ela sempre se
 * chamou `COLUNAS_DA_PONTE` — nunca existiu `COLUNAS_POR_TABELA` na história
 * do arquivo (conferido em `git log --all -p`). Import corrigido pro nome
 * real, já exportado, que também está preso à conferência de tipo
 * `ColunaEsquecida` — duplicar a lista sob outro nome criaria duas fontes de
 * verdade que podem divergir.
 */
import { describe, expect, it } from "vitest";
import { COLUNAS_DA_PONTE } from "@/lib/automation/postgrest-bridge";

const OBRIGATORIAS: Record<string, string[]> = {
  agent_runs: ["modo"],
  schedules: ["modo", "entrega"],
  webhook_endpoints: ["modo", "esperar_resposta"],
  agent_run_steps: ["simulado"],
};

describe("as colunas da onda 7 estão na ponte", () => {
  for (const [tabela, colunas] of Object.entries(OBRIGATORIAS)) {
    for (const coluna of colunas) {
      it(`${tabela}.${coluna}`, () => {
        const lista = COLUNAS_DA_PONTE[tabela as keyof typeof COLUNAS_DA_PONTE];
        expect(lista, `tabela "${tabela}" não está na ponte`).toBeDefined();
        expect([...(lista ?? [])]).toContain(coluna);
      });
    }
  }

  it("cada lista está em ordem alfabética e sem repetido", () => {
    for (const [tabela, lista] of Object.entries(COLUNAS_DA_PONTE)) {
      const arr = [...(lista as readonly string[])];
      expect(new Set(arr).size, `${tabela} tem coluna repetida`).toBe(arr.length);
      expect(arr, `${tabela} fora de ordem`).toEqual([...arr].sort());
    }
  });
});
