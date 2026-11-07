#!/usr/bin/env node
/**
 * O TRABALHADOR DA AUTOMAÇÃO.
 *
 * O QUE ELE FAZ
 * -------------
 * Um laço, e só. A cada volta ele:
 *   • põe na fila os agendamentos que venceram (a cada 20 segundos);
 *   • recolhe trabalho e execução que ficaram presos (a cada 60 segundos);
 *   • pega UM trabalho da fila e pede pro site rodar;
 *   • encosta no arquivo de batimento, pra o healthcheck saber que ele vive.
 *
 * POR QUE ELE É BURRO DE PROPÓSITO
 * --------------------------------
 * Ele não sabe o que é agente, o que é ferramenta e o que é chave de API.
 * Tudo isso mora num lugar só: o site (o Next). Aqui só tem `pg` e `fetch`.
 *
 * E como a chamada é pro próprio container (127.0.0.1), ela NÃO passa pelo
 * proxy do EasyPanel — então o corte de 60 segundos dele não se aplica, e uma
 * automação pode demorar minutos sem problema.
 *
 * ⚠️ SE ELE MORRER, O CONTAINER INTEIRO CAI (é o `docker-entrypoint.sh` que
 * faz isso). É de propósito: servir um site onde nenhuma automação roda, e
 * calado, é o pior resultado possível.
 *
 * ⚠️ UM TRABALHO POR VEZ. É a escolha consciente de um container pequeno: uma
 * automação de 5 minutos atrasa as outras. O número está logo abaixo.
 */
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { lerArquivoEnvLocal } from "./lib/env-local.mjs";
import { assinarChamada, derivarSegredoInterno } from "./lib/segredo-interno.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Os números que valem a pena conhecer
// ---------------------------------------------------------------------------

/** Quantos trabalhos rodam ao mesmo tempo. Ver o aviso no topo do arquivo. */
const TRABALHOS_AO_MESMO_TEMPO = 1;
/** Quanto ele dorme quando a fila está vazia. */
const PAUSA_COM_FILA_VAZIA_MS = 2_000;
/** De quanto em quanto tempo ele olha os agendamentos vencidos. */
const INTERVALO_DOS_AGENDAMENTOS_MS = 20_000;
/** De quanto em quanto tempo ele recolhe trabalho preso. */
const INTERVALO_DA_FAXINA_MS = 60_000;
/** Quanto tempo ele espera a resposta do site antes de desistir daquele pedido. */
const TETO_DA_CHAMADA_MS = 320_000;
/** Depois de um erro feio, respira antes de tentar de novo. */
const PAUSA_DEPOIS_DE_ERRO_MS = 5_000;

/**
 * O nome do arquivo de batimento.
 *
 * ⚠️ ESTE MESMO NOME ESTÁ EM `lib/automation/heartbeat.ts`. Este arquivo é
 * Node puro (não passa pelo empacotador do Next), então não dá pra importar
 * de lá. Mudou aqui, mude lá — e tem teste conferindo que os dois batem.
 */
const NOME_DO_ARQUIVO_DE_BATIMENTO = "worker-vivo";

const APELIDO = `${hostname()}-${process.pid}`.slice(0, 80);

function log(msg) {
  console.log(`[automacao] ${msg}`);
}

