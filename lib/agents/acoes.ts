/**
 * `ctx.acao` — A ÚNICA PORTA PRA AGIR.
 *
 * A ideia em uma frase: **agir não é uma coisa que a ferramenta faz; é uma
 * coisa que ela PEDE** — e quem decide se acontece é o motor.
 *
 * Em `modo = "ensaio"` nada sai daqui: a ação devolve `simulado: true` com o
 * que ela teria feito, e o passo do rastro é gravado marcado. O aluno lê o
 * rastro e liga o modo real quando estiver satisfeito.
 *
 * ⚠️ POR QUE UMA CAPACIDADE, E NÃO UMA DECLARAÇÃO NA FERRAMENTA. A primeira
 * versão do contrato desta onda pedia `age: true` no `ToolSpec`, conferido por
 * um teste que vasculha o código atrás de `fetch(` e `.insert(`. Isso é uma
 * guarda HEURÍSTICA sobre uma propriedade de SEGURANÇA: uma ferramenta que
 * chame um ajudante que por dentro faz `fetch` passa pelo grep e age em ensaio,
 * calada. É a mesma disciplina do `ctx.db` (regra 10-A): quem protege é não
 * existir outro caminho; o teste é rede.
 *
 * ⚠️ AS TRAVAS DE ENDEREÇO VALEM NOS DOIS MODOS. Em ensaio nada sai, mas a
 * recusa precisa aparecer na hora — senão o aluno liga o modo real achando que
 * o ensaio validou o endereço dele.
 *
 * ⚠️ A CONFERÊNCIA DE REDE INTERNA É FEITA SOBRE O TEXTO DO ENDEREÇO
 * (`acoes-url.ts`). Um nome de domínio que aponte pra `127.0.0.1` passa por
 * ela. `redirect: "error"` fecha o caminho do `302` pra dentro; a resolução de
 * nome antes do `fetch` fica registrada como limitação conhecida no contrato.
 *
 * ⚠️ O CORPO DA RESPOSTA NUNCA É MATERIALIZADO INTEIRO (correção da rodada 1).
 * A primeira versão desta função lia com `resposta.text()`, que decodifica o
 * corpo INTEIRO antes de qualquer corte — uma resposta de 40 MB colocava 40 MB
 * na memória antes do `TETO_DA_RESPOSTA_BYTES` entrar em ação. O processo Node
 * é COMPARTILHADO por todos os workspaces (é o mesmo processo que atende todo
 * mundo), e o container inteiro cai se ele morrer: um endereço de fora
 * devolvendo corpo gigante (ou infinito) não derrubaria só a execução de quem
 * chamou, derrubaria a plataforma pra todo mundo. Por isso `lerCorpoComTeto`
 * lê em pedaços pelo `ReadableStream`, soma BYTES (não `.length` de string,
 * que conta unidades UTF-16) e para assim que passa do teto — cancelando o
 * leitor E abortando a conexão, pra o servidor do outro lado parar de mandar
 * bytes que ninguém vai ler. Quando o `Content-Length` já anuncia um corpo
 * maior que o teto, a leitura nem começa.
 *
 * ⚠️ FALA COM O BANCO (grava o passo). Não importe de componente `"use client"`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ResendAdapter } from "@/lib/email/adapters/resend";
import { ResultadoDaAutomacao } from "@/lib/email/templates/resultado-da-automacao";
import { logError } from "@/lib/logger";
import { resolveEmailSender } from "@/lib/secrets";
import type { Database } from "@/types/supabase";
import { conferirEnderecoDeSaida, PRAZO_DA_ACAO_MS, TETO_DA_RESPOSTA_BYTES } from "./acoes-url";

export type ModoDeExecucao = "ensaio" | "real";

/**
 * A frase de quando não existe remetente pra mandar email neste workspace.
 *
 * Uma constante só, usada nos DOIS lugares que podem topar com essa falta:
 * `criarAcoes` (quando o teste/chamador não injeta `enviarEmail` nenhum) e
 * `criarAcoesDoMotor` (quando `resolveEmailSender` devolve `null` de
 * verdade, pra evitar duas cópias da mesma frase divergindo com o tempo.
 *
 * ⚠️ O CAMINHO É A TELA DA PLATAFORMA, NÃO A DO WORKSPACE. Até a revisão da
 * onda 7 esta frase mandava cadastrar o Resend em "Configurações →
 * Integrações" — e aquela tela não oferece o Resend DE PROPÓSITO (email é
 * coisa do app inteiro, não de um workspace; ver o topo de
 * `app/(app)/app/[orgSlug]/settings/integracoes/page.tsx`). O cartão do Resend
 * só existe em `/plataforma/configuracoes`, que só quem cuida do sistema
 * (`platform_admins`) abre — nem o dono do workspace enxerga aquela tela.
 * Mandar pedir pra "quem administra" o workspace era mandar pedir pra quem não
 * tem como resolver.
 */
