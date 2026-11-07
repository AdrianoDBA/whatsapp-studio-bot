/**
 * O RECORTE — como um documento vira pedaços indexáveis.
 *
 * POR QUE RECORTAR
 * ----------------
 * O agente não lê o documento inteiro: ele lê os 3 ou 5 TRECHOS mais parecidos
 * com a pergunta. Se o pedaço for grande demais, o trecho vem cheio de assunto
 * que não interessa (e o modelo se perde no meio). Se for pequeno demais, a
 * frase é cortada ao meio e nenhum trecho responde nada sozinho.
 *
 * O tamanho daqui (≈1.000 caracteres, com 150 de sobreposição) é o meio-termo
 * que funciona pra documento de texto corrido em português.
 *
 * A SOBREPOSIÇÃO NÃO É DESPERDÍCIO. Sem ela, uma resposta que começa no fim de
 * um pedaço e termina no começo do seguinte não aparece INTEIRA em nenhum dos
 * dois — e a busca acha "meia resposta" nos dois lugares. Os 150 caracteres
 * repetidos são o preço de a frase de virada nunca ficar partida.
 *
 * ONDE ELE PREFERE CORTAR, nesta ordem:
 *   1. parágrafo (linha em branco)   ← o corte que não quebra nada
 *   2. fim de frase (ponto, exclamação ou interrogação seguidos de espaço)
 *   3. quebra de linha
 *   4. espaço
 *   5. no meio da palavra            ← último recurso (texto sem espaço nenhum)
 *
 * Arquivo PURO: não fala com banco, não lê cookie, dá pra testar no Vitest.
 * É o coração testável desta pasta — `tests/knowledge-chunk.test.ts`.
 */

/** O tamanho que a gente PERSEGUE por pedaço, em caracteres. */
export const CHUNK_ALVO_CHARS = 1000;

/** Quanto do fim de um pedaço se repete no começo do próximo. */
export const CHUNK_SOBREPOSICAO_CHARS = 150;

/**
 * Teto duro por pedaço.
 *
 * ⚠️ É O MESMO NÚMERO do check `document_chunks_content_len` da migration.
 * Um pedaço acima disso é RECUSADO pelo Postgres, e o erro (`23514`) não diz
 * nada pra um leigo. Mudou aqui, mude na migration.
 */
export const CHUNK_MAX_CHARS = 8000;

/**
 * Teto de tamanho do documento inteiro, em caracteres.
 *
 * ⚠️ São 300 mil e não 500 mil porque a indexação é SÍNCRONA (roda dentro da
 * função do servidor, não na fila — ver o corte C8 do contrato) e o servidor
 * que fica na frente do app corta a conexão por volta dos 60 segundos.
 * É o mesmo número do check `documents_content_len` da migration.
 */
export const MAX_CHARS_POR_DOCUMENTO = 300_000;

/** Teto de pedaços por documento. Mesmo motivo do de cima. */
export const MAX_PEDACOS_POR_DOCUMENTO = 900;

export type Pedaco = {
  /** a ordem dentro do documento. Começa em 0 e não pula. */
  seq: number;
  content: string;
  /** estimativa — o número de verdade só o provedor sabe. */
  tokens: number;
};

export type RecorteResult =
  | { ok: true; pedacos: Pedaco[]; totalChars: number; totalTokens: number }
  /** `motivo` JÁ em PT-BR leigo. */
  | { ok: false; motivo: string };

/**
 * Esse caractere precisa sumir antes de indexar?
 *
 * Escrito como comparação de NÚMERO, e não como uma expressão regular com os
 * caracteres dentro, de propósito: caractere de controle escrito dentro de uma
 * expressão é INVISÍVEL no editor, some num copiar-e-colar e não sobrevive a
 * uma ferramenta de formatação. Com número dá pra ler o que está acontecendo.
 *
 * Sai: todo o controle ASCII (menos tabulação e quebra de linha), o DEL, o
 * espaço de largura zero e a marca de ordem de byte. Byte de controle não
 * sobrevive ao `jsonb` do Postgres e derrubaria a gravação do lote inteiro.
 */
function ehLixoInvisivel(codigo: number): boolean {
  if (codigo === 9 || codigo === 10) return false; // tabulação e nova linha ficam
  if (codigo < 32) return true;
  if (codigo === 127) return true; // DEL
  if (codigo === 0x200b) return true; // espaço de largura zero
  if (codigo === 0xfeff) return true; // marca de ordem de byte
  return false;
}

