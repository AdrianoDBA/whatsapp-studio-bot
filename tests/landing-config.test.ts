/**
 * O TEXTO DA PÁGINA DE ENTRADA — o que ele não pode voltar a dizer.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * A landing antiga mentia de seis jeitos ao mesmo tempo, e nenhum deles quebrava
 * nada: o site subia, o build passava, os 780 testes ficavam verdes. Mentira em
 * página de marketing não tem sintoma técnico — o sintoma é uma pessoa criando
 * conta por causa de uma coisa e encontrando outra.
 *
 * Os seis:
 *   1. vendia autenticação e multi-tenant, sem uma palavra sobre agente de IA;
 *   2. anunciava uma tela ("KPI cards, gráficos com Recharts") que foi apagada;
 *   3. o painel do topo era inventado (Usuários 1.234, Receita R$ 4,5k);
 *   4. mandava rodar `npx degit nathan/template meu-saas`, endereço que não
 *      existe — o comando falhava pra quem copiasse;
 *   5. escrevia o nome do app na mão, então renomear o app não renomeava aqui;
 *   6. o rodapé dizia "MIT" sem existir arquivo de licença no projeto.
 *
 * O que dá pra testar sem navegador são os textos. As duas checagens que mais
 * importam estão nos dois últimos `describe`: **nada de afirmação jurídica** e
 * **nada de promessa de preço** no texto que sai de fábrica — porque essas duas
 * o aluno publica sem perceber que a frase passou a ser dele.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appConfig } from "@/config/app.config";
import { landingConfig } from "@/config/landing.config";

/** Todo texto que a página mostra, num vetor só. */
function todasAsFrases(): string[] {
  const c = landingConfig;
  return [
    c.hero.selo,
    c.hero.titulo,
    c.hero.destaque,
    c.hero.subtitulo,
    c.hero.botaoPrincipal,
    c.hero.botaoSecundario,
    c.navegacao.entrar,
    c.navegacao.criarConta,
    c.exemplo.endereco,
    c.exemplo.pergunta,
    c.exemplo.resposta,
    c.exemplo.fonte,
    ...c.esteira,
    c.secaoFuncionalidades.selo,
    c.secaoFuncionalidades.titulo,
    ...c.funcionalidades.flatMap((f) => [f.etiqueta, f.titulo, f.descricao]),
    c.chamadaFinal.selo,
    c.chamadaFinal.titulo,
    c.chamadaFinal.destaque,
    c.chamadaFinal.subtitulo,
    c.chamadaFinal.botao,
    c.rodape.esquerda,
    c.rodape.direita,
  ];
}

/**
 * O texto que FAZ PROMESSA: topo, quadrinhos e chamada final.
 *
 * O exemplo de conversa fica de fora de propósito — ele é a fala de um agente
 * de mentira sobre uma garantia de mentira, e aparece na tela com a palavra
 * "exemplo" do lado. Frase de dentro dele não é o site prometendo nada.
 */
function frasesQuePrometem(): string[] {
  const c = landingConfig;
  return [
    c.hero.selo,
    c.hero.titulo,
    c.hero.destaque,
    c.hero.subtitulo,
    c.secaoFuncionalidades.titulo,
    ...c.funcionalidades.flatMap((f) => [f.titulo, f.descricao]),
    c.chamadaFinal.titulo,
    c.chamadaFinal.destaque,
    c.chamadaFinal.subtitulo,
  ];
}

