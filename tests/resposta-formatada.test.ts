/**
 * A RESPOSTA DO AGENTE NA TELA — o que o aluno realmente lê.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * Todo modelo escreve em Markdown. Sem nada que interprete, a tela mostrava
 * literalmente `**Fechar contrato**` — asteriscos e tudo — e pra quem é leigo
 * isso não parece "Markdown cru", parece que a IA escreveu errado. Medido no
 * navegador, com modelo de verdade, nas três telas que mostram resposta
 * (conversa, playground e detalhe da execução).
 *
 * O que ele trava, além disso: que a formatação NUNCA vire HTML. O texto do
 * agente carrega pedaço de documento que alguém subiu e corpo de webhook que
 * veio de fora — se um dia isso virar `dangerouslySetInnerHTML`, é script
 * rodando na tela do time inteiro.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RespostaFormatada } from "@/components/ai/resposta-formatada";

/** Renderiza como o navegador renderizaria, e devolve o HTML. */
function html(texto: string): string {
  return renderToStaticMarkup(RespostaFormatada({ texto }));
}

/**
 * Só o texto que a pessoa enxerga, sem nenhuma etiqueta.
 *
 * A etiqueta vira um espaço (e não nada): `<span>1.</span><span>Um</span>` é
 * "1. Um" na tela, não "1.Um".
 */
function visivel(texto: string): string {
  return html(texto)
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("a formatação some da tela e vira estilo", () => {
  it("negrito vira negrito, e os asteriscos SOMEM", () => {
    const saida = html("A tarefa de prioridade alta é: **Fechar contrato**.");
    expect(saida).toContain("<strong");
    expect(saida).toContain("Fechar contrato");
    expect(visivel("**Fechar contrato**")).toBe("Fechar contrato");
    expect(visivel("**Fechar contrato**")).not.toContain("*");
  });

  it("itálico, código e título também", () => {
    expect(html("Documento *Politica de ferias*")).toContain("<em");
    expect(html("Rode `npm run dev` aí")).toContain("<code");
    // Título vira um parágrafo em negrito — o tamanho da fonte não muda, senão
    // uma resposta com "## " no meio viraria um outdoor dentro do balão.
    expect(html("## Origem")).toContain("font-semibold");
    expect(visivel("## Origem")).toBe("Origem");
  });

  it("lista com marcador e lista numerada viram lista", () => {
    const comMarcador = html("- Ligar pro cliente\n- Fechar contrato");
    expect(comMarcador).toContain("<ul");
    expect((comMarcador.match(/<li/g) ?? []).length).toBe(2);

    const numerada = html("1. Primeiro\n2. Segundo");
    expect(numerada).toContain("<ul");
    // A numeração da resposta é preservada — não é reinventada pelo navegador.
    expect(visivel("1. Primeiro\n2. Segundo")).toBe("1. Primeiro 2. Segundo");
  });

  it("bloco de código não interpreta nada por dentro", () => {
    const saida = html("Exemplo:\n```\n**isso não é negrito**\n```");
    expect(saida).toContain("<pre");
    // Dentro da cerca os asteriscos CONTINUAM, porque ali eles são o conteúdo.
    expect(saida).toContain("**isso não é negrito**");
  });
});

describe("nada do que o agente escreve vira HTML", () => {
  // O texto do agente carrega trecho de documento que alguém subiu e corpo de
  // webhook que veio de fora. Estes três casos são a diferença entre "aparece
  // escrito na tela" e "roda no navegador de quem abriu".
  const ataques = [
    '<script>alert("xss")</script>',
    '<img src=x onerror="alert(1)">',
    '**negrito** e <iframe src="https://exemplo.com"></iframe>',
  ];

  for (const ataque of ataques) {
    it(`escapa: ${ataque.slice(0, 32)}`, () => {
      const saida = html(ataque);
      expect(saida).not.toContain("<script");
      expect(saida).not.toContain("<img");
      expect(saida).not.toContain("<iframe");
      expect(saida).toContain("&lt;");
    });
  }
});

describe("nenhuma letra do agente se perde", () => {
  it("texto sem formatação nenhuma sai igualzinho", () => {
    const cru = "Atualmente, existem 2 tarefas pendentes no workspace.";
    expect(visivel(cru)).toBe(cru);
  });

  it("asterisco solto não some nem quebra", () => {
    // Modelo escreve "3 * 4 = 12" e "custo * quantidade" o tempo todo.
    expect(visivel("3 * 4 = 12")).toBe("3 * 4 = 12");
    expect(visivel("O preço é custo * quantidade")).toBe("O preço é custo * quantidade");
  });

  it("marca aberta e não fechada aparece como texto", () => {
    expect(visivel("Isso ficou **pela metade")).toBe("Isso ficou **pela metade");
  });

  it("resposta vazia não quebra", () => {
    expect(() => html("")).not.toThrow();
    expect(visivel("")).toBe("");
  });
});
