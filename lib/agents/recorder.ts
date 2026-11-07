/**
 * O RASTRO da execução: quem grava `agent_runs` e `agent_run_steps`.
 *
 * Por que isso existe: agente sem rastro é caixa-preta, e leigo não depura
 * caixa-preta. Quando o agente faz besteira, o aluno precisa abrir a execução
 * e ver **em que passo**, **com que entrada**, **quanto custou** e **qual foi o
 * erro** — em português.
 *
 * Três regras deste arquivo:
 *
 * 1. **Gravar rastro NUNCA derruba a execução.** `recordModelStep` e
 *    `recordToolStep` engolem o próprio erro (e registram com `logError`). Um
 *    agente que já respondeu certo não pode falhar porque a linha do rastro
 *    não entrou.
 * 2. **`error_message` já vai em PT-BR leigo.** A tela mostra cru. Quem traduz
 *    é o motor, aqui — nunca a tela, e nunca o Postgres.
 * 3. **Custo desconhecido é `null`, nunca `0`.** Zero significa "custou zero
 *    mesmo". Ver `lib/ai/cost.ts`.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StepResult, ToolSet } from "ai";
import { calcCostMicrosById, extractProviderCostMicros } from "@/lib/ai/cost";
import { logError } from "@/lib/logger";
import type { Database, Json } from "@/types/supabase";
// Só o TIPO do passo de ação (onda 7, task 4). Quem MONTA o `ctx.acao` de
// verdade é `criarAcoesDoMotor`, no motor — este arquivo só grava o que ele
// manda registrar.
import type { ModoDeExecucao, PassoDeAcao } from "./acoes";
import type { AgentRunStatus, AgentTriggerKind } from "./types";

/**
 * Teto de tamanho do que é gravado em `input`/`output` de um passo.
 *
 * O rastro serve pra diagnosticar, não pra ser um segundo banco de dados. Uma
 * ferramenta que devolve 2 MB de JSON encheria a tabela e deixaria a tela de
 * execuções lenta pra todo mundo do workspace.
 */
const MAX_STEP_JSON_CHARS = 20_000;

/**
 * Converte qualquer coisa num valor que cabe numa coluna `jsonb`.
 *
 * Best-effort de propósito: valor que não vira JSON (função, referência
 * circular, `BigInt`) não pode derrubar a gravação do rastro.
 */
function paraJson(valor: unknown): Json {
  if (valor === undefined) return null;
  let texto: string;
  try {
    texto = JSON.stringify(valor) ?? "null";
  } catch {
    return { aviso: "não deu pra guardar esse valor no rastro" };
  }
  if (texto.length > MAX_STEP_JSON_CHARS) {
    return {
      truncado: true,
      tamanho: texto.length,
      inicio: texto.slice(0, MAX_STEP_JSON_CHARS),
    };
  }
  // `JSON.parse` devolve `any`; a asserção aqui é o único ponto do arquivo em
  // que isso acontece, e o valor acabou de sair de um `JSON.stringify`.
  return JSON.parse(texto) as Json;
}

/** Número de token que veio do provedor, ou `null` quando ele não mandou. */
function tokensOuNulo(valor: number | undefined): number | null {
  return typeof valor === "number" && Number.isFinite(valor)
    ? Math.max(0, Math.trunc(valor))
    : null;
}

