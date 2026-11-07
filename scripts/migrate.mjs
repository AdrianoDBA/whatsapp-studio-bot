#!/usr/bin/env node
/**
 * Aplica as tabelas do banco automaticamente.
 *
 * O QUE ISSO FAZ
 * --------------
 * Olha a pasta `supabase/migrations/`, vê quais arquivos .sql ainda não foram
 * aplicados no seu banco, e aplica só os que faltam, na ordem. Já aplicado ele
 * pula. É por isso que você não precisa copiar e colar SQL em lugar nenhum.
 *
 * Roda em dois momentos:
 *  - quando você digita `npm run migrate` na sua máquina;
 *  - sozinho, toda vez que o container liga em produção.
 *
 * ONDE ELE GUARDA O CONTROLE
 * --------------------------
 * Na mesma tabela que a ferramenta oficial do Supabase usa
 * (`supabase_migrations.schema_migrations`). Assim, se um dia você usar
 * `supabase db push`, os dois se entendem e nada é aplicado duas vezes.
 *
 * POR QUE USA A BIBLIOTECA `pg` E NÃO O COMANDO `psql`
 * ----------------------------------------------------
 * Porque `psql` é um programa separado que quase ninguém tem instalado no
 * Windows. Com a biblioteca, funciona em qualquer máquina que tenha Node — que
 * você já precisa ter pra rodar o projeto.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PASTA_MIGRATIONS = join(RAIZ, "supabase", "migrations");

/** Só arquivos no formato <timestamp>_nome.sql. Ignora o _TEMPLATE_...example. */
const PADRAO_MIGRATION = /^(\d{14})_(.+)\.sql$/;

const TENTATIVAS_CONEXAO = 10;
const ESPERA_ENTRE_TENTATIVAS_MS = 3000;

function log(msg) {
  console.log(`[banco] ${msg}`);
}

function erroFatal(msg) {
  console.error(`\n[banco] ERRO: ${msg}\n`);
  process.exit(1);
}

