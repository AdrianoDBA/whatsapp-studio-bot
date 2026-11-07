/**
 * O TEXTO DA SUA PÁGINA DE ENTRADA (a landing).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  É AQUI QUE VOCÊ MEXE.                                               │
 * │  Troque as frases deste arquivo e a página inteira muda. Você não    │
 * │  precisa abrir nenhum outro arquivo — nem saber programar.           │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Essa é a primeira página que qualquer pessoa vê no seu endereço, ANTES de
 * entrar. Depois que ela cria conta e entra, quem manda é o app.
 *
 * O texto que já vem escrito aqui descreve, de verdade, o que este app faz no
 * primeiro dia: um lugar onde você monta agentes de IA que respondem pelos
 * seus documentos e trabalham sozinhos. Se você publicar sem mexer em nada,
 * não vai estar prometendo nada que o app não faça — mas o objetivo é você
 * trocar por **o seu negócio**.
 *
 * ⚠️ O NOME DO APP NÃO ESTÁ AQUI. Ele mora em `config/app.config.ts`, num
 * lugar só, porque aparece também na aba do navegador, nos emails e no
 * cabeçalho. Mude lá e muda em todos os lugares de uma vez.
 *
 * ⚠️ NÃO PROMETA O QUE O APP NÃO FAZ. Parece óbvio, mas é o erro mais fácil
 * de cometer numa página dessas: você escreve "integração com WhatsApp" porque
 * soa bem, alguém cria conta por causa disso e não acha em lugar nenhum. Cada
 * item de `funcionalidades` abaixo aponta pra uma tela que existe.
 */

/** Um dos seis quadrinhos do meio da página. */
export type FuncionalidadeDaLanding = {
  /** A etiquetinha cinza do canto. Uma palavra, minúscula. */
  etiqueta: string;
  /** Nome do ícone, da lista de `ICONES_DA_LANDING` (logo abaixo do config). */
  icone: NomeDeIcone;
  titulo: string;
  descricao: string;
};

/** Os ícones que você pode usar em `funcionalidades`. */
export type NomeDeIcone =
  | "robo"
  | "livro"
  | "relogio"
  | "medidor"
  | "pessoas"
  | "raio"
  | "cadeado"
  | "grafico";

