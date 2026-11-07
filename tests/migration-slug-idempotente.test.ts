import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A migration é aplicada no boot do container, e o critério de verdade da regra
 * 9 é reaplicar a pilha inteira por cima de um banco que já tem tudo. Sem
 * `if not exists` ela quebra na segunda vez e o deploy trava — sintoma que
 * aparece longe daqui, num container que não sobe.
 */
const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260823000000_slug_em_schedules_e_webhooks.sql"),
  "utf8",
).toLowerCase();

describe("migration do slug", () => {
  /**
   * 🔴 Ancorado no fim da declaração (`text` direto seguido de `;`, sem nada
   * no meio) de propósito: a nulidade É o ponto (ver comentário de abertura
   * da migration). Um `toContain("... slug text")` solto aprovaria também
   * `slug text not null default ''` — exatamente o backfill que o comentário
   * chama de catastrófico, porque entregaria a linha órfã de presente ao
   * primeiro arquivo que sorteasse o mesmo apelido.
   */
  it("acrescenta as duas colunas de forma idempotente, e SEM not null/default", () => {
    expect(SQL).toMatch(/alter table public\.schedules add column if not exists slug text\s*;/);
    expect(SQL).toMatch(
      /alter table public\.webhook_endpoints add column if not exists slug text\s*;/,
    );
  });

  it("cria os índices únicos de forma idempotente", () => {
    expect(SQL).toContain("create unique index if not exists schedules_org_slug_uidx");
    expect(SQL).toContain("create unique index if not exists webhook_endpoints_org_slug_uidx");
  });

  /**
   * 🔴 O `where slug is not null` é o que torna "linha órfã" representável.
   * Sem ele, a coluna nula de TODAS as linhas antigas colidiria no índice único
   * e a migration falharia — e um `not null` com valor inventado entregaria a
   * linha órfã de presente ao primeiro arquivo que sorteasse o mesmo slug.
   */
  it("os índices são PARCIAIS, senão as linhas antigas colidem", () => {
    const parciais = SQL.match(/where slug is not null/g) ?? [];
    expect(parciais.length).toBe(2);
  });

  /**
   * `webhook_endpoints` dá `select`/`update` COLUNA A COLUNA pra quem está
   * logado (20260821010000_automacao_fila.sql + 20260821030000). Sem este
   * `grant`, `slug` nasce gravável (o `insert` é de tabela inteira) mas
   * ILEGÍVEL — qualquer leitura de volta, inclusive pela ponte da automação,
   * falha em runtime com "permission denied for column slug" (42501), num
   * caminho que nenhum outro teste exercita.
   */
  it("libera a leitura de webhook_endpoints.slug (select por coluna)", () => {
    expect(SQL).toContain("grant select (slug) on public.webhook_endpoints to authenticated");
  });

  it("não apaga nem esvazia nada", () => {
    for (const proibido of ["drop table", "drop column", "delete from", "truncate"]) {
      expect(SQL).not.toContain(proibido);
    }
  });
});