export type RunRecorder = {
  readonly runId: string;
  /**
   * Marca o começo de um passo de modelo: liga o cronômetro e RESERVA o
   * número do passo, pra fala do modelo aparecer antes das ferramentas que
   * ela pediu. Chamado pelo motor no `experimental_onStepStart`.
   */
  markModelStepStart(): void;
  /** Grava um passo `kind = 'model'`. NUNCA lança. */
  recordModelStep(step: StepResult<ToolSet>): Promise<void>;
  /**
   * Quanto esta execução já custou, somando os passos de modelo JÁ VISTOS, em
   * micro-dólares. `null` = algum passo ficou sem preço (modelo fora do
   * catálogo), e aí não existe soma honesta pra devolver.
   *
   * ⚠️ É MEMÓRIA, NÃO BANCO. É isto que deixa o teto por execução (o "momento
   * B" do teto de gasto) parar o laço sem uma consulta por passo. O número
   * definitivo continua sendo o que `finish_agent_run` soma do rastro.
   *
   * ⚠️ A conta é atualizada na hora em que `recordModelStep` é CHAMADO, antes
   * de ela ir ao banco. Isso importa no chat, onde a gravação não é esperada:
   * quando o laço pergunta "já passou do teto?", o passo que acabou de
   * terminar já está na soma.
   */
  custoAcumuladoMicros(): number | null;
  /**
   * Grava um passo `kind = 'tool'`. NUNCA lança.
   *
   * ⚠️ `simulado` desta linha É SEMPRE `false` — mesmo pra uma ferramenta que
   * AGE (`mandar-email`, com `age: true`) rodando numa execução em ensaio. Não
   * é bug: quando essa ferramenta chama `ctx.acao.email(...)`, a AÇÃO em si
   * grava a SUA PRÓPRIA linha por `recordAcaoStep` (abaixo), com
   * `tool_name = "acao:email"` e `simulado` correto. Ou seja, um envio de
   * email em ensaio grava DUAS linhas no rastro: esta aqui (`mandar-email`,
   * `simulado: false`) e a dela (`acao:email`, `simulado: true`) — e é a
   * segunda que carrega a verdade sobre o que foi simulado.
   *
   * Consequência pra quem filtra ou conta por esta coluna: **filtrar por
   * `tool_name = "mandar-email" AND simulado = true` sempre dá zero**, mesmo
   * numa automação inteira em ensaio. Pra saber se uma AÇÃO foi simulada,
   * filtre pelo `tool_name` que começa com `"acao:"` (ou, mais simples, leia
   * `agent_runs.modo` — é o mesmo dado, sem precisar olhar passo por passo).
   * Isso não é mentira na tela: o `<RunTrace>` já lê o `simulado` da linha
   * `acao:*`, nunca o desta. É só a coluna, isolada, que soa contraditória.
   */
  recordToolStep(params: {
    toolName: string;
    input: unknown;
    output: unknown;
    /** JÁ em PT-BR leigo, ou `null` quando deu certo. */
    errorMessage: string | null;
    durationMs: number;
  }): Promise<void>;
  /**
   * Grava um passo de AÇÃO (`kind = 'tool'`, `tool_name = "acao:email"` ou
   * `"acao:http"`, com `simulado`). NUNCA lança — mesma garantia de
   * `recordToolStep`.
   *
   * Quem CHAMA isto é `criarAcoes` (`lib/agents/acoes.ts`), não a ferramenta:
   * assim `simulado` nunca depende de a ferramenta lembrar de gravar certo.
   *
   * ⚠️ É A ÚNICA FONTE DE VERDADE PRA `simulado = true` NO RASTRO INTEIRO.
   * `recordToolStep` (acima) grava sempre `false`, mesmo pra ferramenta que
   * chama `ctx.acao` por dentro — ver o aviso lá.
   *
   * ⚠️ USA O MESMO CONTADOR `proximoSeq` das ferramentas e dos passos de
   * modelo. Um contador separado faria o rastro sair fora de ordem — e o
   * `<RunTrace>` não reordena, só desenha na ordem que o `seq` mandar.
   */
  recordAcaoStep(p: PassoDeAcao): Promise<void>;
};

/**
 * Abre a linha da execução em `agent_runs`, ANTES de o agente rodar.
 *
 * Isso é de propósito: se o modelo estourar, a chave estiver faltando ou o
 * container cair no meio, a execução já existe e a tela consegue mostrar o que
 * aconteceu. Criar a linha só no fim faria toda falha virar silêncio.
 */
