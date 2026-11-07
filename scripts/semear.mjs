#!/usr/bin/env node
/**
 * `npm run semear` — materializa o produto (agente, base, agendamento,
 * webhook) em workspaces que JÁ EXISTEM.
 *
 * Workspace NOVO já materializa sozinho — `createOrganizationAction`
 * (`lib/orgs/actions.ts`) chama `materializarWorkspace` logo depois da RPC de
 * criação. Este comando é o mesmo passo, retroativo, pra quem criou o
 * workspace ANTES de uma declaração existir, ou pra quando alguém acrescenta
 * um agente novo em `lib/seed/registro.ts` e quer que ele apareça nos
 * workspaces que já existem, sem esperar a próxima criação.
 *
 * PRECISA DO SITE NO AR (`npm run dev` ou o container rodando): a lógica de
 * verdade mora em TypeScript (`lib/seed/materializar.ts`, `lib/seed/semear.ts`)
 * e este arquivo é Node puro — não consegue importar `@/...` diretamente. Por
 * isso ele entra por `/api/internal/semear`, do mesmo jeito que o trabalhador
 * entra por `/api/internal/run-job` (ver `lib/automation/CLAUDE.md`).
 *
 * ⚠️ IDEMPOTENTE: rodar duas vezes é o caso NORMAL (é o que
 * `materializarWorkspace` garante — só grava o que falta e só atualiza o que
 * de fato mudou). Rodar de novo depois de um deploy não duplica nada.
 *
 * Uso:
 *   npm run semear                 → materializa TODOS os workspaces
 *   npm run semear -- <org-id>     → materializa só um workspace
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lerArquivoEnvLocal } from "./lib/env-local.mjs";
import { assinarChamadaSemear, derivarSegredoInterno } from "./lib/segredo-interno.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Quanto esperar a resposta do site antes de desistir. Mesmo teto da rota (5 min). */
const TETO_DA_CHAMADA_MS = 320_000;

function log(msg) {
  console.log(msg);
}

function logErro(msg) {
  console.error(msg);
}

async function main() {
  lerArquivoEnvLocal(RAIZ);

  const organizationId = process.argv[2]?.trim() || undefined;

  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.trim() === "") {
    logErro(
      "falta a variável ENCRYPTION_KEY. Sem ela este comando não consegue provar pro site " +
        "que a chamada veio de dentro do container. Rode: npm run gerar-chave",
    );
    process.exit(1);
  }

  const porta = process.env.PORT && process.env.PORT.trim() !== "" ? process.env.PORT.trim() : "3000";
  const endereco = `http://127.0.0.1:${porta}/api/internal/semear`;

  const momento = Date.now();
  const segredo = derivarSegredoInterno(process.env.ENCRYPTION_KEY);
  const assinatura = assinarChamadaSemear(segredo, organizationId ?? "", momento);

  log(organizationId ? `semeando o workspace ${organizationId}...` : "semeando os workspaces...");

  let resposta;
  try {
    resposta = await fetch(endereco, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-semear-signature": assinatura,
        "x-semear-ts": String(momento),
      },
      body: JSON.stringify(organizationId ? { organizationId } : {}),
      signal: AbortSignal.timeout(TETO_DA_CHAMADA_MS),
    });
  } catch (err) {
    logErro(
      `não consegui falar com o site em ${endereco}: ${err?.message ?? err}. Ele está no ar ` +
        "(npm run dev, ou o container)?",
    );
    process.exit(1);
  }

  if (resposta.status === 401) {
    // A causa quase sempre é esta, e a frase precisa dizer isso: sem ela, o
    // aluno olha o log e vê só "401".
    logErro(
      "o site recusou a chamada interna (401). Isso quase sempre quer dizer que o site e este " +
        "comando estão enxergando ENCRYPTION_KEY diferentes. Confira o .env.local.",
    );
    process.exit(1);
  }

  if (!resposta.ok) {
    const texto = (await resposta.text().catch(() => "")).slice(0, 300);
    logErro(`o site respondeu ${resposta.status}: ${texto}`);
    process.exit(1);
  }

  const resultado = await resposta.json().catch(() => null);
  if (!resultado) {
    logErro("o site respondeu, mas não deu pra entender a resposta.");
    process.exit(1);
  }

  log(
    `  agentes: ${resultado.agentes}   bases: ${resultado.bases}   ` +
      `agendamentos: ${resultado.agendamentos}   webhooks: ${resultado.webhooks}`,
  );

  if (resultado.agendamentosPulados?.length > 0) {
    log(
      `  agendamentos pulados (automação que outra pessoa já assumiu): ` +
        resultado.agendamentosPulados.join(", "),
    );
  }

  const pulados = resultado.workspacesPulados ?? [];
  if (pulados.length > 0) {
    log(`  workspaces pulados: ${pulados.length}`);
    for (const p of pulados) {
      // `motivo` é o formato de `MotivoDoWorkspacePulado`
      // (`lib/seed/semear.ts`): `{ tipo }` pros dois casos fixos, `{ tipo,
      // mensagem }` pro caso de texto livre.
      const motivo = p.motivo?.tipo === "impersonacao-falhou" ? p.motivo.mensagem : p.motivo?.tipo;
      log(`    ${p.organizationId}: ${motivo}`);
    }
  }

  log("pronto.");

  // Pulado não é erro (o comando terminou, e o log já diz o que ficou de
  // fora) — mas também não é "semeei tudo". Código de saída diferente de 0
  // deixa um pipeline de deploy DISTINGUIR os dois casos, em vez de só ler
  // "sucesso" e seguir sem checar o texto do log.
  if (pulados.length > 0) process.exitCode = 2;
}

main().catch((err) => {
  logErro(`parei por um erro inesperado: ${err?.stack ?? err}`);
  process.exit(1);
});