export const MENSAGEM_EMAIL_NAO_CONFIGURADO =
  "O envio de email ainda não está ligado. Peça pra quem cuida do sistema cadastrar a chave " +
  "do Resend em Plataforma → Configurações — essa tela não aparece pra quem só administra o " +
  "workspace.";

/**
 * O que uma ação devolve. Em ensaio, `simulado: true` e nada aconteceu.
 *
 * `detalhe` aparece nos DOIS ramos de sucesso e quer dizer a mesma coisa nos
 * dois: **o que a ação fez, ou o que ela teria feito**. É ele que o rastro
 * escreve no aviso "✋ Ensaio" — ver `PassoDeAcao`, logo abaixo.
 */
export type ResultadoDeAcao =
  | { ok: true; simulado: false; detalhe?: string }
  | { ok: true; simulado: true; oQueEuFaria: Record<string, unknown>; detalhe?: string }
  | { ok: false; erro: string };

export type PedidoDeEmail = { para: string[]; assunto: string; corpo: string };

export type PedidoDeHttp = {
  metodo: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
};

export type Acoes = {
  email(p: PedidoDeEmail): Promise<ResultadoDeAcao>;
  http(p: PedidoDeHttp): Promise<ResultadoDeAcao>;
};

/**
 * O passo que vai pro rastro. Quem grava de verdade é quem passa `registrar`.
 *
 * `detalhe` é o que a ação fez **ou o que ela teria feito** — cortado no mesmo
 * tamanho do que já valia pro erro (500 caracteres). Em modo real ele é o id
 * da mensagem no email e o começo da resposta no http; em ensaio ele é a FRASE
 * EM PORTUGUÊS do que teria acontecido ("eu teria mandado um email para
 * chefe@empresa.com com o assunto …"), e é ela que o rastro escreve no aviso
 * "✋ Ensaio". Fica `null` só em erro (o que houve já mora em `erro`).
 *
 * ⚠️ ESSA SEMÂNTICA MUDOU NA REVISÃO DA ONDA 7, e a antiga era o defeito: em
 * ensaio o `detalhe` ficava `null` ("nada aconteceu de verdade pra
 * registrar"), então o rastro só sabia escrever "eu teria feito isso" — sem
 * dizer O QUÊ. Como ensaio é o PADRÃO (regra 10-L), essa é justamente a frase
 * que o aluno mais lê, e ela não informava nada.
 */
export type PassoDeAcao = {
  acao: "email" | "http";
  entrada: Record<string, unknown>;
  simulado: boolean;
  erro: string | null;
  detalhe: string | null;
  duracaoMs: number;
};

type Dependencias = {
  modo: ModoDeExecucao;
  organizationId: string;
  supabase?: SupabaseClient<Database>;
  /** Grava o passo no rastro. NUNCA pode lançar. */
  registrar: (p: PassoDeAcao) => Promise<void>;
  /** Injetável pra teste. Em produção, quem monta é `criarAcoesDoMotor`. */
  enviarEmail?: (
    p: PedidoDeEmail,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** Injetável pra teste. */
  buscar?: typeof fetch;
};

/** Quanto do que aconteceu (ou do erro) vai pro rastro. O resto é cortado. */
const TAMANHO_DETALHE_NO_RASTRO = 500;

const AVISO_DE_CORTE = "\n… (resposta cortada)";

/**
 * Quanto de um pedaço escrito pelo aluno (destinatário, assunto, endereço)
 * cabe DENTRO da frase do ensaio.
 *
 * É diferente de `TAMANHO_DETALHE_NO_RASTRO`, que corta a frase inteira lá no
 * fim: cortar aqui também é o que impede um assunto gigante de empurrar o
 * resto da frase pra fora e deixar a linha do rastro terminando no meio.
 */
const TAMANHO_DO_PEDACO_NA_FRASE = 80;

/** Junta tudo num espaço só e corta com reticências. */
function encurtar(texto: string, teto: number = TAMANHO_DO_PEDACO_NA_FRASE): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length <= teto ? limpo : `${limpo.slice(0, teto)}…`;
}

