/**
 * RODAR UM TRABALHO DA FILA — o miolo da automação.
 *
 * A ordem aqui é a mesma sempre, e cada passo existe por um motivo de
 * segurança. Não troque a ordem sem ler o modelo de ameaça do contrato.
 *
 *  1. `loadJobForRun` — a linha do trabalho, só se estiver `running` E travada
 *     por ESTE trabalhador. (T4)
 *  2. `markJobStarted` — `false` significa entrega repetida: RECUSA, e explica
 *     que não refez pra não cobrar duas vezes. (T16)
 *  3. organização, agente e IDENTIDADE saem da LINHA, nunca do pedido. (T5)
 *  4. `createImpersonatedClient` — o cliente do Supabase que veste a
 *     identidade de quem a automação representa, e que LÊ o papel dele em
 *     `memberships` (T9, T11).
 *  5. `runAgent` — exatamente o mesmo motor do painel e do chat.
 *  6. fecha o trabalho, conta pro agendamento, e DESTRÓI a conexão. (R3)
 *
 * ⚠️ NUNCA LANÇA por falha do agente — mesma regra do `runAgent`. Tudo vira
 * `{ ok: false, error }` com a frase já em PT-BR leigo, porque essa frase vai
 * pra `jobs.last_error` e a tela mostra ela crua.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import { criarAcoesDoMotor, type ModoDeExecucao } from "@/lib/agents/acoes";
import { runAgent } from "@/lib/agents/engine";
import { type AgentRunInput, agentRunInputSchema } from "@/lib/agents/schemas";
import type { AgentRecord, AgentTriggerKind } from "@/lib/agents/types";
import { getAppUrl } from "@/lib/app-url";
import { processarDocumento } from "@/lib/knowledge/ingest";
import { budgetBlockedMessageFromStatus } from "@/lib/limits/messages";
import { logError } from "@/lib/logger";
import { entregarResultado, lerEntrega } from "./entrega";
import { createImpersonatedClient } from "./impersonate";
import {
  automationBudgetLeft,
  finishJobBestEffort,
  loadJobForRun,
  markJobStarted,
  orgBudgetStatus,
  reportScheduleResult,
} from "./queue";
import type { AutomationSource, JobParaRodar, RunJobResult } from "./types";

/**
 * Teto de relógio de uma automação inteira: 5 minutos.
 *
 * Maior que os 2 minutos do chat de propósito: a chamada interna é dentro do
 * container, então ela NÃO passa pelo proxy do EasyPanel e o corte de 60
 * segundos não vale aqui.
 *
 * ⚠️ O trabalhador roda UM trabalho por vez. Uma automação de 5 minutos
 * atrasa as outras — é a escolha consciente de um container pequeno.
 */
export const TETO_DE_TEMPO_DO_TRABALHO_MS = 300_000;

/**
 * A PRIMEIRA FRASE de quando o agente trabalhou mas o resultado não chegou no
 * destino.
 *
 * Ela existe porque `jobs.last_error` vai CRU pra tela de Automações: sem
 * isto, o aluno lia só o motivo técnico da falha ("A chave do Resend
 * expirou.") e não tinha como saber que o trabalho em si deu certo e que o
 * resultado não se perdeu. O detalhe continua logo depois — ele é o que ajuda
 * a consertar, e já vem em PT-BR leigo de `ctx.acao` (`lib/agents/acoes.ts`),
 * nunca cru do provedor de email.
 *
 * ⚠️ Fala em EMAIL porque é a única entrega que dá pra criar hoje —
 * `ScheduleBlueprint.entrega` (o arquivo, `lib/automation/blueprint.ts`) só
 * aceita `"nenhuma"` ou `"email"`: `agendamentoParaInsert` valida com
 * `entregaDeEntradaSchema`, que nem conhece `conexao` (ver
 * `lib/automation/entrega.ts`). O banco continua sabendo LER esse formato,
 * guardado pra a onda das conexões — quando ela nascer de verdade, esta frase
 * ganha uma irmã.
 */
export const AVISO_DE_ENTREGA_QUE_FALHOU =
  "A automação rodou certo, mas não deu pra mandar o email. O resultado está guardado em " +
  "Execuções.";

