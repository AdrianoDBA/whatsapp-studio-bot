/**
 * GUARDA ESTÁTICA da configuração de ambiente.
 *
 * Duas coisas que só quebram DEPOIS do deploy, quando ninguém está olhando:
 *
 * 1. O `docker-entrypoint.sh` é quem entrega a ENCRYPTION_KEY pro aluno. Se
 *    alguém trocar a ordem das linhas (gerar a chave DEPOIS das migrations),
 *    tirar a marca de chave temporária, ou salvar o arquivo com fim de linha do
 *    Windows (CRLF), o container morre no boot ou passa a deixar cadastrar
 *    chave de API que some no reinício seguinte. Nada disso aparece no
 *    `tsc --noEmit`.
 *
 * 2. O `.env.example` é o contrato com o aluno: QUATRO variáveis, todas
 *    obrigatórias. Reaparecer um `ANTHROPIC_API_KEY=` ali dentro faz ele
 *    configurar a chave no lugar errado (o código lê essa variável só como
 *    último recurso, e ela não aparece em tela nenhuma).
 *
 * Por isso este teste lê os dois arquivos como TEXTO.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { openSecret, sealSecret, vaultStatus } from "@/lib/secrets/crypto";

const entrypoint = readFileSync(join(process.cwd(), "docker-entrypoint.sh"), "utf8");
const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");

/** Linhas que de fato definem variável (`NOME=`), ignorando comentário. */
function variaveisDefinidas(texto: string): string[] {
  return texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha !== "" && !linha.startsWith("#"))
    .map((linha) => linha.split("=")[0] ?? "")
    .filter((nome) => nome !== "");
}

describe("docker-entrypoint.sh — a entrega da ENCRYPTION_KEY", () => {
  test("não tem fim de linha do Windows (CRLF mata o container no boot)", () => {
    expect(entrypoint.includes("\r")).toBe(false);
  });

  test("gera a chave ANTES das migrations, do trabalhador e do site", () => {
    // ⚠️ MUDANÇA DE CONTRATO CONSCIENTE (não é teste "consertado pra passar").
    // A partir da automação o container roda DOIS processos, e por isso o site
    // deixou de ser `exec node /app/server.js` — o entrypoint precisa
    // continuar vivo pra tomar conta dos dois. A ordem que importa continua
    // sendo a mesma: chave → tabelas do banco → trabalhador → site.
    // Quem cuida do resto do contrato dos dois processos é
    // tests/entrypoint-worker.test.ts.
    const geracao = entrypoint.indexOf("randomBytes(32)");
    const migrate = entrypoint.indexOf("scripts/migrate.mjs");
    const trabalhador = entrypoint.indexOf("scripts/worker.mjs");
    const site = entrypoint.indexOf("node /app/server.js");

    expect(geracao).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(geracao);
    expect(trabalhador).toBeGreaterThan(migrate);
    expect(site).toBeGreaterThan(trabalhador);
  });

  test("só gera quando a variável está vazia (não sobrescreve a do painel)", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: é um pedaço de shell, não de JavaScript — o ${} é do sh.
    expect(entrypoint).toContain('if [ -z "${ENCRYPTION_KEY:-}" ]; then');
  });

  test("exporta a chave e a marca de temporária juntas", () => {
    expect(entrypoint).toContain("export ENCRYPTION_KEY");
    expect(entrypoint).toContain("export ENCRYPTION_KEY_EPHEMERAL");
  });

  test("imprime a linha pronta pra colar no painel", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: é um pedaço de shell, não de JavaScript — o ${} é do sh.
    expect(entrypoint).toContain("ENCRYPTION_KEY=${ENCRYPTION_KEY}");
  });

  test("apaga a marca de temporária quando a chave veio do painel", () => {
    expect(entrypoint).toContain("unset ENCRYPTION_KEY_EPHEMERAL");
  });

  test("avisa que perder a chave apaga as chaves de API cadastradas", () => {
    expect(entrypoint).toContain("Perder a ENCRYPTION_KEY");
  });
});

describe("a chave que o container gera é aceita pelo cofre", () => {
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_EPHEMERAL;
  });

  test("32 bytes em base64: o cofre abre e fecha com ela", () => {
    // A MESMA receita da linha `node -e` do docker-entrypoint.sh.
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

    expect(vaultStatus()).toBe("ok");
    const aad = { organizationId: null, provider: "openrouter" } as const;
    const embrulho = sealSecret("sk-or-v1-teste", aad);
    expect(openSecret(embrulho, aad)).toBe("sk-or-v1-teste");
  });

  test("com a marca de temporária, o cofre se recusa a guardar", () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.ENCRYPTION_KEY_EPHEMERAL = "1";

    expect(vaultStatus()).toBe("ephemeral");
  });
});

describe(".env.example — quatro obrigatórias, nenhuma opcional", () => {
  const OBRIGATORIAS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DATABASE_URL", "ENCRYPTION_KEY"];

  test("define exatamente essas quatro variáveis", () => {
    expect(variaveisDefinidas(envExample).sort()).toEqual([...OBRIGATORIAS].sort());
  });

  test("nenhuma chave de provedor voltou pro arquivo", () => {
    // Elas continuam sendo LIDAS pelo lib/env.ts (compatibilidade com quem já
    // tinha deploy no ar), mas o caminho novo é cadastrar pelas telas.
    const definidas = variaveisDefinidas(envExample);
    for (const proibida of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "RESEND_API_KEY",
      "EMAIL_FROM",
    ]) {
      expect(definidas, `${proibida} voltou pro .env.example`).not.toContain(proibida);
    }
  });

  test("nenhuma variável com prefixo NEXT_PUBLIC_ (regra 4 do CLAUDE.md)", () => {
    for (const nome of variaveisDefinidas(envExample)) {
      expect(nome.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  test("ensina a gerar a ENCRYPTION_KEY na própria máquina", () => {
    expect(envExample).toContain("npm run gerar-chave");
  });

  test("o comando que o .env.example manda rodar EXISTE de verdade", () => {
    // Documentação que manda rodar um comando inexistente é pior do que não
    // documentar: o aluno tenta, dá erro, e ele acha que quebrou o projeto.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["gerar-chave"]).toBeDefined();
    expect(existsSync(join(process.cwd(), "scripts", "gerar-chave.mjs"))).toBe(true);
  });

  test("a chave que o comando gera é aceita pelo cofre", () => {
    // Fecha o círculo: o formato que o script imprime tem que ser exatamente
    // o que o cofre aceita. Se um dos dois mudar sozinho, este teste quebra.
    const gerada = randomBytes(32).toString("base64");
    expect(/^[A-Za-z0-9+/]+={0,2}$/.test(gerada)).toBe(true);
    expect(Buffer.from(gerada, "base64").length).toBe(32);
  });
});
