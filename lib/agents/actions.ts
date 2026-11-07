"use server";

/**
 * As funções do servidor do painel de agentes.
 *
 * Só sobra o playground (`runAgentAction`). Criar, editar e apagar agente não
 * são função do servidor nenhuma: agente nasce de arquivo
 * (`lib/agents/blueprint.ts` + `lib/seed/registro.ts`), materializado por
 * `materializarWorkspace`. Aposentar é declarar `status: "archived"` na
 * planta e materializar de novo — não existe mais tela que apague agente.
 *
 * ⚠️ TODA FUNÇÃO AQUI CHAMA O GUARD DENTRO DELA MESMA.
 * Função marcada com "use server" é um endereço público da internet: dá pra
 * chamar sem passar pela tela. "A página só mostra o botão pra quem pode" não
 * protege nada sozinho.
 *
 * ⚠️ A REGRA MAIS FÁCIL DE ERRAR AQUI ESTÁ NO `runAgentAction`:
 * agente que rodou e QUEBROU não é `{ ok: false }`. Ele é
 * `{ ok: true, data: { run } }` com `run.status === "failed"` — porque a tela
 * precisa mostrar o rastro do que aconteceu. `{ ok: false }` é só pra quando a
 * execução NEM COMEÇOU (dado inválido, sem permissão, limite de uso).
 */
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireOrgMember } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { runAgent } from "./engine";
import { getAgentById } from "./queries";
import { getRunDetail, type RunDetail } from "./runs-queries";
import { type RunAgentActionInput, runAgentInputSchema } from "./schemas";

/**
 * O teto de relógio do playground: 55 segundos.
 *
 * O padrão do motor é 120 s, mas o servidor que fica na frente do app costuma
 * cortar a conexão aos 60 s. Passando de lá, a pessoa levaria um erro de rede
 * genérico ("não foi possível conectar") mesmo com a execução tendo terminado
 * bem no servidor. Com 55 s, quem corta é o motor — e aí a execução fecha como
 * "falhou" com uma frase que explica o que houve.
 */
const TIMEOUT_DO_PLAYGROUND_MS = 55_000;

// -----------------------------------------------------------------------------
// Rodar (playground)
// -----------------------------------------------------------------------------

/**
 * Limite de uso: 10 execuções por pessoa por minuto, por workspace.
 *
 * O contador vive na memória do processo — mesmo padrão do `/api/chat`. Não é
 * à prova de bala (com dois processos no ar, o teto vira 20), mas segura o
 * caso real: alguém clicando "rodar" sem parar e queimando crédito.
 */
const limitePorPessoa = new Map<string, { count: number; resetAt: number }>();
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 10;
const TETO_DO_MAPA = 10_000;

function dentroDoLimite(chave: string): boolean {
  const agora = Date.now();

  // Faxina só quando o mapa cresce: varrer a cada chamada seria desperdício.
  if (limitePorPessoa.size >= TETO_DO_MAPA) {
    for (const [k, v] of limitePorPessoa) {
      if (agora > v.resetAt) limitePorPessoa.delete(k);
    }
  }

  const atual = limitePorPessoa.get(chave);
  if (!atual || agora > atual.resetAt) {
    limitePorPessoa.set(chave, { count: 1, resetAt: agora + JANELA_MS });
    return true;
  }
  if (atual.count >= MAX_POR_JANELA) return false;
  atual.count++;
  return true;
}

/**
 * Roda o agente e devolve a execução inteira, com rastro.
 *
 * QUALQUER membro do workspace pode rodar. Se alguma ferramenta do agente
 * exigir papel de dono/admin, quem filtra é o motor (na hora de montar o
 * conjunto de ferramentas), não esta função — assim um membro comum consegue
 * usar o agente, só que sem as ferramentas que ele não teria direito de usar.
 */
export async function runAgentAction(
  input: RunAgentActionInput,
): Promise<ActionResult<{ run: RunDetail; warnings: string[] }>> {
  const parsed = runAgentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Escreva o que você quer pedir pro agente.",
    };
  }

  const { user, org, role } = await requireOrgMember({ orgSlug: parsed.data.orgSlug });

  if (!dentroDoLimite(`${user.id}:${org.id}`)) {
    return {
      ok: false,
      error: "Você rodou muitos agentes em pouco tempo. Espere um minutinho e tente de novo.",
    };
  }

  const agent = await getAgentById(org.id, parsed.data.agentId);
  if (!agent) {
    return { ok: false, error: "Esse agente não existe mais neste workspace." };
  }

  const supabase = await createClient();

  const resultado = await runAgent({
    supabase,
    agent,
    organization: { id: org.id, slug: org.slug, name: org.name },
    user: { id: user.id, role },
    triggerKind: "manual",
    input: { prompt: parsed.data.message },
    timeoutMs: TIMEOUT_DO_PLAYGROUND_MS,
    // A chave de ensaio do playground é estado da TELA (não é gravada em
    // lugar nenhum) — chega aqui só nesta chamada. `undefined` cai no padrão
    // do motor (`"real"`), mas a tela sempre manda um valor explícito porque
    // a chave nasce ligada (ver `Playground`, em `agentes/[slug]/testar/`).
    modo: parsed.data.modo,
  });

  // A ponte com o motor: ele devolve `{ ok:false, error, runId }` quando o
  // agente rodou e quebrou. Pra tela isso NÃO é um erro do formulário — é uma
  // execução que existe, tem rastro e precisa ser mostrada.
  const runId = resultado.ok ? resultado.data.runId : resultado.runId;
  if (runId === null) {
    return { ok: false, error: resultado.ok ? "Não deu pra rodar o agente." : resultado.error };
  }

  revalidatePath(`/app/${parsed.data.orgSlug}/execucoes`);

  // Os avisos do motor ("essa ferramenta não existe mais", "essa ficou de fora
  // porque você não é admin") são escritos em PT-BR pro aluno e eram jogados
  // fora aqui. Sem eles, a ferramenta some da execução em silêncio e a pessoa
  // fica achando que o agente ignorou o pedido dela.
  const warnings = resultado.ok ? resultado.data.warnings : [];

  const run = await getRunDetail(org.id, runId);
  if (!run) {
    // Só chega aqui se a execução sumiu entre gravar e ler. Devolver o texto do
    // motor é melhor do que uma tela em branco.
    return {
      ok: false,
      error: resultado.ok
        ? "O agente rodou, mas não deu pra carregar o resultado. Olhe em Execuções."
        : resultado.error,
    };
  }

  return { ok: true, data: { run, warnings } };
}
