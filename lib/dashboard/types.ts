/**
 * Os tipos do INÍCIO — a primeira tela de dentro do workspace.
 *
 * Arquivo PURO e só de tipos: pode ser importado por página, por componente
 * com "use client" e por teste.
 *
 * ⚠️ DINHEIRO CONTINUA SENDO INTEIRO, EM MICRO-DÓLARES, e quem escreve na tela
 * é `lib/format.ts`. Nada aqui guarda texto de dinheiro pronto.
 */

/** Cada degrau da lista "o que falta pra isso funcionar". */
export type PassoId = "chave" | "agente" | "conversa" | "teto" | "documento" | "email";

/**
 * Um degrau.
 *
 * ⚠️ `acao` é `null` QUANDO ESSA PESSOA NÃO PODE FAZER ESSE PASSO, e nesse
 * caso `recado` diz o que ela faz em vez disso. Não é enfeite: cadastrar chave
 * e definir teto são de dono/administrador, e um botão que leva pra uma tela
 * que chuta a pessoa de volta é pior do que botão nenhum.
 */
export type ProximoPasso = {
  id: PassoId;
  titulo: string;
  /** Por que isso importa, em uma frase. */
  explicacao: string;
  feito: boolean;
  acao: { rotulo: string; href: string } | null;
  recado: string | null;
};

/** "Quantas execuções rolaram, e quantas deram errado." */
export type ResumoDeExecucoes = {
  total: number;
  falhas: number;
};

/** Uma linha de "o que vai rodar sozinho daqui a pouco". */
export type ProximaAutomacao = {
  id: string;
  nome: string;
  agenteNome: string;
  /** ISO. `null` = ligada, mas sem próxima hora calculada ainda. */
  proximaEm: string | null;
};