/**
 * O pedido padrão, pra quando o agendamento/webhook não trouxe texto nenhum.
 *
 * ⚠️ ESTAS FRASES SÃO NOSSAS, e é por isso que elas podem ser instrução. O que
 * chega de fora (o corpo do webhook) entra SEMPRE como `data`, que o motor
 * marca como DADO — nunca como instrução. Não inverta isso: seria transformar
 * qualquer sistema que chame o webhook num dono do seu agente.
 */
const PEDIDO_PADRAO: Record<AutomationSource, string> = {
  schedule: "Está na hora da sua rotina agendada. Faça o que as suas instruções mandam.",
  webhook:
    "Um sistema de fora acabou de te chamar. Faça o que as suas instruções mandam com o " +
    "dado que veio junto.",
  manual: "Rode agora o que as suas instruções mandam.",
};

const GATILHO_POR_FONTE: Record<AutomationSource, AgentTriggerKind> = {
  schedule: "schedule",
  webhook: "webhook",
  manual: "manual",
};

/**
 * A entrada do agente, tirada da linha da fila.
 *
 * Quando o payload não tem `prompt` nem `messages` (o caso NORMAL de um
 * webhook, que só traz `data`), a gente põe o pedido padrão — senão o motor
 * recusaria a execução com "escreva o que você quer pedir pro agente", que
 * não faz sentido nenhum numa automação.
 */
function montarEntrada(job: JobParaRodar): AgentRunInput | null {
  const bruto =
    job.input !== null && typeof job.input === "object" && !Array.isArray(job.input)
      ? { ...(job.input as Record<string, unknown>) }
      : {};

  const temTexto = typeof bruto.prompt === "string" && bruto.prompt.trim() !== "";
  const temConversa = Array.isArray(bruto.messages) && bruto.messages.length > 0;

  if (!temTexto && !temConversa) {
    bruto.prompt = PEDIDO_PADRAO[job.sourceKind];
  }

  const entrada = agentRunInputSchema.safeParse(bruto);
  return entrada.success ? entrada.data : null;
}

/**
 * Roda o trabalho `jobId`, que tem que estar travado por `workerId`.
 *
 * `retryable: true` = o trabalho NÃO chegou a começar, então tentar de novo é
 * seguro. Depois que `markJobStarted` respondeu `true`, nada mais é refeito.
 */
