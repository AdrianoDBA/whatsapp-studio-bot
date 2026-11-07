#!/usr/bin/env node

/**
 * Assistente Interativo de Configuração - AtendeAI
 * Feito para facilitar para usuários não-técnicos: só responder e usar!
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import { execSync } from "node:child_process";

const ENV_PATH = join(process.cwd(), ".env.local");
const EXAMPLE_PATH = join(process.cwd(), ".env.example");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

console.log("\n========================================================");
console.log("   🚀 ATENDEAI — ASSISTENTE DE CONFIGURAÇÃO FÁCIL");
console.log("========================================================\n");

async function main() {
  let envContent = "";
  if (existsSync(ENV_PATH)) {
    envContent = readFileSync(ENV_PATH, "utf8");
  } else if (existsSync(EXAMPLE_PATH)) {
    envContent = readFileSync(EXAMPLE_PATH, "utf8");
  }

  // 1. Chave de criptografia
  let encryptionKey = "";
  const matchKey = envContent.match(/^ENCRYPTION_KEY=(.*)$/m);
  if (matchKey && matchKey[1].trim() !== "") {
    encryptionKey = matchKey[1].trim();
  } else {
    encryptionKey = randomBytes(32).toString("base64");
    console.log("🔑 Chave de criptografia do cofre gerada automaticamente!");
  }

  // 2. Extrair valores existentes de Supabase
  let supabaseUrl = "";
  let supabaseAnonKey = "";
  let databaseUrl = "";

  const matchUrl = envContent.match(/^SUPABASE_URL=(.*)$/m);
  if (matchUrl && !matchUrl[1].includes("SEU-PROJETO")) {
    supabaseUrl = matchUrl[1].trim();
  }

  const matchAnon = envContent.match(/^SUPABASE_ANON_KEY=(.*)$/m);
  if (matchAnon && matchAnon[1].trim() !== "") {
    supabaseAnonKey = matchAnon[1].trim();
  }

  const matchDb = envContent.match(/^DATABASE_URL=(.*)$/m);
  if (matchDb && !matchDb[1].includes("SUA-SENHA")) {
    databaseUrl = matchDb[1].trim();
  }

  if (supabaseUrl && supabaseAnonKey && databaseUrl) {
    console.log("✅ Seu banco de dados e credenciais do Supabase já estão configurados!\n");
    console.log(`• Supabase URL: ${supabaseUrl}`);
    console.log("• Chave Anon:   [configurada]");
    console.log("• Database URL: [configurada]\n");
    
    const recriar = await ask("Deseja alterar as credenciais atuais? (s/N): ");
    if (recriar.toLowerCase() !== "s") {
      finalizar(supabaseUrl, supabaseAnonKey, databaseUrl, encryptionKey);
      return;
    }
  }

  console.log("Para conectar seu banco de dados Supabase (grátis):");
  console.log("Acesse: https://supabase.com (Crie uma conta gratuita em 1 minuto caso ainda não tenha)\n");

  const inputUrl = await ask(`1. Project URL (ex: https://abcdef.supabase.co) [${supabaseUrl || "em branco"}]: `);
  if (inputUrl.trim()) supabaseUrl = inputUrl.trim();

  const inputAnon = await ask(`2. Chave Anon Public [${supabaseAnonKey ? "mantida" : "em branco"}]: `);
  if (inputAnon.trim()) supabaseAnonKey = inputAnon.trim();

  const inputDb = await ask(`3. Database Connection URI (postgresql://...) [${databaseUrl ? "mantida" : "em branco"}]: `);
  if (inputDb.trim()) databaseUrl = inputDb.trim();

  finalizar(supabaseUrl, supabaseAnonKey, databaseUrl, encryptionKey);
}

async function finalizar(url, anon, db, encKey) {
  const novoEnv = `# Configuração do AtendeAI
SUPABASE_URL=${url}
SUPABASE_ANON_KEY=${anon}
DATABASE_URL=${db}
ENCRYPTION_KEY=${encKey}
WHATSAPP_GATEWAY_URL=http://127.0.0.1:5006
`;

  writeFileSync(ENV_PATH, novoEnv, "utf8");
  console.log("\n💾 Arquivo .env.local salvo com sucesso!");

  if (db && !db.includes("SUA-SENHA")) {
    const rodarMigrate = await ask("\nDeseja aplicar as tabelas e banco de dados agora automaticamente? (S/n): ");
    if (rodarMigrate.toLowerCase() !== "n") {
      console.log("\n📦 Aplicando tabelas e migrações no PostgreSQL...");
      try {
        execSync("npm run migrate", { stdio: "inherit" });
        console.log("✅ Banco de dados preparado com sucesso!");
      } catch (e) {
        console.error("⚠️ Não foi possível aplicar as migrações automaticamente. Verifique a senha do seu DATABASE_URL.");
      }
    }
  }

  console.log("\n========================================================");
  console.log("🎉 TUDO PRONTO PARA USAR!");
  console.log("Para iniciar o sistema completo agora, execute:");
  console.log("   ./iniciar.sh");
  console.log("========================================================\n");

  rl.close();
}

main().catch((err) => {
  console.error("Erro na configuração:", err);
  rl.close();
});