function logErro(msg) {
  console.error(`[automacao] ${msg}`);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Batimento
// ---------------------------------------------------------------------------

/**
 * De quanto em quanto tempo o batimento acontece, INDEPENDENTE do que o laço
 * está fazendo.
 *
 * POR QUE ISSO É UM RELÓGIO SEPARADO E NÃO UMA LINHA DO LAÇO
 * ---------------------------------------------------------
 * Antes o ponto só era batido ENTRE um trabalho e outro. Enquanto uma
 * automação longa rodava, o arquivo envelhecia — e o `/api/health` passa a
 * responder 503 depois de 2 minutos parado. Resultado: o EasyPanel via o app
 * como doente e REINICIAVA O CONTAINER no meio da automação, que é exatamente
 * a hora em que ela não pode morrer.
 *
 * Foi reproduzido na máquina: com um trabalho que não termina, a idade do
 * arquivo subia 1s a cada segundo até passar dos 120s.
 */
const INTERVALO_DO_BATIMENTO_MS = 15_000;

function baterPonto() {
  const caminho = join(tmpdir(), NOME_DO_ARQUIVO_DE_BATIMENTO);
  try {
    const agora = new Date();
    if (existsSync(caminho)) utimesSync(caminho, agora, agora);
    else writeFileSync(caminho, "trabalhador da automacao\n");
  } catch {
    // Disco cheio não derruba a automação. O healthcheck é que vai reclamar.
  }
}

// ---------------------------------------------------------------------------
// Conexão com o banco (a MESMA disciplina de certificado do migrate.mjs)
// ---------------------------------------------------------------------------

const CAMINHO_CA_SUPABASE = join(RAIZ, "supabase", "certs", "supabase-root-2021-ca.crt");

function urlDoBanco() {
  for (const nome of ["DATABASE_URL", "SUPABASE_DB_URL"]) {
    const v = process.env[nome];
    if (v && v.trim() !== "") return v.trim();
  }
  return null;
}

function ehBancoLocal(dbUrl) {
  return /@(127\.0\.0\.1|localhost|host\.docker\.internal)[:/]/.test(dbUrl);
}

function caDoSupabase(dbUrl) {
  const ehSupabase = /@[^/]*\.(supabase\.(co|com|in)|pooler\.supabase\.com)[:/]/.test(dbUrl);
  if (!ehSupabase || !existsSync(CAMINHO_CA_SUPABASE)) return undefined;
  return readFileSync(CAMINHO_CA_SUPABASE, "utf8");
}

/**
 * Banco na sua máquina: sem criptografia, é tudo local mesmo.
 * Banco na internet: criptografado E com o certificado conferido de verdade —
 * o endereço do banco carrega a SENHA dele, e seguir sem conferir entregaria
 * essa senha pra quem estiver no meio do caminho.
 */
function opcoesDeConexao(dbUrl) {
  const local = ehBancoLocal(dbUrl);
  const ca = caDoSupabase(dbUrl);
  return {
    connectionString: dbUrl,
    ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 20_000,
    application_name: "automacao-worker",
    max: 2,
  };
}

// ---------------------------------------------------------------------------
// O laço
// ---------------------------------------------------------------------------

let parando = false;

async function chamarOSite(pool, jobId) {
  const porta = process.env.PORT && process.env.PORT.trim() !== "" ? process.env.PORT.trim() : "3000";
  const endereco = `http://127.0.0.1:${porta}/api/internal/run-job`;

  const momento = Date.now();
  const segredo = derivarSegredoInterno(process.env.ENCRYPTION_KEY);
  const assinatura = assinarChamada(segredo, jobId, APELIDO, momento);

  const corte = AbortSignal.timeout(TETO_DA_CHAMADA_MS);

  const resposta = await fetch(endereco, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-job-signature": assinatura,
      "x-job-ts": String(momento),
      "x-worker-id": APELIDO,
    },
    body: JSON.stringify({ jobId }),
    signal: corte,
  });

  if (resposta.status === 401) {
    // A causa quase sempre é esta, e a frase precisa dizer isso: sem ela, o
    // aluno olha o log e vê só "401".
    logErro(
      "o site recusou a chamada interna (401). Isso quase sempre quer dizer que o site e o " +
        "trabalhador estão enxergando ENCRYPTION_KEY diferentes. Dentro do container isso não " +
        "acontece; na sua máquina, confira o .env.local.",
    );
    await soltarTrabalho(pool, jobId, "O site recusou a chamada interna da automação.");
    return;
  }

  if (!resposta.ok) {
    const texto = (await resposta.text().catch(() => "")).slice(0, 200);
    logErro(`o site respondeu ${resposta.status} pro trabalho ${jobId}: ${texto}`);
    await soltarTrabalho(pool, jobId, "O site não conseguiu rodar essa automação agora.");
    return;
  }

  const resultado = await resposta.json().catch(() => null);
  if (resultado && resultado.ok) log(`trabalho ${jobId} terminou (execução ${resultado.runId}).`);
  else log(`trabalho ${jobId} falhou: ${resultado?.error ?? "sem detalhe"}`);
}

/**
 * Devolve o trabalho pra fila.
 *
 * ⚠️ A função do banco só devolve trabalho que NÃO COMEÇOU (`started_at is
 * null`). Se o site já tinha começado, isto aqui não faz nada — e é assim que
 * tem que ser: trabalho que já gastou dinheiro não é refeito.
 */
async function soltarTrabalho(pool, jobId, motivo) {
  try {
    await pool.query({
      text: "select public.release_job(_job_id => $1, _error => $2)",
      values: [jobId, motivo],
    });
  } catch (err) {
    logErro(`não deu pra devolver o trabalho ${jobId} pra fila: ${err?.message ?? err}`);
  }
}