export async function executarTrabalho(jobId: string, workerId: string): Promise<RunJobResult> {
  // -----------------------------------------------------------------------
  // 1. A linha do trabalho (é ela que carrega organização, agente e identidade)
  // -----------------------------------------------------------------------
  let job: JobParaRodar | null;
  try {
    job = await loadJobForRun(jobId, workerId);
  } catch (err) {
    logError("automation/loadJobForRun", err);
    return {
      ok: false,
      error: "Não deu pra ler esse trabalho da fila agora.",
      runId: null,
      retryable: true,
    };
  }

  if (!job) {
    // Ou o trabalho não existe, ou não está rodando, ou está travado por OUTRO
    // trabalhador. Nos três casos: não é nosso, não mexe.
    return {
      ok: false,
      error: "Esse trabalho não está mais na fila deste trabalhador.",
      runId: null,
      retryable: false,
    };
  }

  // -----------------------------------------------------------------------
  // 2. Entrega repetida? Não refaz. (T16)
  // -----------------------------------------------------------------------
  const primeiraVez = await markJobStarted(jobId).catch((err) => {
    logError("automation/markJobStarted", err);
    return false;
  });

  if (!primeiraVez) {
    const frase =
      "Esta automação já tinha começado antes, então ela NÃO foi refeita — a repetição " +
      "cobraria de novo pelo mesmo trabalho.";
    await finishJobBestEffort({ jobId, status: "failed", error: frase });
    await contarProAgendamento(job, frase, false);
    return { ok: false, error: frase, runId: null, retryable: false };
  }

  // -----------------------------------------------------------------------
  // 3. Sem identidade não roda. (T11)
  // -----------------------------------------------------------------------
  if (!job.runAs) {
    const frase =
      "Esta automação não tem mais uma pessoa responsável no workspace, então ela não pode " +
      "rodar. Um administrador pode assumir e ligar de novo.";
    await finishJobBestEffort({ jobId, status: "failed", error: frase });
    await contarProAgendamento(job, frase, true);
    return { ok: false, error: frase, runId: null, retryable: false };
  }

  const entrada = montarEntrada(job);
  if (!entrada) {
    const frase =
      "O que essa automação manda pro agente não está num formato que ele entenda. " +
      "Abra a automação e escreva de novo o pedido.";
    await finishJobBestEffort({ jobId, status: "failed", error: frase });
    await contarProAgendamento(job, frase, true);
    return { ok: false, error: frase, runId: null, retryable: false };
  }

  // -----------------------------------------------------------------------
  // 4a. O TETO DE GASTO — dinheiro antes de token, igual ao motor
  // -----------------------------------------------------------------------
  // O motor confere isto de novo lá na frente (é o passo 2a dele, e é ele que
  // manda). Aqui a conferência existe pela FRASE: o trabalhador é quem escreve
  // `jobs.last_error` e conta pro agendamento, e a diferença entre "a rodada
  // foi pulada porque o workspace chegou no teto" e uma mensagem genérica é a
  // diferença entre o aluno saber o que fazer e abrir um chamado.
  //
  // ⚠️ `pausar: false` SEMPRE. A automação NÃO é desligada por teto: ele zera
  // sozinho na virada do mês, e desligar deixaria ela morta em setembro
  // esperando alguém lembrar de religar.
  try {
    const teto = await orgBudgetStatus(job.organizationId);
    if (teto?.blocked) {
      const frase = budgetBlockedMessageFromStatus(
        teto,
        job.sourceKind === "webhook" ? "webhook" : "agendamento",
      );
      await finishJobBestEffort({ jobId, status: "failed", error: frase });
      await contarProAgendamento(job, frase, false);
      return { ok: false, error: frase, runId: null, retryable: false };
    }
  } catch (err) {
    // Não deu pra ler o teto: seguimos. O motor confere de novo, e travar toda
    // a automação por causa de uma leitura que falhou seria pior.
    logError("automation/orgBudgetStatus", err);
  }

  // -----------------------------------------------------------------------
  // 4b. O balde de IA da automação
  // -----------------------------------------------------------------------
  // Conferido ANTES de abrir a execução pra a mensagem falar de automação, e
  // não "você já usou sua cota" — numa execução agendada não existe "você".
  try {
    if ((await automationBudgetLeft(job.organizationId)) <= 0) {
      const frase =
        "Esta automação parou porque o workspace já usou a cota de IA de hoje. Ela volta " +
        "amanhã. (Automação tem cota própria, separada da sua.)";
      await finishJobBestEffort({ jobId, status: "failed", error: frase });
      await contarProAgendamento(job, frase, false);
      return { ok: false, error: frase, runId: null, retryable: false };
    }
  } catch (err) {
    // Não deu pra conferir o balde: seguimos. O `consume_llm_tokens` do motor
    // é a trava de verdade — esta aqui é só pra mensagem sair melhor.
    logError("automation/automationBudgetLeft", err);
  }

  // -----------------------------------------------------------------------
  // 5. A identidade
  // -----------------------------------------------------------------------
  const sessao = await createImpersonatedClient({
    jobId,
    userId: job.runAs,
    organizationId: job.organizationId,
  });

  if (!sessao.ok) {
    await finishJobBestEffort({ jobId, status: "failed", error: sessao.error });
    await contarProAgendamento(job, sessao.error, true);
    return { ok: false, error: sessao.error, runId: null, retryable: false };
  }

  try {
    // ---------------------------------------------------------------------
    // 5b. Indexar documento tem caminho próprio — e é curto
    // ---------------------------------------------------------------------
    // Ele reaproveita TUDO que veio até aqui: a entrega única (T16), a
    // identidade e, principalmente, a sessão que faz a RLS valer. O que ele
    // NÃO tem é agente, execução nem rastro — indexar não é o agente pensando.
    if (job.kind === "ingest_document") {
      const documentId =
        typeof job.input === "object" && job.input !== null && "documentId" in job.input
          ? String((job.input as { documentId: unknown }).documentId)
          : null;

      if (!documentId) {
        const frase = "Esse trabalho de leitura veio sem documento. Suba o arquivo de novo.";
        await finishJobBestEffort({ jobId, status: "failed", error: frase });
        return { ok: false, error: frase, runId: null, retryable: false };
      }

      // O ENDEREÇO DO ARQUIVO, quando existe.
      //
      // ⚠️ É ele que faz este caminho funcionar. A ponte da automação não serve
      // Storage (regra R5), então daqui NÃO dá pra baixar nada do balde: quem
      // enfileirou já gerou um endereço temporário, com a permissão de quem
      // subiu o arquivo, e `processarDocumento` só faz um `fetch` nele.
      //
      // Vem vazio em documento de texto colado, que não tem arquivo nenhum.
      const downloadUrl =
        typeof job.input === "object" && job.input !== null && "downloadUrl" in job.input
          ? String((job.input as { downloadUrl: unknown }).downloadUrl)
          : null;

      // `processarDocumento` NUNCA lança: falha vira a linha do documento
      // marcada como falhada, com a frase em português já gravada nela.
      const leitura = await processarDocumento({
        supabase: sessao.sessao.supabase,
        documentId,
        downloadUrl,
      });

      await finishJobBestEffort({
        jobId,
        status: leitura.ok ? "done" : "failed",
        error: leitura.ok ? null : leitura.error,
      });

      return leitura.ok
        ? { ok: true, runId: null, status: "succeeded" }
        : { ok: false, error: leitura.error, runId: null, retryable: false };
    }

    // ---------------------------------------------------------------------
    // 6. O agente e o workspace, lidos JÁ com a identidade certa
    // ---------------------------------------------------------------------
    // Daqui pra baixo o trabalho é obrigatoriamente de agente: o de documento
    // já voltou lá em cima. O banco garante o mesmo pelo `jobs_agent_required`,
    // mas o TypeScript não enxerga isso — então a conferência fica explícita,
    // em vez de um `?? ""` que esconderia o buraco.
    if (!job.agentId) {
      const frase = "Esse trabalho está sem agente. A automação foi desligada.";
      await finishJobBestEffort({ jobId, status: "failed", error: frase });
      await contarProAgendamento(job, frase, true);
      return { ok: false, error: frase, runId: null, retryable: false };
    }

    const { data: agente, error: erroDoAgente } = await sessao.sessao.supabase
      .from("agents")
      .select("*")
      .eq("organization_id", job.organizationId)
      .eq("id", job.agentId)
      .maybeSingle();

    if (erroDoAgente) {
      logError("automation/lerAgente", erroDoAgente);
      const frase = "Não deu pra carregar o agente desta automação agora.";
      await finishJobBestEffort({ jobId, status: "failed", error: frase, retryInSeconds: 300 });
      await contarProAgendamento(job, frase, false);
      return { ok: false, error: frase, runId: null, retryable: false };
    }

    if (!agente) {
      const frase =
        "O agente desta automação não existe mais (ou quem ela representa perdeu o acesso a " +
        "ele). A automação foi desligada.";
      await finishJobBestEffort({ jobId, status: "failed", error: frase });
      await contarProAgendamento(job, frase, true);
      return { ok: false, error: frase, runId: null, retryable: false };
    }

    const { data: workspace, error: erroDoWorkspace } = await sessao.sessao.supabase
      .from("organizations")
      .select("id,slug,name")
      .eq("id", job.organizationId)
      .maybeSingle();

    if (erroDoWorkspace || !workspace) {
      if (erroDoWorkspace) logError("automation/lerWorkspace", erroDoWorkspace);
      const frase = "Não deu pra carregar o workspace desta automação agora.";
      await finishJobBestEffort({ jobId, status: "failed", error: frase, retryInSeconds: 300 });
      await contarProAgendamento(job, frase, false);
      return { ok: false, error: frase, runId: null, retryable: false };
    }

    // ---------------------------------------------------------------------
    // 6b. `modo` (schedule OU webhook) e `entrega` (só schedule, por enquanto)
    // ---------------------------------------------------------------------
    // ⚠️ QUEM NÃO ACHAR A LINHA CAI EM ENSAIO, NUNCA EM REAL. Um trabalho
    // `manual` (o fallback de `comoFonte` pra qualquer `source_kind` que não
    // seja `schedule`/`webhook`) não tem linha nenhuma pra ler, e uma falha de
    // leitura não pode virar "rodou de verdade" por acidente — por isso o
    // padrão de `modo` é sempre "ensaio", e só vira "real" quando a linha foi
    // lida com sucesso E diz isso.
    //
    // ⚠️ CORREÇÃO (rodada 1 de revisão): a primeira versão só lia `schedules`,
    // então todo webhook caía no padrão "ensaio" pra sempre — a coluna
    // `webhook_endpoints.modo` ficava inerte. O caminho ESCOLHIDO aqui não é
    // o que o brief sugeriu (copiar `modo` pro `payload` do job dentro de
    // `enqueue_webhook_job`, via migration); é ler `webhook_endpoints` direto
    // por esta MESMA sessão impersonada, pelo mesmo motivo que a leitura de
    // `schedules` já funciona:
    //   • `webhook_endpoints` já está em `TABELAS_DA_PONTE`, e `modo` já está
    //     em `COLUNAS_DA_PONTE.webhook_endpoints` (`postgrest-bridge.ts`) —
    //     zero mudança na ponte;
    //   • a policy de select ("members read webhooks") é `is_org_member`, NÃO
    //     `has_org_role` — funciona mesmo quando `run_as` foi rebaixado de
    //     admin pra membro comum depois de criar o endereço;
    //   • `grant select (modo, esperar_resposta) on … to authenticated` já
    //     existe desde a migration `20260821110000_agente_que_age.sql`.
    // Ou seja: dá pra ler sem migration nova e sem tocar no formato do
    // `payload` do job (que `montarEntrada` já lê com um formato específico).
    let agendamento: { name: string; modo: string; entrega: unknown } | null = null;
    let modo: ModoDeExecucao = "ensaio";

    if (job.sourceKind === "schedule" && job.sourceId) {
      const { data, error } = await sessao.sessao.supabase
        .from("schedules")
        .select("name, modo, entrega")
        .eq("id", job.sourceId)
        .maybeSingle();
      if (error) logError("automation/lerAgendamento", error);
      else agendamento = data;
      modo = agendamento?.modo === "real" ? "real" : "ensaio";
    } else if (job.sourceKind === "webhook" && job.sourceId) {
      // Webhook não tem `entrega` nesta onda — só `modo`. `agendamento`
      // continua `null`, então `entrega` mais abaixo cai em "nenhuma" e
      // `nomeDaAutomacao` cai no nome do agente, exatamente como antes.
      const { data, error } = await sessao.sessao.supabase
        .from("webhook_endpoints")
        .select("modo")
        .eq("id", job.sourceId)
        .maybeSingle();
      if (error) logError("automation/lerModoDoWebhook", error);
      else modo = data?.modo === "real" ? "real" : "ensaio";
    }

    // ---------------------------------------------------------------------
    // 7. O MESMO motor do painel e do chat
    // ---------------------------------------------------------------------
    const resultado = await runAgent({
      supabase: sessao.sessao.supabase,
      agent: agente as AgentRecord,
      organization: { id: workspace.id, slug: workspace.slug, name: workspace.name },
      // ⚠️ O papel foi LIDO de `memberships`, nunca fixado no código. É ele que
      // decide quais ferramentas com `requiresRole` este agente pode usar.
      user: { id: sessao.sessao.userId, role: sessao.sessao.role },
      triggerKind: GATILHO_POR_FONTE[job.sourceKind],
      input: entrada,
      timeoutMs: TETO_DE_TEMPO_DO_TRABALHO_MS,
      modo,
    });

    // ---------------------------------------------------------------------
    // 8. Fecha a fila e conta pro agendamento
    // ---------------------------------------------------------------------
    const naoSuportado = sessao.sessao.recursoNaoSuportado();

    if (resultado.ok) {
      // -----------------------------------------------------------------
      // 8a. A ENTREGA — o que fazer com o texto que o agente produziu
      // -----------------------------------------------------------------
      // ⚠️ Roda AQUI, e não dentro do motor: `entregarResultado` NÃO grava
      // passo no rastro do agente (`agent_run_steps`). `runAgent`, logo
      // acima, já fechou a execução (`finishRun`) — nesse ponto
      // `agent_runs.status` já é `succeeded`, e `record_agent_run_step`
      // recusa gravar em execução que não está `running`. Por isso o
      // `registrar` do `Acoes` daqui é um no-op: a entrega é trabalho da
      // AUTOMAÇÃO (`jobs`), não do agente (`agent_runs`).
      const acoesDaEntrega = criarAcoesDoMotor({
        modo,
        organizationId: job.organizationId,
        supabase: sessao.sessao.supabase,
        registrar: async () => {},
      });

      const entrega = lerEntrega(agendamento?.entrega ?? null);
      const nomeDaAutomacao = agendamento?.name ?? agente.name;
      const linkDaExecucao = `${await getAppUrl()}/app/${workspace.slug}/execucoes/${resultado.data.runId}`;

      const entregou = await entregarResultado({
        entrega,
        acoes: acoesDaEntrega,
        output: resultado.data.output,
        nomeDaAutomacao,
        linkDaExecucao,
      });

      // ⚠️ Falha de entrega NÃO é falha da execução: o trabalho continua
      // `done`, e o erro vai só pra `jobs.last_error` (a tela de Automações já
      // mostra essa coluna). O agente fez o trabalho dele; quem falhou foi a
      // entrega — e a frase que o aluno lê primeiro precisa dizer isso, antes
      // do motivo técnico (ver `AVISO_DE_ENTREGA_QUE_FALHOU`).
      const erroDeEntrega = entregou.ok ? null : `${AVISO_DE_ENTREGA_QUE_FALHOU} ${entregou.erro}`;

      await finishJobBestEffort({
        jobId,
        status: "done",
        error: erroDeEntrega,
        runId: resultado.data.runId,
      });
      await contarProAgendamento(job, erroDeEntrega, false);
      return { ok: true, runId: resultado.data.runId, status: "succeeded" };
    }

    // Quando a automação esbarrou num recurso que a ponte não serve, repetir
    // amanhã daria exatamente o mesmo erro. Melhor PAUSAR e explicar do que
    // falhar todo dia às 8h da manhã, calado.
    const frase = naoSuportado
      ? `${resultado.error} (Motivo técnico: ${naoSuportado}.) A automação foi desligada ` +
        "porque tentar de novo daria o mesmo resultado."
      : resultado.error;

    await finishJobBestEffort({
      jobId,
      status: "failed",
      error: frase,
      runId: resultado.runId,
    });
    await contarProAgendamento(job, frase, naoSuportado !== null);

    return { ok: false, error: frase, runId: resultado.runId, retryable: false };
  } catch (err) {
    logError("automation/executarTrabalho", err);
    const frase =
      "Essa automação parou por um problema inesperado no servidor. Olhe o registro (log) do " +
      "app pra ver o que aconteceu.";
    await finishJobBestEffort({ jobId, status: "failed", error: frase });
    await contarProAgendamento(job, frase, false);
    return { ok: false, error: frase, runId: null, retryable: false };
  } finally {
    // R3: a conexão MORRE aqui, inclusive quando deu erro. Estado de sessão
    // (a identidade!) nunca sobrevive a um trabalho.
    await sessao.sessao.close().catch((err) => logError("automation/fecharSessao", err));
  }
}

/** Conta o resultado pro agendamento que originou o trabalho, quando existe. */
async function contarProAgendamento(
  job: JobParaRodar,
  error: string | null,
  pausar: boolean,
): Promise<void> {
  if (job.sourceKind !== "schedule" || !job.sourceId) return;
  try {
    await reportScheduleResult({ scheduleId: job.sourceId, error, pausar });
  } catch (err) {
    logError("automation/reportScheduleResult", err);
  }
}
