/**
 * A RESPOSTA DO AGENTE, com o pouco de formatação que os modelos usam.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * --------------------------
 * Todo modelo escreve em Markdown, sempre, mesmo mandado não escrever. Sem
 * nada que interprete isso, a tela mostrava literalmente:
 *
 *     1. **Fechar contrato da Padaria do Ze** — Prioridade: Alta
 *
 * asteriscos e tudo. Pra um aluno leigo isso não parece "Markdown não
 * renderizado", parece que a IA escreveu errado.
 *
 * POR QUE NÃO `react-markdown`
 * ---------------------------
 * O template segura o número de dependências de propósito — quem vai manter
 * isso não codifica. Aqui a gente cobre só o que um modelo de chat realmente
 * escreve (negrito, itálico, `código`, título, lista, bloco de código) e ignora
 * o resto do Markdown de propósito: tabela, imagem, link de referência,
 * HTML solto. O que não é reconhecido aparece como texto normal — nunca some.
 *
 * ⚠️ NADA AQUI USA `dangerouslySetInnerHTML`. A saída são elementos React
 * montados um a um, então texto do modelo NUNCA vira HTML. Isso não é detalhe
 * de estilo: parte do que o agente escreve veio de um documento que alguém
 * subiu, ou do corpo de um webhook. Se um dia alguém "simplificar" isso pra uma
 * string de HTML, vira injeção de script na tela do time inteiro.
 */

/** `**negrito**`, `*itálico*`, `_itálico_` e `` `código` ``, dentro de uma linha. */
function inline(texto: string, chaveBase: string): React.ReactNode[] {
  const saida: React.ReactNode[] = [];
  // Uma expressão só, com quatro alternativas, pra varrer a linha da esquerda
  // pra direita sem precisar decidir precedência entre elas.
  const marcas =
    /(\*\*[^*]+\*\*|`[^`]+`|(?<![\w*])\*[^*\n]+\*(?![\w*])|(?<![\w_])_[^_\n]+_(?![\w_]))/g;

  let ultimo = 0;
  let achado: RegExpExecArray | null = marcas.exec(texto);
  let n = 0;

  while (achado !== null) {
    if (achado.index > ultimo) saida.push(texto.slice(ultimo, achado.index));

    const bruto = achado[0];
    const chave = `${chaveBase}-${n++}`;

    if (bruto.startsWith("**")) {
      saida.push(
        <strong key={chave} className="font-semibold">
          {bruto.slice(2, -2)}
        </strong>,
      );
    } else if (bruto.startsWith("`")) {
      saida.push(
        <code key={chave} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {bruto.slice(1, -1)}
        </code>,
      );
    } else {
      saida.push(
        <em key={chave} className="italic">
          {bruto.slice(1, -1)}
        </em>,
      );
    }

    ultimo = achado.index + bruto.length;
    achado = marcas.exec(texto);
  }

  if (ultimo < texto.length) saida.push(texto.slice(ultimo));
  return saida;
}

/** Quantos `#` a linha tem na frente. 0 = não é título. */
function nivelDoTitulo(linha: string): number {
  const m = /^(#{1,4})\s+/.exec(linha);
  return m?.[1] ? m[1].length : 0;
}

/** `- item`, `* item` ou `• item`. */
function itemDeLista(linha: string): string | null {
  const m = /^\s*[-*•]\s+(.*)$/.exec(linha);
  return m?.[1] ?? null;
}

/** `1. item`, `2) item`. */
function itemNumerado(linha: string): { marca: string; texto: string } | null {
  const m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(linha);
  if (!m?.[1]) return null;
  return { marca: `${m[1]}.`, texto: m[2] ?? "" };
}

export function RespostaFormatada({ texto }: { texto: string }) {
  const linhas = texto.split("\n");
  const blocos: React.ReactNode[] = [];

  let i = 0;
  let n = 0;

  while (i < linhas.length) {
    const linha = linhas[i] ?? "";

    // --- bloco de código (``` … ```) -------------------------------------
    // Vem primeiro: dentro dele NADA é interpretado, nem título nem negrito.
    if (linha.trimStart().startsWith("```")) {
      const dentro: string[] = [];
      i++;
      while (i < linhas.length && !(linhas[i] ?? "").trimStart().startsWith("```")) {
        dentro.push(linhas[i] ?? "");
        i++;
      }
      // Cerca sem fechamento é comum quando a resposta foi interrompida no meio.
      // O texto aparece do mesmo jeito — some nada.
      i++;
      blocos.push(
        <pre
          key={`cod-${n++}`}
          className="overflow-x-auto rounded-md border border-border/60 bg-muted/50 p-3 font-mono text-xs"
        >
          {dentro.join("\n")}
        </pre>,
      );
      continue;
    }

    // --- título (#, ##, ###) ---------------------------------------------
    const nivel = nivelDoTitulo(linha);
    if (nivel > 0) {
      blocos.push(
        <p key={`tit-${n++}`} className="mt-3 mb-1 font-semibold first:mt-0">
          {inline(linha.slice(nivel).trim(), `tit-${n}`)}
        </p>,
      );
      i++;
      continue;
    }

    // --- lista (com marcador ou numerada) --------------------------------
    if (itemDeLista(linha) !== null || itemNumerado(linha) !== null) {
      const itens: Array<{ marca: string; texto: string }> = [];
      while (i < linhas.length) {
        const atual = linhas[i] ?? "";
        const comMarcador = itemDeLista(atual);
        const numerado = itemNumerado(atual);
        if (comMarcador !== null) itens.push({ marca: "•", texto: comMarcador });
        else if (numerado !== null) itens.push(numerado);
        else break;
        i++;
      }
      blocos.push(
        <ul key={`lis-${n++}`} className="my-1.5 space-y-1">
          {itens.map((item, idx) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a lista é estática, montada de uma vez a partir do texto — não reordena nem recebe item no meio.
              key={idx}
              className="flex gap-2"
            >
              <span className="shrink-0 text-muted-foreground tabular-nums">{item.marca}</span>
              <span className="min-w-0">{inline(item.texto, `lis-${n}-${idx}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // --- parágrafo (uma ou mais linhas seguidas) --------------------------
    const paragrafo: string[] = [];
    while (i < linhas.length) {
      const atual = linhas[i] ?? "";
      if (
        atual.trim() === "" ||
        atual.trimStart().startsWith("```") ||
        nivelDoTitulo(atual) > 0 ||
        itemDeLista(atual) !== null ||
        itemNumerado(atual) !== null
      ) {
        break;
      }
      paragrafo.push(atual);
      i++;
    }

    if (paragrafo.length > 0) {
      blocos.push(
        <p key={`par-${n++}`} className="whitespace-pre-wrap break-words leading-relaxed">
          {inline(paragrafo.join("\n"), `par-${n}`)}
        </p>,
      );
    } else {
      // Linha em branco: só anda. O espaçamento entre blocos é do CSS, senão
      // uma resposta com muitas linhas vazias viraria um vão enorme.
      i++;
    }
  }

  return <div className="space-y-2">{blocos}</div>;
}