/**
 * O QUE EU TERIA FEITO, escrito em português, pra cada ação.
 *
 * O rastro desenha isso logo depois de "✋ Ensaio — ", então a frase começa em
 * minúscula e termina com ponto.
 */
function fraseDoEnsaioDeEmail(p: PedidoDeEmail): string {
  const destino = encurtar(p.para.join(", "));
  const assunto =
    p.assunto.trim() === "" ? ", sem assunto" : ` com o assunto "${encurtar(p.assunto)}"`;
  return `eu teria mandado um email para ${destino}${assunto}.`;
}

function fraseDoEnsaioDeHttp(p: PedidoDeHttp): string {
  return `eu teria chamado o sistema em ${encurtar(p.url, 160)} (${p.metodo}).`;
}

/**
 * O `fetch` do Node rejeita com nomes diferentes dependendo de QUEM abortou:
 * `AbortSignal.timeout()` estourando rejeita com `TimeoutError`; um
 * `AbortController.abort()` manual — inclusive o nosso, usado pra fechar a
 * conexão quando o teto de bytes estoura — rejeita com `AbortError`.
 * Confirmado rodando contra um servidor Node de verdade que nunca responde
 * (ver relatório da rodada 1). Tratamos os dois como "demorou demais": a
 * exceção do NOSSO abort por teto de bytes nunca chega aqui, porque
 * `lerCorpoComTeto` já para de ler e devolve normalmente nesse caso, sem
 * lançar.
 */
function ehErroDePrazo(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function montarTexto(pedacos: Uint8Array[]): string {
  const tamanho = pedacos.reduce((soma, p) => soma + p.byteLength, 0);
  const bytes = new Uint8Array(tamanho);
  let offset = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, offset);
    offset += pedaco.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Lê o corpo da resposta em pedaços, contando BYTES, e para assim que passar
 * do teto — sem nunca materializar o corpo inteiro na memória. Ver o aviso no
 * topo do arquivo pro porquê.
 *
 * Ao estourar o teto (ou quando o `Content-Length` já anuncia um corpo maior
 * que ele), cancela o leitor E aborta `travaDeTeto` — a MESMA trava que foi
 * combinada ao sinal do `fetch` — pra fechar a conexão de verdade em vez de
 * deixar o servidor do outro lado continuar mandando bytes que ninguém vai
 * ler.
 */
async function lerCorpoComTeto(
  resposta: Response,
  tetoBytes: number,
  travaDeTeto: AbortController,
): Promise<{ texto: string; cortou: boolean }> {
  // O servidor já avisou que é maior que o teto: nem começa a ler.
  const tamanhoAnunciado = resposta.headers.get("content-length");
  if (tamanhoAnunciado !== null && Number(tamanhoAnunciado) > tetoBytes) {
    await resposta.body?.cancel().catch(() => {});
    travaDeTeto.abort();
    return { texto: "", cortou: true };
  }

  const leitor = resposta.body?.getReader();
  if (!leitor) return { texto: "", cortou: false };

  const pedacos: Uint8Array[] = [];
  let bytesLidos = 0;

  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;

    if (bytesLidos + value.byteLength > tetoBytes) {
      const faltam = tetoBytes - bytesLidos;
      if (faltam > 0) pedacos.push(value.subarray(0, faltam));
      await leitor.cancel().catch(() => {});
      travaDeTeto.abort();
      return { texto: montarTexto(pedacos), cortou: true };
    }

    pedacos.push(value);
    bytesLidos += value.byteLength;
  }

  return { texto: montarTexto(pedacos), cortou: false };
}