describe("as seis mentiras não podem voltar", () => {
  it("nenhum comando de instalação que não existe", () => {
    // Era `npx degit nathan/template meu-saas`. O repositório é outro, então
    // quem copiasse recebia erro na primeira linha digitada.
    for (const frase of todasAsFrases()) {
      expect(frase.toLowerCase()).not.toContain("degit");
      expect(frase).not.toMatch(/\bnpx\b|\bnpm install\b|\bgit clone\b/);
    }
  });

  it("nenhuma licença anunciada — não existe arquivo LICENSE no projeto", () => {
    // Dizer "MIT" no rodapé é afirmação jurídica, não enfeite. Se um dia
    // existir um LICENSE de verdade, este teste é o lugar de afrouxar a regra.
    for (const frase of todasAsFrases()) {
      expect(frase).not.toMatch(/\b(MIT|Apache|GPL|BSD)\b/);
    }
  });

  it("o nome do app não está escrito na mão em lugar nenhum", () => {
    // Ele vem de `config/app.config.ts`. Escrever de novo aqui faria renomear
    // o app deixar a landing com o nome velho — que foi exatamente o que
    // acontecia antes.
    for (const frase of todasAsFrases()) {
      expect(frase).not.toContain(appConfig.name);
    }
  });

  it("não sobrou nenhum número de negócio inventado", () => {
    // O painel do topo dizia "Usuários 1.234 · Receita R$ 4,5k · Retenção 89%".
    // Nenhum deles vinha de lugar nenhum.
    for (const frase of frasesQuePrometem()) {
      expect(frase, `número solto em "${frase}"`).not.toMatch(/R\$\s*[\d.,]+|US\$\s*[\d.,]+/);
      expect(frase).not.toMatch(/\b\d{1,3}(\.\d{3})+\b/);
    }
  });
});

describe("o texto de fábrica não promete o que não é do app", () => {
  it("nenhuma promessa de preço", () => {
    // ⚠️ ESTA É A MAIS IMPORTANTE. "Comece hoje, de graça" foi a primeira
    // versão que eu escrevi, e é o tipo de frase que o aluno publica sem
    // perceber que ela passou a ser dele: no dia em que ele cobrar, a página
    // continua dizendo que é grátis.
    const proibidas = ["de graça", "gratuito", "gratuita", "grátis", "sem pagar", "para sempre"];
    for (const frase of frasesQuePrometem()) {
      for (const p of proibidas) {
        expect(frase.toLowerCase(), `"${p}" apareceu em "${frase}"`).not.toContain(p);
      }
    }
  });

  it("nenhuma integração que o app não tem", () => {
    // O erro clássico: escrever "integra com WhatsApp" porque soa bem. O app
    // tem webhook genérico, e webhook não é WhatsApp.
    const naoExistem = ["whatsapp", "instagram", "telegram", "stripe", "pix", "boleto"];
    for (const frase of frasesQuePrometem()) {
      for (const p of naoExistem) {
        expect(frase.toLowerCase(), `"${p}" não existe no app`).not.toContain(p);
      }
    }
  });

  it("não descreve mais a tela de demo que foi apagada", () => {
    for (const frase of frasesQuePrometem()) {
      expect(frase.toLowerCase()).not.toContain("recharts");
      expect(frase.toLowerCase()).not.toContain("kpi");
    }
  });
});

describe("é texto pra quem vai USAR, não pra quem programa", () => {
  it("nenhum jargão técnico", () => {
    // Quem lê essa página é o cliente do aluno. "RLS" e "multi-tenant" não
    // dizem nada pra ele — e a regra do projeto é PT-BR sem jargão.
    const jargao = [
      "rls",
      "multi-tenant",
      "row level",
      "next.js",
      "supabase",
      "tailwind",
      "postgres",
      "deploy",
      "schema",
      "api",
      "docker",
      "server action",
      "embedding",
      "webhook",
      "token",
    ];
    for (const frase of frasesQuePrometem()) {
      for (const j of jargao) {
        expect(frase.toLowerCase(), `"${j}" apareceu em "${frase}"`).not.toContain(j);
      }
    }
  });

  it("não vende mais um template — vende um produto", () => {
    // A página antiga dizia "Template · v1.0" e "Clone, configure em 3
    // minutos". Quando o aluno publicasse, o cliente dele leria isso.
    for (const frase of frasesQuePrometem()) {
      expect(frase.toLowerCase()).not.toContain("template");
      expect(frase.toLowerCase()).not.toContain("saas");
      expect(frase.toLowerCase()).not.toContain("boilerplate");
    }
  });
});