export async function createRun(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  agentId: string | null;
  agentSlug: string;
  triggeredBy: string;
  triggerKind: AgentTriggerKind;
  input: Json;
  model: string;
  /**
   * A conversa dona desta execução, quando o gatilho foi o chat.
   *
   * `undefined` / `null` = a execução não veio de conversa nenhuma (botão
   * "rodar", agendamento, webhook). A coluna aceita nulo justamente por isso.
   */
  threadId?: string | null;
  /**
   * O modo desta execução, GRAVADO NA LINHA (onda 7).
   *
   * ⚠️ É ISTO que conserta o defeito mais grave da onda: em ensaio o modelo
   * ANUNCIA que mandou o email (medido no navegador — ele ignora o
   * `{"ensaio":true}` que a ferramenta devolve, e ainda por cima só às vezes,
   * que é pior). Antes disso o único sinal de ensaio era
   * `agent_run_steps.simulado`, que só existe quando o agente AGIU: execução
   * em ensaio que não agiu — o caso mais comum — ficava indistinguível de uma
   * real, e nenhuma tela tinha de onde tirar um selo.
   *
   * Obrigatório de propósito: com `?`, o caminho que esquecesse de passar
   * gravaria "real" em silêncio, que é exatamente a mentira a evitar.
   */
  modo: ModoDeExecucao;
}): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const { data, error } = await params.supabase
    .from("agent_runs")
    .insert({
      organization_id: params.organizationId,
      agent_id: params.agentId,
      agent_slug: params.agentSlug,
      // A policy de INSERT do banco exige `auth.uid() = triggered_by`: não dá
      // pra abrir execução no nome de outra pessoa.
      triggered_by: params.triggeredBy,
      trigger_kind: params.triggerKind,
      input: params.input,
      model: params.model,
      thread_id: params.threadId ?? null,
      modo: params.modo,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    logError("agents/createRun", error);
    return {
      ok: false,
      error:
        "Não deu pra abrir essa execução agora. Tente de novo em alguns segundos — " +
        "se continuar, pode ser que você não faça mais parte desse workspace.",
    };
  }

  return { ok: true, runId: data.id };
}

/**
 * Monta o gravador de passos daquela execução.
 *
 * O `seq` é um contador em memória, síncrono: mesmo com duas ferramentas
 * rodando ao mesmo tempo, dois passos nunca pegam o mesmo número. O que ele
 * NÃO garante é ordem no relógio — ver o RESÍDUO-9 do contrato e o comentário
 * da coluna `seq` na migration.
 */