export const landingConfig = {
  /**
   * O TOPO DA PÁGINA — a primeira coisa que a pessoa lê.
   *
   * Uma regra que vale ouro aqui: escreva o que a pessoa GANHA, não o que o
   * programa TEM. "Seu atendimento responde sozinho" é o ganho. "Plataforma
   * de agentes conversacionais" é o que o programa tem, e não diz nada pra
   * quem chegou agora.
   */
  hero: {
    /** A pílula pequena acima do título. Curta. */
    selo: "Atendimento com IA",

    /** A primeira linha do título grande. */
    titulo: "Seu atendimento",

    /** A segunda linha, que sai destacada em verde. */
    destaque: "responde sozinho.",

    /** Duas ou três linhas explicando. Sem jargão. */
    subtitulo:
      "Suba os seus documentos, descreva em português o que o agente deve fazer, e " +
      "ele atende pelo seu negócio — na conversa, na hora marcada ou chamado por outro sistema.",

    /** O texto do botão principal. Ele leva pra tela de criar conta. */
    botaoPrincipal: "Começar agora",

    /** O texto do botão discreto do lado. Leva pro login. */
    botaoSecundario: "Já tenho conta",
  },

  /** Os dois botõezinhos do canto superior direito. */
  navegacao: {
    entrar: "Entrar",
    criarConta: "Começar",
  },

  /**
   * O EXEMPLO DE CONVERSA que aparece logo abaixo do título.
   *
   * ⚠️ ELE APARECE COM A PALAVRA "EXEMPLO" NA TELA, e isso não é opcional.
   * Uma tela de mentira sem aviso é a coisa mais fácil de fazer numa landing e
   * a mais cara de consertar depois: a pessoa cria conta esperando aquilo,
   * entra, vê outra coisa e vai embora. Se você trocar as frases, troque por
   * algo que o SEU agente realmente responderia.
   */
  exemplo: {
    /** O endereço que aparece na barrinha da janela. Só enfeite. */
    endereco: "app.seu-dominio.com.br",
    pergunta: "Qual o prazo de garantia do produto?",
    resposta:
      "São 12 meses a partir da data da compra. Defeito de fabricação é trocado sem custo; " +
      "mau uso não entra na garantia.",
    /** De onde o agente tirou a resposta. É assim que ele responde de verdade. */
    fonte: "Manual do Cliente · capítulo 4",
  },

  /**
   * A ESTEIRA que passa deslizando entre o topo e os quadrinhos.
   *
   * Antes eram os nomes das ferramentas de programação (next.js, tailwind…) —
   * coisa que interessa a quem programa, não a quem vai usar o seu produto.
   * Agora é uma lista do que dá pra pedir. Troque pelos pedidos do seu ramo.
   */
  esteira: [
    "responder dúvida de cliente",
    "resumir um documento longo",
    "triar pedido que chegou",
    "escrever a resposta de um email",
    "avisar quando algo sair do normal",
    "montar o relatório de toda segunda",
  ],

  /**
   * OS SEIS QUADRINHOS DO MEIO.
   *
   * Cada um responde "o que eu ganho com isso?". Todos apontam pra uma tela
   * que existe de verdade neste app — veja o aviso do topo do arquivo.
   */
  secaoFuncionalidades: {
    /** A etiquetinha em cima do título. */
    selo: "o que dá pra fazer",
    titulo: "Tudo que ele já sabe fazer.",
  },

  funcionalidades: [
    {
      etiqueta: "agentes",
      icone: "robo",
      titulo: "Você descreve, ele faz",
      descricao:
        "Escreva em português o que o agente deve fazer e como deve falar. Sem programar, " +
        "sem configurar nada complicado.",
    },
    {
      etiqueta: "documentos",
      icone: "livro",
      titulo: "Responde pelos seus documentos",
      descricao:
        "Suba manuais, tabelas de preço, contratos. O agente procura a resposta neles e diz " +
        "de onde tirou — em vez de inventar.",
    },
    {
      etiqueta: "sozinho",
      icone: "relogio",
      titulo: "Trabalha fora do horário",
      descricao:
        "Toda segunda às 8h, ou quando outro sistema chamar. Ele roda sem ninguém estar na " +
        "frente do computador.",
    },
    {
      etiqueta: "gasto",
      icone: "medidor",
      titulo: "Você decide quanto pode gastar",
      descricao:
        "Um teto por mês e por dia. Chegou no limite, para sozinho — e você vê, dia a dia, " +
        "quanto cada coisa custou.",
    },
    {
      etiqueta: "times",
      icone: "pessoas",
      titulo: "Um espaço por cliente ou time",
      descricao:
        "Cada espaço tem os próprios documentos, agentes e membros. O que é de um não " +
        "aparece no outro, nunca.",
    },
    {
      etiqueta: "rastro",
      icone: "grafico",
      titulo: "Dá pra ver o que ele fez",
      descricao:
        "Cada resposta guarda o passo a passo: o que ele consultou, o que achou e quanto " +
        "custou. Sem caixa-preta.",
    },
  ] satisfies FuncionalidadeDaLanding[],

  /**
   * O ÚLTIMO EMPURRÃO, lá embaixo, antes do rodapé.
   *
   * ⚠️ REPARE QUE NÃO TEM PROMESSA DE PREÇO AQUI. A primeira versão deste
   * texto dizia "de graça" — e é o tipo de frase que o aluno publicaria sem
   * perceber que ela é dele agora, não do template. Se você for cobrar, essa
   * palavra vira um problema logo no primeiro cliente. Diga o que acontece
   * ("sua primeira resposta em minutos"), não quanto custa.
   */
  chamadaFinal: {
    selo: "pronto?",
    titulo: "Sua primeira resposta,",
    destaque: "em minutos.",
    subtitulo:
      "Crie sua conta, suba um documento e pergunte. O agente responde com o que estiver " +
      "escrito nele — e diz de qual trecho tirou.",
    botao: "Criar minha conta",
  },

  /**
   * O PAINEL DAS TELAS DE ENTRAR E CRIAR CONTA.
   *
   * É a faixa da direita que aparece no /login e no /signup. Ela não é a
   * landing, mas é lida pela mesma pessoa, no mesmo minuto — então vale a
   * mesma disciplina do resto deste arquivo.
   *
   * ⚠️ ELA JÁ MENTIU DE TRÊS JEITOS, E NENHUM QUEBRAVA NADA. O texto ficava
   * escrito na mão dentro de `app/(auth)/layout.tsx`, então passou batido nas
   * duas limpezas da landing:
   *   1. mandava rodar `npm run setup`, comando que NUNCA existiu no
   *      package.json — quem copiasse via um erro e achava que tinha quebrado
   *      o projeto;
   *   2. anunciava um placar inventado ("Migrations 13" quando são 50,
   *      "Slash cmds 3" quando não existe nenhum);
   *   3. escrevia o nome do app na mão, então renomear o app deixava o nome
   *      velho aqui.
   *
   * Por isso: comando só se ele existir de verdade no package.json, e nada de
   * número solto. `tests/landing-config.test.ts` monta guarda nos três.
   */
  paginasDeEntrada: {
    titulo: "Construa seu SaaS",
    /** A segunda linha do título, em destaque. */
    destaque: "como um time de 10.",
    subtitulo:
      "Agentes de IA, base de conhecimento e automações já vêm prontos. Você descreve em " +
      "português, o Claude Code constrói.",
    /**
     * O terminalzinho. ⚠️ Cada `comando` tem que existir de verdade em
     * `package.json` — é o que o teste confere.
     */
    terminal: [
      { comando: "npm install", resultado: "tudo instalado" },
      { comando: "npm run dev", resultado: "rodando em http://localhost:3000" },
    ],
    /**
     * O quadro de baixo: o que o app já faz no primeiro dia. Cada item aponta
     * pra uma tela que existe — nada de número, que envelhece sozinho.
     */
    jaVemPronto: ["Agentes de IA", "Base de conhecimento", "Automações", "Teto de gasto"],
  },

  /**
   * O RODAPÉ.
   *
   * ⚠️ NÃO ESCREVA UMA LICENÇA AQUI SE NÃO EXISTIR UM ARQUIVO `LICENSE` NO
   * PROJETO. A versão antiga desta página dizia "MIT" sem que existisse
   * licença nenhuma no repositório — dizer isso na cara do usuário é uma
   * afirmação jurídica, não um enfeite de rodapé.
   */
  rodape: {
    /** Aparece do lado esquerdo, depois do nome do app. */
    esquerda: "feito pra atender melhor",
    /** Aparece do lado direito. */
    direita: "construído com claude code",
  },
} as const;

export type LandingConfig = typeof landingConfig;