describe("a forma da página continua de pé", () => {
  it("são exatamente seis quadrinhos", () => {
    // A grade é de 3 colunas. Cinco ou sete deixam um buraco na última fileira.
    expect(landingConfig.funcionalidades).toHaveLength(6);
  });

  it("nenhum texto vazio", () => {
    for (const frase of todasAsFrases()) {
      expect(frase.trim().length, `frase vazia em algum lugar do config`).toBeGreaterThan(0);
    }
  });

  it("cada quadrinho tem etiqueta própria", () => {
    const etiquetas = landingConfig.funcionalidades.map((f) => f.etiqueta);
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
  });

  it("a esteira tem itens suficientes pra dar a volta", () => {
    // A animação duplica a lista pra emendar sem buraco. Com dois ou três
    // itens, a emenda fica visível numa tela larga.
    expect(landingConfig.esteira.length).toBeGreaterThanOrEqual(4);
  });

  it("o exemplo de conversa está completo", () => {
    // Ele aparece com a palavra "exemplo" na tela — mas se a resposta vier
    // vazia, sobra um balão em branco que parece defeito.
    const { pergunta, resposta, fonte } = landingConfig.exemplo;
    expect(pergunta.length).toBeGreaterThan(10);
    expect(resposta.length).toBeGreaterThan(20);
    expect(fonte.length).toBeGreaterThan(3);
  });
});

/**
 * A FAIXA DAS TELAS DE ENTRAR E CRIAR CONTA (`paginasDeEntrada`).
 *
 * Ela ficou de fora das duas limpezas da landing porque o texto morava escrito
 * na mão dentro de `app/(auth)/layout.tsx` — e mentia de três jeitos ao mesmo
 * tempo, sem quebrar nada: mandava rodar `npm run setup` (comando que nunca
 * existiu), anunciava "Migrations 13" quando eram 50 e "Slash cmds 3" quando
 * não existe nenhum, e escrevia o nome do app na mão.
 */
describe("a faixa do entrar/criar conta não pode mentir", () => {
  const painel = landingConfig.paginasDeEntrada;

  /** Só as frases — o terminal tem regra própria logo abaixo. */
  function frasesDoPainel(): string[] {
    return [painel.titulo, painel.destaque, painel.subtitulo, ...painel.jaVemPronto];
  }

  it("todo `npm run` do terminalzinho existe de verdade no package.json", () => {
    // A mentira nº 1: `npm run setup`. Quem copiava recebia
    // "Missing script: setup" e achava que tinha quebrado o projeto.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const linha of painel.terminal) {
      const nomeDoScript = linha.comando.match(/^npm run ([\w:-]+)$/)?.[1];
      if (!nomeDoScript) continue;
      expect(
        pkg.scripts[nomeDoScript],
        `o painel manda rodar "${linha.comando}", que não existe no package.json`,
      ).toBeDefined();
    }
  });

  it("nenhum placar inventado", () => {
    // A mentira nº 2: números que ninguém contava e que envelheciam sozinhos.
    // O `resultado` do terminal fica de fora: lá o número é o endereço de
    // verdade que o `npm run dev` imprime (`localhost:3000`), não um placar.
    for (const frase of frasesDoPainel()) {
      expect(frase, `número solto em "${frase}"`).not.toMatch(/\b\d+\s*\+?\s*$/);
    }
  });

  it("o nome do app não está escrito na mão", () => {
    // A mentira nº 3. Ele vem de `appConfig.name`, num lugar só.
    for (const frase of frasesDoPainel()) {
      expect(frase).not.toContain(appConfig.name);
    }
  });

  it("cada item de 'já vem pronto' aponta pra uma tela que existe", () => {
    // Mesma regra dos seis quadrinhos da landing: nada de vender função que
    // não tem tela. Quatro itens porque a grade é de 2 colunas.
    expect(painel.jaVemPronto).toHaveLength(4);
    for (const item of painel.jaVemPronto) {
      expect(item.trim().length).toBeGreaterThan(0);
    }
  });
});
