import { describe, expect, test } from "vitest";
import { DESTINO_PADRAO, safeNext } from "@/lib/auth/safe-next";

const ORIGEM = "https://meusaas.com.br";

describe("safeNext", () => {
  test("aceita caminho interno simples", () => {
    expect(safeNext("/app/minha-org/dashboard", ORIGEM)).toBe("/app/minha-org/dashboard");
  });

  test("preserva query string (o token do convite mora nela)", () => {
    expect(safeNext("/aceitar-convite?token=abc123", ORIGEM)).toBe("/aceitar-convite?token=abc123");
  });

  test.each([
    ["vazio", null],
    ["indefinido", undefined],
    ["endereço externo", "https://site-falso.com"],
    ["barra dupla vira endereço externo", "//site-falso.com"],
    ["barra invertida também", String.raw`/\site-falso.com`],
    ["sem barra no começo", "site-falso.com"],
    ["javascript", "javascript:alert(1)"],
  ])("recusa %s", (_nome, entrada) => {
    expect(safeNext(entrada, ORIGEM)).toBe(DESTINO_PADRAO);
  });

  test("recusa caminho que aponta pra outra origem depois de resolvido", () => {
    expect(safeNext("/\t//site-falso.com", ORIGEM)).toBe(DESTINO_PADRAO);
  });
});