export function createRecorder(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  runId: string;
  /**
   * `"provedor:modelo"` desta execução.
   *
   * DIFERENÇA EM RELAÇÃO AO CONTRATO: ele não listava este campo. Sem ele não
   * existe custo por passo — o `step.model.modelId` que o AI SDK entrega é o
   * apelido dentro do provedor (`"anthropic/claude-sonnet-5"`), e o catálogo
   * de preço é indexado pelo identificador completo
   * (`"openrouter:anthropic/claude-sonnet-5"`). E custo por passo é
   * justamente a coluna que o contrato mandou acrescentar (delta 1.1-a).
   */
  modelId: string;
}): RunRecorder {
  // `organizationId` não é mais desempacotado: quem descobre o workspace do
  // passo agora é a função `record_agent_run_step`, a partir da própria
  // execução. Mandar daqui seria dar ao chamador a chance de mentir.
  const { supabase, runId, modelId } = params;

  let proximoSeq = 0;
  let inicioDoPassoDeModelo: number | null = null;
  /**
   * O `seq` que o passo de modelo RESERVOU quando começou.
   *
   * Isso importa: o AI SDK só avisa que o passo de modelo terminou DEPOIS de
   * rodar as ferramentas que ele pediu. Sem reserva, o rastro sairia com a
   * ferramenta na frente da fala do modelo que a pediu — de trás pra frente
   * pra quem for ler.
   */
  let seqReservadoDoModelo: number | null = null;

  /**
   * A soma do que os passos de modelo já custaram, EM MEMÓRIA.
   *
   * `algumPassoSemPreco` existe porque somar um passo desconhecido como zero
   * seria mentir: o teto por execução acharia que a execução está barata
   * justamente quando ninguém sabe quanto ela custa.
   */
  let custoAcumulado = 0;
  let algumPassoSemPreco = false;

  async function gravar(linha: {
    seq: number;
    kind: "model" | "tool";
    toolName: string | null;
    input: Json;
    output: Json;
    errorMessage: string | null;
    durationMs: number | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    costMicros: number | null;
    /**
     * `true` só pra um passo de AÇÃO em modo ensaio (nada saiu de verdade).
     * Passo de modelo e de ferramenta comum são sempre reais — por isso
     * `recordModelStep`/`recordToolStep` chamam `gravar` com `false` aqui.
     */
    simulado: boolean;
  }): Promise<void> {
    // Grava POR FUNÇÃO, não por insert direto: a permissão de escrever nesta
    // tabela foi revogada.
    //
    // POR QUÊ: `finish_agent_run` soma estas linhas pra apurar o custo da
    // execução, e esse número vira o teto de gasto. Enquanto qualquer membro
    // podia inserir aqui, dava pra gravar "custei US$ 999" e travar os agentes
    // do workspace inteiro até virar o mês — foi reproduzido. Agora a função
    // confere de quem é a execução e limita quanto um passo pode custar.
    //
    // ⚠️ `_simulado` É PARÂMETRO NOVO (onda 7, task 4) — ver a migration
    // `20260821120000_rastro_marca_passo_simulado.sql`. A coluna `simulado` já
    // existia (task 1) mas ninguém escrevia nela: sem o parâmetro aqui, todo
    // passo de ação sairia com `simulado = false` (o padrão da coluna) mesmo
    // em ensaio, e o rastro mentiria justamente sobre a única coisa que ele
    // existe pra avisar.
    const { error } = await supabase.rpc("record_agent_run_step", {
      _run_id: runId,
      _seq: linha.seq,
      _kind: linha.kind,
      _tool_name: linha.toolName ?? undefined,
      _input: linha.input ?? undefined,
      _output: linha.output ?? undefined,
      _error_message: linha.errorMessage ?? undefined,
      _duration_ms: linha.durationMs ?? undefined,
      _tokens_input: linha.tokensInput ?? undefined,
      _tokens_output: linha.tokensOutput ?? undefined,
      _cost_micros: linha.costMicros ?? undefined,
      _simulado: linha.simulado,
    });
    if (error) {
      // Rastro que não gravou não pode derrubar um agente que respondeu certo.
      logError("agents/recordStep", error);
    }
  }

  return {
    runId,

    markModelStepStart() {
      inicioDoPassoDeModelo = Date.now();
      seqReservadoDoModelo = proximoSeq++;
    },

    async recordModelStep(step: StepResult<ToolSet>): Promise<void> {
      try {
        const duracao = inicioDoPassoDeModelo === null ? null : Date.now() - inicioDoPassoDeModelo;
        inicioDoPassoDeModelo = null;
        // Sem reserva (se o aviso de início do passo sumir num patch do AI
        // SDK), o passo entra no fim da fila. Nada quebra: só a ordem do
        // rastro fica menos bonita.
        const seq = seqReservadoDoModelo ?? proximoSeq++;
        seqReservadoDoModelo = null;

        const entrada = tokensOuNulo(step.usage.inputTokens);
        const saida = tokensOuNulo(step.usage.outputTokens);

        // Verdade do provedor ganha de preço decorado: quando o OpenRouter diz
        // quanto custou, é esse número que vale.
        const custoDoProvedor = extractProviderCostMicros(step.usage);
        const custoDaTabela = calcCostMicrosById(modelId, {
          input: step.usage.inputTokens,
          output: step.usage.outputTokens,
        });
        const custo = custoDoProvedor ?? custoDaTabela?.totalMicros ?? null;

        // ANTES do `await`: quem pergunta "já passou do teto?" logo depois do
        // passo terminar precisa ver este passo na conta. No chat a gravação
        // nem é esperada — se a soma acontecesse depois do banco responder, o
        // teto por execução leria sempre um passo atrasado.
        if (custo === null) algumPassoSemPreco = true;
        else custoAcumulado += custo;

        await gravar({
          seq,
          kind: "model",
          toolName: null,
          input: paraJson({ modelo: modelId, provedor: step.model.provider }),
          output: paraJson({
            texto: step.text,
            motivoDeParada: step.finishReason,
            ferramentasPedidas: step.toolCalls.map((c) => ({
              nome: c.toolName,
              entrada: c.input,
            })),
          }),
          errorMessage: null,
          durationMs: duracao,
          tokensInput: entrada,
          tokensOutput: saida,
          costMicros: custo,
          // Fala do modelo nunca é simulada: mesmo em modo ensaio, o modelo
          // pensou e respondeu de verdade. Quem fica em ensaio é só a AÇÃO.
          simulado: false,
        });
      } catch (err) {
        logError("agents/recordModelStep", err);
      }
    },

    custoAcumuladoMicros(): number | null {
      return algumPassoSemPreco ? null : custoAcumulado;
    },

    async recordToolStep(p): Promise<void> {
      try {
        await gravar({
          seq: proximoSeq++,
          kind: "tool",
          toolName: p.toolName.slice(0, 64),
          input: paraJson(p.input),
          output: paraJson(p.output),
          errorMessage: p.errorMessage,
          durationMs: Math.max(0, Math.trunc(p.durationMs)),
          tokensInput: null,
          tokensOutput: null,
          // Ferramenta não gasta token de modelo. Custo zero aqui é verdade,
          // não "não sei".
          costMicros: 0,
          // SEMPRE `false` — inclusive pra uma ferramenta que AGE por dentro
          // (`mandar-email`, via `ctx.acao`). Não é descuido: a ação grava a
          // PRÓPRIA linha por `recordAcaoStep` (abaixo), com `tool_name`
          // `"acao:*"` e o `simulado` de verdade. Ver o aviso grande no tipo
          // `RunRecorder.recordToolStep`, no topo do arquivo, antes de "consertar"
          // isto achando que devia refletir `ctx.modo`.
          simulado: false,
        });
      } catch (err) {
        logError("agents/recordToolStep", err);
      }
    },

    async recordAcaoStep(p: PassoDeAcao): Promise<void> {
      try {
        await gravar({
          seq: proximoSeq++,
          kind: "tool",
          toolName: `acao:${p.acao}`,
          input: paraJson(p.entrada),
          // `detalhe` (o que a ação fez, ou o que ela TERIA feito em ensaio)
          // não tem coluna própria: entra dentro de `output`, do mesmo jeito
          // que uma ferramenta comum guarda o que devolveu pro modelo. `null`
          // só em erro — aí o motivo já mora em `errorMessage`.
          output: paraJson({ detalhe: p.detalhe }),
          errorMessage: p.erro,
          durationMs: Math.max(0, Math.trunc(p.duracaoMs)),
          tokensInput: null,
          tokensOutput: null,
          // Ação não gasta token de modelo — mesmo raciocínio de
          // `recordToolStep`: zero aqui é verdade, não "não sei".
          costMicros: 0,
          // A ÚNICA linha deste arquivo que grava `simulado = true`: é o que
          // faz o rastro (`<RunTrace>`) conseguir escrever "✋ Ensaio — eu
          // teria mandado um email para …" em vez do resultado de verdade. O
          // "para …" sai do `detalhe` logo acima.
          simulado: p.simulado,
        });
      } catch (err) {
        logError("agents/recordAcaoStep", err);
      }
    },
  };
}

/**
 * Fecha a linha da execução.
 *
 * NUNCA lança: se a gravação final falhar, a execução fica pendurada em
 * `running` e a tela mostra isso — o que já é melhor que estourar um erro na
 * cara de quem só queria a resposta do agente.
 */
export async function finishRun(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  runId: string;
  status: AgentRunStatus;
  output: string | null;
  /** JÁ EM PT-BR LEIGO. A tela mostra cru — traduzir é obrigação do motor. */
  errorMessage: string | null;
}): Promise<void> {
  // A conta NÃO vai daqui pro banco: quem soma tokens e custo é a função
  // `finish_agent_run`, lendo o rastro (`agent_run_steps`), que é a única
  // tabela que ninguém consegue reescrever depois de gravada.
  //
  // Isso não é preciosismo: `agent_runs` é de onde o teto de gasto da onda 6
  // vai tirar o número. Se quem disparou a execução pudesse mandar o total,
  // poderia rodar o agente caro e declarar que gastou zero.
  const { error } = await params.supabase.rpc("finish_agent_run", {
    _run_id: params.runId,
    _status: params.status,
    _output: params.output ?? undefined,
    _error_message: params.errorMessage ?? undefined,
  });

  if (error) logError("agents/finishRun", error);
}
