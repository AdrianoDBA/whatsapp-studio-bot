/**
 * "ESSA CHAVE É MESMO DESSE PROVEDOR?"
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * A tela sempre disse "Começa com sk-or-", mas nada conferia. Medido no
 * navegador: colei `chave-errada-123` no campo do OpenRouter, cliquei em
 * Guardar, e a tela devolveu o selo verde **"cadastrada"**. O aluno ia embora
 * achando que estava tudo certo — o erro só aparecia muito depois, na primeira
 * conversa, numa mensagem do provedor em inglês.
 *
 * O caso mais escorregadio está no `describe` do meio: chave da OpenAI, da
 * Anthropic e do OpenRouter começam TODAS com `sk-`. Conferir só "começa com o
 * prefixo certo" deixaria uma chave do OpenRouter passar no campo da OpenAI.
 */
import { describe, expect, it } from "vitest";
import { CREDENTIAL_PROVIDERS, conferirPrefixoDaChave } from "@/lib/secrets/providers";

/** Uma chave de mentira com o formato certo de cada provedor. */
const CHAVE_DE_VERDADE = {
  openrouter: "sk-or-dummy-test-key-for-prefix-check-only",
  anthropic: "sk-ant-api03-0000000000000000000000000000000000000000000000",
  openai: "sk-proj-000000000000000000000000000000000000000000000000",
  google: "AIzaSy0000000000000000000000000000000000",
  resend: "re_0000000000000000000000",
} as const;

describe("a chave certa passa", () => {
  for (const info of CREDENTIAL_PROVIDERS) {
    it(`aceita a chave do ${info.label}`, () => {
      expect(conferirPrefixoDaChave(info.id, CHAVE_DE_VERDADE[info.id])).toBeNull();
    });
  }

  it("espaço colado sem querer não atrapalha", () => {
    expect(conferirPrefixoDaChave("openrouter", `  ${CHAVE_DE_VERDADE.openrouter}  `)).toBeNull();
  });
});

describe("chave do provedor ERRADO é recusada, dizendo qual é o certo", () => {
  // Este é o engano de verdade: os três começam com "sk-". Sem a conferência do
  // prefixo mais específico, a do OpenRouter passaria no campo da OpenAI.
  it("chave do OpenRouter no campo da OpenAI", () => {
    const erro = conferirPrefixoDaChave("openai", CHAVE_DE_VERDADE.openrouter);
    // A frase nomeia PRA ONDE ir. Nomear também o campo onde a pessoa já está
    // não acrescenta nada — ela está olhando pra ele.
    expect(erro).toContain("OpenRouter");
    expect(erro).toContain("Cole ela no campo");
  });

  it("chave da Anthropic no campo da OpenAI", () => {
    const erro = conferirPrefixoDaChave("openai", CHAVE_DE_VERDADE.anthropic);
    expect(erro).toContain("Anthropic");
  });

  it("chave do OpenRouter no campo da Anthropic diz de quem ela é", () => {
    // Este passou raspando: `sk-or-` é MAIS CURTO que `sk-ant-`. Uma versão
    // anterior só olhava prefixo mais longo que o do próprio campo, e aqui
    // devolvia o aviso genérico — certo, mas sem dizer onde colar.
    const erro = conferirPrefixoDaChave("anthropic", CHAVE_DE_VERDADE.openrouter);
    expect(erro).toContain("OpenRouter");
    expect(erro).toContain('Cole ela no campo "OpenRouter"');
  });

  it("chave da OpenAI no campo do OpenRouter", () => {
    expect(conferirPrefixoDaChave("openrouter", CHAVE_DE_VERDADE.openai)).not.toBeNull();
  });

  it("chave do Google no campo do Resend", () => {
    expect(conferirPrefixoDaChave("resend", CHAVE_DE_VERDADE.google)).not.toBeNull();
  });
});

describe("o caso que motivou tudo isso", () => {
  it("texto qualquer não vira credencial", () => {
    const erro = conferirPrefixoDaChave("openrouter", "chave-errada-123");
    expect(erro).not.toBeNull();
    // A frase precisa dizer o que fazer, não só que está errado.
    expect(erro).toContain("sk-or-");
  });

  it("a frase é em português e não joga jargão na cara", () => {
    const erro = conferirPrefixoDaChave("google", "minha chave secreta") ?? "";
    expect(erro).toMatch(/começa com/i);
    expect(erro.toLowerCase()).not.toContain("prefix");
    expect(erro.toLowerCase()).not.toContain("invalid");
  });

  it("a frase NÃO põe artigo antes do nome do provedor", () => {
    // "a Anthropic", "o OpenRouter", "o Google": os rótulos têm gêneros
    // diferentes, e montar a frase com artigo escrevia "não do Anthropic
    // (Claude)" na tela. Por isso o rótulo aparece entre aspas, como nome de
    // campo — assim a mesma frase serve pros cinco e pro sexto que vier.
    for (const info of CREDENTIAL_PROVIDERS) {
      const erro = conferirPrefixoDaChave(info.id, "isso-nao-e-chave-de-ninguem") ?? "";
      expect(erro, `frase torta pro ${info.label}`).toContain(`"${info.label}"`);
      expect(erro).not.toMatch(/\b(do|da) [A-Z]/);
    }
  });
});

describe("o catálogo não pode ficar pela metade", () => {
  it("todo provedor tem um começo de chave declarado", () => {
    for (const info of CREDENTIAL_PROVIDERS) {
      expect(info.keyPrefix.length, `${info.id} está sem keyPrefix`).toBeGreaterThan(1);
    }
  });

  it("o texto da tela combina com o que o código confere", () => {
    // Se um dia alguém mudar o `keyPrefix` e esquecer do `keyHint`, a tela passa
    // a pedir uma coisa e o código a recusar outra.
    for (const info of CREDENTIAL_PROVIDERS) {
      expect(info.keyHint, `o aviso do ${info.label} não cita "${info.keyPrefix}"`).toContain(
        info.keyPrefix,
      );
    }
  });
});