async function pegarUmTrabalho(pool) {
  const { rows } = await pool.query({
    text: "select public.claim_job(_worker_id => $1) as id",
    values: [APELIDO],
  });
  return rows[0]?.id ?? null;
}

async function enfileirarAgendamentos(pool) {
  const { rows } = await pool.query("select public.enqueue_due_schedules(_limite => 20) as n");
  const n = rows[0]?.n ?? 0;
  if (n > 0) log(`${n} agendamento(s) entraram na fila.`);
}

async function faxina(pool) {
  const presos = await pool.query("select public.reclaim_stuck_jobs() as n");
  const pendurados = await pool.query("select public.reclaim_stuck_agent_runs() as n");
  const a = presos.rows[0]?.n ?? 0;
  const b = pendurados.rows[0]?.n ?? 0;
  if (a > 0 || b > 0) log(`faxina: ${a} trabalho(s) e ${b} execução(ões) recolhidos.`);
}

async function laco(pool) {
  let proximoAgendamento = 0;
  let proximaFaxina = Date.now() + INTERVALO_DA_FAXINA_MS;

  while (!parando) {
    baterPonto();

    try {
      const agora = Date.now();

      if (agora >= proximoAgendamento) {
        proximoAgendamento = agora + INTERVALO_DOS_AGENDAMENTOS_MS;
        await enfileirarAgendamentos(pool);
      }

      if (agora >= proximaFaxina) {
        proximaFaxina = agora + INTERVALO_DA_FAXINA_MS;
        await faxina(pool);
      }

      let rodou = 0;
      while (rodou < TRABALHOS_AO_MESMO_TEMPO && !parando) {
        const jobId = await pegarUmTrabalho(pool);
        if (!jobId) break;
        rodou += 1;
        log(`peguei o trabalho ${jobId}.`);
        try {
          await chamarOSite(pool, jobId);
        } catch (err) {
          logErro(`não consegui falar com o site sobre o trabalho ${jobId}: ${err?.message ?? err}`);
          await soltarTrabalho(pool, jobId, "O site não respondeu a chamada interna.");
        }
      }

      if (rodou === 0) await esperar(PAUSA_COM_FILA_VAZIA_MS);
    } catch (err) {
      logErro(`erro na volta do laço: ${err?.message ?? err}`);
      await esperar(PAUSA_DEPOIS_DE_ERRO_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Ligar
// ---------------------------------------------------------------------------

async function main() {
  lerArquivoEnvLocal(RAIZ);

  // Bate ponto desde já e de forma independente. `unref()` pra este relógio não
  // segurar o processo vivo sozinho quando chegar a hora de encerrar.
  baterPonto();
  const relogioDoBatimento = setInterval(baterPonto, INTERVALO_DO_BATIMENTO_MS);
  relogioDoBatimento.unref();

  const dbUrl = urlDoBanco();

  if (!dbUrl) {
    // ⚠️ NÃO morrer aqui é de propósito. Sem DATABASE_URL o site sobe do mesmo
    // jeito (o `migrate.mjs` só avisa), e derrubar o container por causa disso
    // transformaria um app que funciona num app que reinicia pra sempre.
    log("");
    log("A automação (agendamento e webhook) está DESLIGADA: falta a variável DATABASE_URL.");
    log("Preencha ela no painel do app e clique em Deploy. O site funciona normalmente sem ela;");
    log("só o que roda sozinho é que não roda.");
    log("");
    // Fica vivo e batendo ponto: assim o healthcheck não acusa nada e o
    // container não entra em laço de reinício.
    while (!parando) {
      baterPonto();
      await esperar(PAUSA_COM_FILA_VAZIA_MS);
    }
    return;
  }

  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.trim() === "") {
    logErro(
      "falta a variável ENCRYPTION_KEY. Sem ela o trabalhador não consegue provar pro site " +
        "que a chamada veio de dentro do container. Rode: npm run gerar-chave",
    );
    process.exit(1);
  }

  const pool = new pg.Pool(opcoesDeConexao(dbUrl));
  pool.on("error", (err) => logErro(`conexão parada deu erro: ${err?.message ?? err}`));

  const encerrar = async (sinal) => {
    if (parando) return;
    parando = true;
    log(`recebi ${sinal}, terminando o que estava fazendo...`);
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void encerrar("SIGTERM"));
  process.on("SIGINT", () => void encerrar("SIGINT"));

  log(`trabalhador "${APELIDO}" no ar. Um trabalho por vez.`);
  await laco(pool);
  await pool.end().catch(() => {});
}

main().catch((err) => {
  logErro(`parei por um erro inesperado: ${err?.stack ?? err}`);
  process.exit(1);
});