export function criarAcoes(dep: Dependencias): Acoes {
  const ensaio = dep.modo === "ensaio";

  async function comRastro(
    acao: "email" | "http",
    entrada: Record<string, unknown>,
    fazer: () => Promise<ResultadoDeAcao>,
  ): Promise<ResultadoDeAcao> {
    const inicio = Date.now();
    let saida: ResultadoDeAcao;
    try {
      saida = await fazer();
    } catch (err) {
      logError("agents/acoes", err);
      saida = { ok: false, erro: "Não deu pra completar essa ação agora." };
    }

    // Vale pros DOIS ramos de sucesso: em modo real é o que aconteceu, em
    // ensaio é o que TERIA acontecido. Ver `PassoDeAcao`.
    let detalhe: string | null = null;
    if (saida.ok && saida.detalhe) {
      detalhe = saida.detalhe.slice(0, TAMANHO_DETALHE_NO_RASTRO);
    }

    // Gravar o rastro NUNCA derruba a ação: o passo é histórico, não decisão.
    try {
      await dep.registrar({
        acao,
        entrada,
        simulado: saida.ok ? saida.simulado : false,
        erro: saida.ok ? null : saida.erro,
        detalhe,
        duracaoMs: Date.now() - inicio,
      });
    } catch (err) {
      logError("agents/acoes/registrar", err);
    }
    return saida;
  }

  return {
    async email(p) {
      const entrada = { para: p.para, assunto: p.assunto };
      return comRastro("email", entrada, async () => {
        if (p.para.length === 0) {
          return { ok: false, erro: "Não dá pra mandar email sem dizer pra quem." };
        }
        if (ensaio) {
          return {
            ok: true,
            simulado: true,
            oQueEuFaria: { ...entrada, corpo: p.corpo },
            detalhe: fraseDoEnsaioDeEmail(p),
          };
        }
        if (!dep.enviarEmail) {
          return { ok: false, erro: MENSAGEM_EMAIL_NAO_CONFIGURADO };
        }
        const r = await dep.enviarEmail(p);
        return r.ok ? { ok: true, simulado: false, detalhe: r.id } : { ok: false, erro: r.error };
      });
    },

    async http(p) {
      const entrada = { metodo: p.metodo, url: p.url };
      return comRastro("http", entrada, async () => {
        // As travas valem nos DOIS modos — ver o aviso no topo.
        const alvo = conferirEnderecoDeSaida(p.url);
        if (!alvo.ok) return { ok: false, erro: alvo.erro };

        if (ensaio) {
          return {
            ok: true,
            simulado: true,
            oQueEuFaria: { ...entrada, corpo: p.corpo },
            detalhe: fraseDoEnsaioDeHttp(p),
          };
        }

        const buscar = dep.buscar ?? fetch;
        const relogio = AbortSignal.timeout(PRAZO_DA_ACAO_MS);
        // Trava própria: some ao sinal do prazo, e é ELA que a leitura em
        // pedaços aciona se o teto de bytes estourar — assim a conexão fecha
        // de verdade, não só o nosso laço de leitura.
        const travaDeTeto = new AbortController();

        let resposta: Response;
        let cortou: boolean;
        let texto: string;
        try {
          resposta = await buscar(alvo.url, {
            method: p.metodo,
            redirect: "error", // 302 pra dentro da rede fecha aqui
            signal: AbortSignal.any([relogio, travaDeTeto.signal]),
            headers: {
              ...(p.corpo === undefined ? {} : { "content-type": "application/json" }),
              ...p.cabecalhos,
            },
            body: p.corpo === undefined ? undefined : JSON.stringify(p.corpo),
          });
          ({ texto, cortou } = await lerCorpoComTeto(
            resposta,
            TETO_DA_RESPOSTA_BYTES,
            travaDeTeto,
          ));
        } catch (err) {
          if (ehErroDePrazo(err)) {
            return {
              ok: false,
              erro: "O sistema não respondeu a tempo. Vale tentar de novo daqui a pouco.",
            };
          }
          throw err;
        }

        const cortado = cortou ? `${texto}${AVISO_DE_CORTE}` : texto;

        if (!resposta.ok) {
          return {
            ok: false,
            erro: `O sistema respondeu com erro ${resposta.status}. Resposta: ${cortado.slice(0, TAMANHO_DETALHE_NO_RASTRO)}`,
          };
        }
        return { ok: true, simulado: false, detalhe: cortado };
      });
    },
  };
}

