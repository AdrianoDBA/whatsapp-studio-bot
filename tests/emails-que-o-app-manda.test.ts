/**
 * QUAIS EMAILS O APP MANDA — e a promessa que a tela faz sobre eles.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * `lib/email/templates/` tem TRÊS arquivos, mas o app só envia DOIS. O
 * `welcome.tsx` nunca teve chamador nenhum — é um molde, não uma função.
 *
 * Isso passou despercebido até alguém (eu) contar os arquivos da pasta em vez
 * de contar os `import`, e escrever na tela de Configurações da plataforma que
 * a Resend entrega "convite, **boas-vindas** e resultado de automação". Quem
 * lesse ia esperar um email de boas-vindas que nunca sai.
 *
 * É a mesma família dos outros defeitos deste template: a frase descreve o que
 * a pasta PARECE ter, não o que o código faz. Nada quebra — o app sobe igual.
 *
 * A guarda liga os dois lados: quem afirma na tela tem que bater com quem
 * importa no código.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProviderInfo } from "@/lib/secrets/providers";

const RAIZ = process.cwd();
const PASTA_DE_TEMPLATES = join(RAIZ, "lib", "email", "templates");

/** Os arquivos de template que existem na pasta. */
function templatesNoDisco(): string[] {
  return readdirSync(PASTA_DE_TEMPLATES).filter((f) => f.endsWith(".tsx"));
}

/** Onde procurar por quem importa um template. */
const CODIGO = ["lib", "app"];

function arquivosDeCodigo(pasta: string, acc: string[] = []): string[] {
  for (const item of readdirSync(join(RAIZ, pasta), { withFileTypes: true })) {
    const caminho = `${pasta}/${item.name}`;
    if (item.isDirectory()) arquivosDeCodigo(caminho, acc);
    else if (/\.tsx?$/.test(item.name) && !caminho.startsWith("lib/email/templates"))
      acc.push(caminho);
  }
  return acc;
}

const todoOCodigo = CODIGO.flatMap((p) => arquivosDeCodigo(p))
  .map((f) => readFileSync(join(RAIZ, f), "utf8"))
  .join("\n");

/** Um template é "ligado" quando algum arquivo fora da pasta o importa. */
function estaLigado(arquivo: string): boolean {
  const nome = arquivo.replace(/\.tsx$/, "");
  return todoOCodigo.includes(`email/templates/${nome}`);
}

describe("os templates de email", () => {
  it("os dois que o app manda continuam ligados", () => {
    // Se um destes se desligar, algum email parou de sair e ninguém percebeu:
    // `.send()` nunca chega a ser chamado, então não existe erro pra logar.
    expect(estaLigado("invitation.tsx"), "o email de convite perdeu o chamador").toBe(true);
    expect(
      estaLigado("resultado-da-automacao.tsx"),
      "o email de resultado da automação perdeu o chamador",
    ).toBe(true);
  });

  it("template sem chamador avisa, no próprio arquivo, que ninguém manda ele", () => {
    // Molde é legítimo — o aluno pede pro Claude Code ligar. O que não pode é
    // parecer uma função pronta pra quem abrir a pasta.
    for (const arquivo of templatesNoDisco()) {
      if (estaLigado(arquivo)) continue;

      const conteudo = readFileSync(join(PASTA_DE_TEMPLATES, arquivo), "utf8");
      expect(
        conteudo,
        `${arquivo} não tem chamador nenhum e não avisa disso no topo do arquivo`,
      ).toMatch(/NADA MANDA ESTE EMAIL|ponto de partida, n[ãa]o uma função/i);
    }
  });
});

describe("a tela não promete email que o app não manda", () => {
  /** O texto do cartão da Resend, que é o que a pessoa lê antes de cadastrar. */
  const descricaoDaResend = getProviderInfo("resend").description;

  /** As telas e documentos que descrevem os emails do app pro aluno. */
  const TEXTOS_QUE_DESCREVEM = [
    "app/(app)/plataforma/configuracoes/platform-credentials.tsx",
    "lib/email/smtp-do-supabase.ts",
    "docs/01-comecando/02-instalando-tudo.md",
  ];

  it("o cartão da Resend não cita boas-vindas", () => {
    expect(
      descricaoDaResend.toLowerCase(),
      "o app não manda email de boas-vindas — welcome.tsx não tem chamador",
    ).not.toContain("boas-vindas");
  });

  it("nenhuma tela ou guia lista boas-vindas entre os emails que o app manda", () => {
    const problemas: string[] = [];

    for (const caminho of TEXTOS_QUE_DESCREVEM) {
      const texto = readFileSync(join(RAIZ, caminho), "utf8");
      for (const linha of texto.split("\n")) {
        if (!/boas-vindas/i.test(linha)) continue;
        // Falar dele é permitido — desde que seja pra dizer que não sai ainda.
        if (/n[ãa]o manda|ainda n[ãa]o|molde|ponto de partida|NADA MANDA/i.test(linha)) continue;
        problemas.push(`${caminho}: ${linha.trim()}`);
      }
    }

    expect(problemas, `promessa de email de boas-vindas em:\n${problemas.join("\n")}`).toEqual([]);
  });
});
