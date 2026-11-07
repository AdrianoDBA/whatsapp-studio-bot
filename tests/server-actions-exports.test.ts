import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function getFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Arquivos com 'use server' exportam apenas funções assíncronas", () => {
  it("nenhum arquivo 'use server' exporta objetos, constantes ou funções síncronas", () => {
    const files = [...getFiles(join(process.cwd(), "lib")), ...getFiles(join(process.cwd(), "app"))];
    const invalidExports: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (content.startsWith('"use server"') || content.startsWith("'use server'")) {
        const lines = content.split("\n");
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("export ")) {
            // Permite 'export async function' e declarações puras de tipo 'export type' / 'export interface'
            const isAsyncFn = /^export\s+async\s+function\s+/.test(trimmed);
            const isTypeOnly = /^export\s+type\s+/.test(trimmed) || /^export\s+interface\s+/.test(trimmed);
            if (!isAsyncFn && !isTypeOnly) {
              invalidExports.push(`${file}:${index + 1} -> ${trimmed}`);
            }
          }
        });
      }
    }

    expect(invalidExports).toEqual([]);
  });
});