/**
 * O `ctx.acao` de VERDADE — o que o motor monta em toda execução (onda 7,
 * task 4). `criarAcoes` (acima) é o mecanismo genérico e testável sem rede;
 * esta função é o único ponto que resolve dependências reais: o remetente de
 * email do workspace e o `fetch` do runtime (por injeção padrão em `criarAcoes`).
 *
 * ⚠️ `resolveEmailSender`, NÃO `getEmailProvider` (correção da rodada 2).
 * `getEmailProvider` (`lib/email/index.ts`) devolve um `ConsoleAdapter` de
 * FALLBACK quando não existe chave cadastrada — e esse adapter responde
 * `{ ok: true, id: "console-..." }` sem mandar nada de verdade. Isso é CERTO
 * pro caminho de convite (onde só quem administra vê o registro do servidor
 * e sabe copiar o link), mas seria uma MENTIRA aqui: o rastro gravaria
 * `simulado: false` com um id de sucesso, o modelo leria isso como "mandei o
 * email" e diria isso pro aluno — mesmo em modo REAL, sem chave nenhuma
 * cadastrada. `resolveEmailSender` devolve `null` quando não há chave, e é
 * ESSE `null` que vira o erro explícito abaixo, em vez de um sucesso forjado.
 *
 * ⚠️ RESOLVIDO SOB DEMANDA, dentro de `enviarEmail`, na primeira vez que a
 * ferramenta manda um email. Resolver adiantado custaria uma ida ao cofre em
 * TODA execução de TODO agente, e a imensa maioria delas não manda email
 * nenhum.
 *
 * ⚠️ `organizationId` e `supabase` são usados aqui (é com eles que
 * `resolveEmailSender` acha a chave certa — workspace → plataforma →
 * variável de ambiente). NÃO recebe `runId`: quem grava o passo no rastro é
 * o `registrar` que o motor injeta, e o `recorder` já fecha sobre o `runId`
 * dele mesmo (`recorder.recordAcaoStep`) — `criarAcoes` nunca precisou desse
 * dado.
 */
export function criarAcoesDoMotor(p: {
  modo: ModoDeExecucao;
  organizationId: string;
  supabase: SupabaseClient<Database>;
  registrar: (passo: PassoDeAcao) => Promise<void>;
}): Acoes {
  return criarAcoes({
    ...p,
    enviarEmail: async (pedido) => {
      const remetente = await resolveEmailSender({
        organizationId: p.organizationId,
        supabase: p.supabase,
      });
      if (!remetente) return { ok: false, error: MENSAGEM_EMAIL_NAO_CONFIGURADO };

      const provedor = new ResendAdapter(remetente.apiKey, remetente.from);
      // Um email por destinatário: o adaptador (`EmailProvider.send`) aceita
      // só um `to`, e mandar todo mundo em cópia (`cc`) exporia o endereço de
      // um cliente pro outro — o mesmo cuidado de `lib/invitations`.
      const resultados = await Promise.all(
        pedido.para.map((to) =>
          provedor.send({
            to,
            subject: pedido.assunto,
            react: ResultadoDaAutomacao({ corpo: pedido.corpo }),
          }),
        ),
      );
      const falhou = resultados.find((r) => !r.ok);
      if (falhou && !falhou.ok) return { ok: false, error: falhou.error };
      // `pedido.para` já foi conferido como não-vazio por `criarAcoes` antes
      // de chegar aqui, então `resultados[0]` sempre existe — mas o tipo do
      // array não sabe disso, daí a checagem `primeiro?.ok` de sobra.
      const primeiro = resultados[0];
      return { ok: true, id: primeiro?.ok ? primeiro.id : "" };
    },
  });
}
