#!/usr/bin/env node
/**
 * Regenera `types/supabase.ts` a partir das tabelas do seu banco.
 *
 * POR QUE ISSO É UM SCRIPT E NÃO UM COMANDO DIRETO
 * ------------------------------------------------
 * Antes isso era uma linha só no package.json usando `>` pra gravar o arquivo.
 * O problema: o `>` ESVAZIA o arquivo antes do comando rodar. Se o comando
 * falhasse por qualquer motivo (internet, senha, Windows), você ficava com o
 * `types/supabase.ts` destruído e o projeto inteiro parava de compilar — sem
 * nenhuma pista do que aconteceu.
 *
 * Agora: só grava se a saída for válida de verdade, e grava de uma vez só
 * (num arquivo temporário que substitui o antigo no final). Deu erro? O
 * arquivo que já estava lá continua intacto.
 *
 * COMO USAR
 *   npm run types          → lê do seu projeto no Supabase (nuvem)
 *   npm run types:local    → lê do Supabase rodando na sua máquina
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = join(RAIZ, "types", "supabase.ts");
const TEMPORARIO = `${DESTINO}.tmp`;

const usarLocal = process.argv.includes("--local");

function erroFatal(msg) {
  console.error(`\n[tipos] ERRO: ${msg}\n`);
  console.error("        types/supabase.ts NÃO foi alterado.\n");
  process.exit(1);
}

/** O npm não carrega o .env.local sozinho. */
function carregarEnvLocal() {
  const caminho = join(RAIZ, ".env.local");
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, chave, valor] = m;
    if (!process.env[chave]) process.env[chave] = valor.replace(/^["']|["']$/g, "");
  }
}

/**
 * Descobre o identificador do projeto no Supabase.
 * Tenta a variável direta; se não achar, tira do próprio endereço do projeto
 * (https://ABCDEFG.supabase.co → ABCDEFG), pra você não precisar preencher
 * mais uma variável.
 */
function descobrirProjectId() {
  const direto = process.env.SUPABASE_PROJECT_ID;
  if (direto?.trim()) return direto.trim();

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url) {
    const m = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/i);
    if (m) return m[1];
  }
  return null;
}

function rodarSupabaseCli(args) {
  // Chamamos o JavaScript da ferramenta direto pelo Node. Chamar via `npx` dá
  // erro no Windows por causa de uma proteção do próprio Node.
  let cli;
  try {
    cli = require.resolve("supabase/bin/supabase");
  } catch {
    try {
      cli = require.resolve("supabase/dist/supabase.js");
    } catch {
      erroFatal(
        "a ferramenta do Supabase não está instalada.\n" +
          "        Rode: npm install --save-dev supabase",
      );
    }
  }

  return execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd: RAIZ,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function main() {
  carregarEnvLocal();

  const args = ["gen", "types", "typescript", "--schema", "public"];

  if (usarLocal) {
    args.push("--local");
  } else {
    const projectId = descobrirProjectId();
    if (!projectId) {
      erroFatal(
        "não consegui descobrir qual é o seu projeto no Supabase.\n\n" +
          "        Preencha SUPABASE_URL no .env.local (ou SUPABASE_PROJECT_ID).\n" +
          "        Se quiser ler do banco da sua máquina, use: npm run types:local",
      );
    }
    args.push("--project-id", projectId);
  }

  let saida;
  try {
    saida = rodarSupabaseCli(args);
  } catch (err) {
    const detalhe = String(err.stderr ?? err.message ?? "").trim();
    console.error(`\n${detalhe}\n`);
    if (/not logged in|access token|Unauthorized/i.test(detalhe)) {
      erroFatal(
        "você ainda não conectou sua conta do Supabase nesta máquina.\n" +
          "        Rode: npx supabase login",
      );
    }
    erroFatal("a ferramenta do Supabase falhou (mensagem acima).");
  }

  // Só aceita se veio TypeScript de verdade.
  if (!saida.includes("export type Database")) {
    erroFatal(
      "a resposta não parece um arquivo de tipos válido — provavelmente foi uma\n" +
        "        mensagem de erro. Nada foi gravado.",
    );
  }

  // Grava num temporário e só então substitui: se você apertar Ctrl+C no meio,
  // o arquivo bom continua lá.
  writeFileSync(TEMPORARIO, saida, "utf8");
  renameSync(TEMPORARIO, DESTINO);
  console.log(`[tipos] types/supabase.ts atualizado (${saida.split("\n").length} linhas).`);
}

main();