/** Lê a variável de ambiente, aceitando os dois nomes possíveis. */
function urlDoBanco() {
  for (const nome of ["DATABASE_URL", "SUPABASE_DB_URL"]) {
    const v = process.env[nome];
    if (v && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Quando você roda na sua máquina, o Node não carrega o .env.local sozinho. */
function lerArquivoEnvLocal() {
  const caminho = join(RAIZ, ".env.local");
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, chave, valorCru] = m;
    if (process.env[chave]) continue;
    process.env[chave] = valorCru.replace(/^["']|["']$/g, "");
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Erros que significam "não consegui confiar no certificado do banco". */
const ERRO_DE_CERTIFICADO = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * Descobre POR QUE a conexão falhou, quando o motivo pode ser o certificado.
 *
 * A biblioteca `pg` não repassa o erro de certificado: ela devolve só
 * "Connection terminated unexpectedly", que não ajuda ninguém. Então, quando a
 * conexão falha desse jeito, refazemos só o aperto de mão de segurança aqui,
 * na mão, pra saber se o problema é o certificado.
 *
 * IMPORTANTE: esta função NUNCA envia usuário ou senha. Ela conversa o mínimo
 * necessário pra ver o certificado e desliga. É por isso que dá pra
 * diagnosticar sem risco.
 */
async function diagnosticarCertificado(host, port, ca) {
  const net = await import("node:net");
  const tls = await import("node:tls");

  return new Promise((resolve) => {
    const encerrar = (resultado) => {
      try {
        socket.destroy();
      } catch {}
      resolve(resultado);
    };

    const socket = net.connect({ host, port });
    const prazo = setTimeout(() => encerrar(null), 10_000);

    socket.on("error", () => {
      clearTimeout(prazo);
      encerrar(null);
    });

    socket.on("connect", () => {
      // Pedido de conexão segura do protocolo do Postgres: 8 bytes, sendo o
      // código mágico 80877103. Ainda não é login — é só "vamos criptografar?".
      const pedido = Buffer.alloc(8);
      pedido.writeInt32BE(8, 0);
      pedido.writeInt32BE(80877103, 4);
      socket.write(pedido);
    });

    socket.once("data", (resposta) => {
      // 'S' = o servidor aceita criptografar. Qualquer outra coisa: não é
      // problema de certificado.
      if (resposta.toString("utf8", 0, 1) !== "S") {
        clearTimeout(prazo);
        return encerrar(null);
      }

      const seguro = tls.connect({
        socket,
        servername: host,
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
      });
      seguro.on("secureConnect", () => {
        clearTimeout(prazo);
        // Certificado está OK — o problema era outro.
        try {
          seguro.destroy();
        } catch {}
        encerrar(null);
      });
      seguro.on("error", (err) => {
        clearTimeout(prazo);
        try {
          seguro.destroy();
        } catch {}
        encerrar(ERRO_DE_CERTIFICADO.has(err.code) ? err : null);
      });
    });
  });
}

/** Tira host e porta do endereço do banco, pro diagnóstico acima. */
function hostEPorta(dbUrl) {
  try {
    const u = new URL(dbUrl);
    return { host: u.hostname, port: Number(u.port) || 5432 };
  } catch {
    return null;
  }
}

/**
 * Como nos conectamos ao banco.
 *
 * Banco na sua máquina (127.0.0.1): sem criptografia, é tudo local mesmo.
 * Banco na internet: criptografado E com o certificado conferido de verdade.
 *
 * ⚠️ POR QUE NÃO EXISTE "TENTAR SEM CONFERIR" AUTOMÁTICO
 * O DATABASE_URL tem a SENHA do seu banco dentro. Se o programa aceitasse
 * qualquer certificado quando a conferência falha, bastaria alguém se colocar
 * no meio do caminho (numa rede pública, num provedor comprometido) e
 * apresentar um certificado falso pra receber essa senha de bandeja — e a
 * falha da conferência é justamente o sinal de que isso pode estar
 * acontecendo. Então aqui: falhou a conferência, para.
 *
 * Se você tem um Supabase próprio, instalado no seu servidor, com certificado
 * gerado por você, o caminho certo é adicionar o certificado da SUA autoridade
 * ao Node (variável NODE_EXTRA_CA_CERTS apontando pro arquivo .crt), não
 * desligar a conferência.
 */
function ehBancoLocal(dbUrl) {
  return /@(127\.0\.0\.1|localhost|host\.docker\.internal)[:/]/.test(dbUrl);
}

/**
 * O Supabase assina os certificados dos bancos dele com uma autoridade própria,
 * que o Node não conhece de fábrica. Por isso o certificado dela vem junto no
 * projeto — assim a conferência é COMPLETA, sem precisar desligar nada.
 * Ver supabase/certs/README.md.
 */
const CAMINHO_CA_SUPABASE = join(RAIZ, "supabase", "certs", "supabase-root-2021-ca.crt");

function caDoSupabase(dbUrl) {
  const ehSupabase = /@[^/]*\.(supabase\.(co|com|in)|pooler\.supabase\.com)[:/]/.test(dbUrl);
  if (!ehSupabase || !existsSync(CAMINHO_CA_SUPABASE)) return undefined;
  return readFileSync(CAMINHO_CA_SUPABASE, "utf8");
}

function opcoesDeConexao(dbUrl) {
  const ehLocal = ehBancoLocal(dbUrl);
  const ca = caDoSupabase(dbUrl);
  return {
    connectionString: dbUrl,
    // Banco na sua máquina: sem criptografia, é tudo local mesmo.
    // Banco na internet: criptografado E com o certificado conferido de verdade.
    ssl: ehLocal ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    connectionTimeoutMillis: 15_000,
    // Migration pode demorar (índice em tabela grande). 10 min é folgado.
    statement_timeout: 600_000,
  };
}

async function tentarConectar(dbUrl) {
  const client = new pg.Client(opcoesDeConexao(dbUrl));
  try {
    await client.connect();
    return { client };
  } catch (err) {
    await client.end().catch(() => {});
    return { erro: err };
  }
}

async function conectarComRetentativa(dbUrl) {
  let ultimoErro;
  const ehLocal = ehBancoLocal(dbUrl);

  for (let tentativa = 1; tentativa <= TENTATIVAS_CONEXAO; tentativa++) {
    const { client, erro } = await tentarConectar(dbUrl);
    if (client) return client;

    // Certificado não confiável: para na hora. Insistir não resolve, e seguir
    // adiante entregaria a senha do banco pra quem estiver no meio do caminho.
    const endereco = ehLocal ? null : hostEPorta(dbUrl);
    const erroDeCertificado = endereco
      ? await diagnosticarCertificado(endereco.host, endereco.port, caDoSupabase(dbUrl))
      : null;

    if (erroDeCertificado) {
      console.error(`\n${erroDeCertificado.message}\n`);
      erroFatal(
        [
          "não consegui confirmar que estou falando com o banco certo.",
          "",
          "  A conexão é criptografada, mas o certificado apresentado não pôde",
          "  ser conferido — e o endereço do banco carrega a SENHA dele. Seguir",
          "  em frente poderia entregar essa senha pra outra pessoa, então paramos.",
          "",
          "  O que fazer:",
          "  1. Confira se o DATABASE_URL está exatamente como no painel do",
          "     Supabase (Settings → Database → Connection string → URI).",
          "  2. Se estiver, veja se o projeto ainda existe no painel do Supabase.",
          "  3. Se o banco é seu, instalado no seu servidor com certificado",
          "     próprio, aponte NODE_EXTRA_CA_CERTS pro arquivo .crt da sua",
          "     autoridade — não desligue a conferência.",
        ].join("\n"),
      );
    }

    ultimoErro = erro;
    if (tentativa < TENTATIVAS_CONEXAO) {
      log(`banco ainda não respondeu (tentativa ${tentativa}/${TENTATIVAS_CONEXAO})...`);
      await esperar(ESPERA_ENTRE_TENTATIVAS_MS);
    }
  }

  const detalhe = String(ultimoErro?.message ?? ultimoErro);
  console.error(`\n${detalhe}\n`);

  if (/password authentication failed/i.test(detalhe)) {
    erroFatal(
      [
        "a senha do banco está errada.",
        "",
        "  No DATABASE_URL, o trecho entre `postgres:` e `@` é a senha.",
        "  Se você esqueceu, dá pra criar outra em: supabase.com → seu projeto",
        "  → Settings → Database → Reset database password.",
      ].join("\n"),
    );
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detalhe)) {
    erroFatal(
      [
        "não encontrei o endereço do banco.",
        "",
        "  Confira se você copiou o DATABASE_URL inteiro, sem cortar nada.",
        "  supabase.com → seu projeto → Settings → Database → Connection string → URI.",
      ].join("\n"),
    );
  }
  erroFatal(
    [
      "não consegui conectar no banco.",
      "",
      "  Confira a variável DATABASE_URL nas configurações do seu app.",
      "  Pra pegar o valor certo: supabase.com → seu projeto → Settings →",
      "  Database → Connection string → aba URI. Copie inteiro e troque",
      "  [YOUR-PASSWORD] pela senha do banco que você criou.",
    ].join("\n"),
  );
}

async function garantirTabelaDeControle(client) {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);
}

async function versoesJaAplicadas(client) {
  const { rows } = await client.query(
    "select version from supabase_migrations.schema_migrations",
  );
  return new Set(rows.map((r) => String(r.version)));
}

function migrationsNoDisco() {
  if (!existsSync(PASTA_MIGRATIONS)) return [];
  return readdirSync(PASTA_MIGRATIONS)
    .map((arquivo) => {
      const m = arquivo.match(PADRAO_MIGRATION);
      return m ? { arquivo, versao: m[1], nome: m[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.versao.localeCompare(b.versao));
}

async function aplicar(client, migration) {
  const sql = readFileSync(join(PASTA_MIGRATIONS, migration.arquivo), "utf8");

  // Uma transação por arquivo: se der erro no meio, nada daquele arquivo fica
  // aplicado pela metade.
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name)
       values ($1, $2) on conflict (version) do nothing`,
      [migration.versao, migration.nome],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    const detalhe = [err?.message, err?.detail, err?.hint].filter(Boolean).join("\n  ");
    console.error(`\n  ${detalhe}\n`);
    erroFatal(
      [
        `falhei ao aplicar ${migration.arquivo}.`,
        "",
        "  O banco NÃO ficou pela metade — esse arquivo foi desfeito inteiro.",
        "  Copie a mensagem acima e mande pro Claude Code pedindo pra corrigir.",
      ].join("\n"),
    );
  }
}

async function main() {
  lerArquivoEnvLocal();

  const dbUrl = urlDoBanco();
  if (!dbUrl) {
    log(
      [
        "DATABASE_URL não está preenchida — pulando a criação das tabelas.",
        "        O app vai subir, mas qualquer tela que use o banco vai dar erro.",
        "        Preencha DATABASE_URL nas configurações do app pra resolver.",
      ].join("\n"),
    );
    return;
  }

  const migrations = migrationsNoDisco();
  if (migrations.length === 0) {
    log("nenhum arquivo de migration encontrado — nada a fazer.");
    return;
  }

  const client = await conectarComRetentativa(dbUrl);
  try {
    await garantirTabelaDeControle(client);
    const aplicadas = await versoesJaAplicadas(client);
    const pendentes = migrations.filter((m) => !aplicadas.has(m.versao));

    if (pendentes.length === 0) {
      log(`banco já está atualizado (${migrations.length} arquivos aplicados).`);
      return;
    }

    log(`aplicando ${pendentes.length} arquivo(s) novo(s) no banco...`);
    for (const migration of pendentes) {
      log(`  → ${migration.arquivo}`);
      await aplicar(client, migration);
    }
    log("banco atualizado com sucesso.");
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  erroFatal("erro inesperado ao atualizar o banco (mensagem acima).");
});