function tirarLixoInvisivel(texto: string): string {
  // Caminho rápido: a maioria dos documentos não tem nenhum. Vasculhar uma vez
  // e não montar string nova é bem mais barato do que reconstruir 300 mil
  // caracteres à toa.
  let precisa = false;
  for (let i = 0; i < texto.length; i++) {
    if (ehLixoInvisivel(texto.charCodeAt(i))) {
      precisa = true;
      break;
    }
  }
  if (!precisa) return texto;

  let saida = "";
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (!ehLixoInvisivel(c)) saida += texto[i];
  }
  return saida;
}

/**
 * Deixa o texto num formato só antes de recortar.
 *
 * O que ela faz, e por quê:
 *  • fim de linha do Windows vira quebra de linha simples — senão cada linha
 *    conta um caractere a mais e o pedaço sai menor do que devia;
 *  • caractere de controle e invisível some (ver `ehLixoInvisivel`);
 *  • três ou mais linhas em branco viram duas — PDF costuma vir cheio delas, e
 *    elas ocupam espaço de pedaço sem carregar significado nenhum;
 *  • espaço no fim da linha some.
 *
 * ⚠️ O QUE ELA NÃO FAZ: mexer em acento, em maiúscula ou em pontuação. O
 * embedding é calculado em cima do MESMO texto que a pessoa vai ler no rastro
 * — se os dois divergirem, o trecho citado não bate com o que foi indexado.
 */
export function normalizarTexto(bruto: string): string {
  if (typeof bruto !== "string") return "";
  return tirarLixoInvisivel(bruto.replace(/\r\n?/g, "\n"))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Quantos tokens aquele texto deve gastar.
 *
 * ESTIMATIVA, e sempre PRA CIMA. Não existe contador de token de verdade sem
 * arrastar um tokenizador de vários megabytes pra dentro do container, e o
 * número exato só serve pra conta — que o provedor manda de volta depois de
 * indexar, e é esse que fica gravado em `documents.embed_tokens`.
 *
 * A conta é ~4 caracteres por token, que é a média de português e inglês nos
 * tokenizadores da OpenAI e do Google. O piso de 1 evita "0 token" pra um
 * pedaço de duas letras.
 */
export function estimarTokens(texto: string): number {
  if (typeof texto !== "string" || texto.length === 0) return 0;
  return Math.max(1, Math.ceil(texto.length / 4));
}

/**
 * Onde é bom cortar, do melhor pro pior.
 *
 * `depois` = quantos caracteres do separador ficam NO PEDAÇO QUE TERMINA.
 * Zero significa "o casamento inteiro fica" — é o caso do fim de frase, em que
 * o ponto final pertence à frase que acabou.
 */
const SEPARADORES: ReadonlyArray<{ re: RegExp; depois: number }> = [
  // Parágrafo: corta depois da linha em branco.
  { re: /\n\n/g, depois: 2 },
  // Fim de frase, inclusive as versões com fecha-aspas ou fecha-parênteses.
  { re: /[.!?]["'”’)\]]?[ \n]/g, depois: 0 },
  { re: /\n/g, depois: 1 },
  { re: / /g, depois: 1 },
];

/**
 * O melhor ponto de corte dentro de `[minimo, maximo)`.
 *
 * Devolve o índice ABSOLUTO onde o próximo pedaço começa, ou `-1` quando não
 * achou separador nenhum na faixa (texto sem espaço, tipo um base64 gigante).
 */
function acharCorte(texto: string, inicio: number, minimo: number, maximo: number): number {
  const janela = texto.slice(inicio, maximo);
  const pisoRelativo = minimo - inicio;

  for (const { re, depois } of SEPARADORES) {
    // `lastIndex` precisa zerar: a expressão é global e é reaproveitada entre
    // chamadas. Sem isso o segundo pedaço procuraria a partir da posição em
    // que o primeiro parou — e o recorte sairia torto de um jeito quase
    // impossível de perceber olhando o resultado.
    re.lastIndex = 0;
    let melhor = -1;
    for (;;) {
      const achado = re.exec(janela);
      if (achado === null) break;
      const fim = achado.index + (depois > 0 ? depois : achado[0].length);
      if (fim >= pisoRelativo && fim < janela.length) melhor = fim;
      // Casamento de tamanho zero não existe nesta lista, mas um `lastIndex`
      // parado travaria o laço pra sempre. Barato demais pra não proteger.
      if (re.lastIndex <= achado.index) re.lastIndex = achado.index + 1;
    }
    if (melhor >= 0) return inicio + melhor;
  }

  return -1;
}

/**
 * Recorta o texto em pedaços.
 *
 * REGRAS DE SAÍDA (todas com teste em `tests/knowledge-chunk.test.ts`):
 *  • `seq` começa em 0 e não pula — é o que o índice único
 *    `(document_id, seq)` do banco espera;
 *  • nenhum pedaço passa de `CHUNK_MAX_CHARS`;
 *  • nenhum pedaço é vazio ou só espaço;
 *  • cada pedaço (menos o primeiro) começa repetindo um trecho do anterior;
 *  • o texto INTEIRO aparece em algum pedaço — recorte que perde conteúdo é o
 *    pior defeito possível aqui, porque a busca simplesmente não acha e
 *    ninguém tem como descobrir por quê.
 */
export function recortarTexto(texto: string): RecorteResult {
  const limpo = normalizarTexto(texto);

  if (limpo.length === 0) {
    return {
      ok: false,
      motivo:
        "Não achei texto nenhum aqui dentro. Se for um PDF escaneado (foto de página), " +
        "ele não tem texto de verdade — passe num programa de reconhecimento de texto antes.",
    };
  }

  if (limpo.length > MAX_CHARS_POR_DOCUMENTO) {
    return {
      ok: false,
      motivo:
        `Esse documento é grande demais (${Math.round(limpo.length / 1000)} mil letras; o ` +
        `limite é ${MAX_CHARS_POR_DOCUMENTO / 1000} mil). Divida em partes e suba uma de cada vez.`,
    };
  }

  const pedacos: Pedaco[] = [];
  // Só aceita cortar cedo a partir da metade do alvo: um separador logo no
  // começo da janela faria pedaços minúsculos e multiplicaria a conta do
  // embedding sem melhorar a busca em nada.
  const minimoRelativo = Math.floor(CHUNK_ALVO_CHARS / 2);

  let inicio = 0;
  let totalTokens = 0;

  while (inicio < limpo.length) {
    const restante = limpo.length - inicio;

    let fim: number;
    if (restante <= CHUNK_ALVO_CHARS) {
      // O que sobrou cabe inteiro num pedaço só: acabou.
      fim = limpo.length;
    } else {
      const corte = acharCorte(
        limpo,
        inicio,
        inicio + minimoRelativo,
        Math.min(inicio + CHUNK_ALVO_CHARS, limpo.length),
      );
      // Sem separador na faixa (texto sem espaço nenhum), corta na régua.
      fim = corte > inicio ? corte : inicio + CHUNK_ALVO_CHARS;
    }

    const conteudo = limpo.slice(inicio, fim).trim();
    if (conteudo.length > 0) {
      if (conteudo.length > CHUNK_MAX_CHARS) {
        // Só chega aqui se alguém mexer nas constantes de um jeito incoerente.
        // Melhor uma frase em português do que um 23514 vindo do Postgres.
        return {
          ok: false,
          motivo: "Não deu pra dividir esse documento em pedaços do tamanho certo.",
        };
      }
      const tokens = estimarTokens(conteudo);
      pedacos.push({ seq: pedacos.length, content: conteudo, tokens });
      totalTokens += tokens;

      if (pedacos.length > MAX_PEDACOS_POR_DOCUMENTO) {
        return {
          ok: false,
          motivo:
            `Esse documento vira mais de ${MAX_PEDACOS_POR_DOCUMENTO} pedaços, que é mais do ` +
            "que dá pra indexar de uma vez. Divida em partes e suba uma de cada vez.",
        };
      }
    }

    if (fim >= limpo.length) break;

    // O próximo pedaço começa um pouco ANTES de onde este terminou: é a
    // sobreposição.
    //
    // `Math.max(inicio + 1, …)` é a trava contra laço infinito. Sem ela, um
    // corte que caísse dentro da faixa de sobreposição faria o começo andar
    // PRA TRÁS — e o `while` giraria pra sempre montando o mesmo pedaço, com o
    // processo do site travado em 100% de CPU, não com um erro na tela.
    inicio = Math.max(inicio + 1, fim - CHUNK_SOBREPOSICAO_CHARS);
  }

  if (pedacos.length === 0) {
    return { ok: false, motivo: "Não achei texto nenhum aqui dentro." };
  }

  return { ok: true, pedacos, totalChars: limpo.length, totalTokens };
}
