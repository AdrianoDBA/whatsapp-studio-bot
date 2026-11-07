/**
 * `npm run semear`, por dentro: materializa workspaces que já existem.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ NÃO É POSTGRES. Age no nome do DONO DE CADA WORKSPACE, via a mesma       │
 * │ impersonação da automação (`lib/automation/impersonate.ts`) — nunca      │
 * │ `systemPool()`. A materialização em si passa pela ponte, como            │
 * │ `authenticated`: as MESMAS regras de segurança do banco valem, exatamente│
 * │ como valem pra um trabalho da fila.                                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * POR QUE IMPERSONAR O DONO, E NÃO `postgres`
 * --------------------------------------------
 * A regra 10-G do CLAUDE.md raiz e a R9 de `postgrest-bridge.ts` são
 * categóricas: `systemPool()` (o papel `postgres`) só existe em
 * `lib/automation/queue.ts`, e só chamando função com nome. Conectar como
 * `postgres` aqui pularia a regra de segurança do banco inteira. Semear entra
 * pela MESMA porta que qualquer automação — impersonando alguém de verdade.
 *
 * O OVO-E-A-GALINHA: QUEM IMPERSONAR?
 * ------------------------------------
 * Pra ler `memberships` PELA ponte, o cliente já precisa estar impersonando
 * alguém — é o dado que falta antes de começar. `owner_memberships_for_seed`
 * (uma função nomeada, só leitura, na lista fechada de `queue.ts`) resolve
 * isso: devolve as linhas CRUAS de `role = 'owner'`, sem decidir nada.
 *
 * ZERO OU DOIS+ DONOS: NUNCA ADIVINHA
 * -------------------------------------
 * O banco garante "pelo menos um" dono (gatilho `assert_at_least_one_owner`),
 * mas não "no máximo um" (a policy de INSERT de `memberships` tecnicamente
 * deixa um owner criar outra linha `role = 'owner'` direto — só não existe
 * caminho do PRODUTO que faça isso: `transfer_ownership` é atômico, convite
 * nunca oferece `role: "owner"`). Workspace com 0 ou 2+ donos é PULADO e
 * REGISTRADO em `workspacesPulados` — nunca uma escolha adivinhada. Mesma
 * filosofia de `ResultadoDaSemeadura.agendamentosPulados`.
 *
 * ⚠️ RODADA DE CONSERTO 1 (I2): `owner_memberships_for_seed` faz `left join`
 * a partir de `organizations`, então TODO workspace relevante devolve PELO
 * MENOS uma linha — com `userId: null` quando não tem dono. Isso vale nos
 * DOIS modos: com `organizationId` explícito E na varredura completa (sem
 * argumento — o modo que o deploy usa). Antes deste conserto, um workspace
 * órfão simplesmente NÃO APARECIA na varredura completa: sumia da conta em
 * silêncio, sem virar `workspacesPulados` e sem log nenhum. `donosPorWorkspace`
 * abaixo só empurra `userId` pra lista quando ele não é nulo — é isso que faz
 * o workspace órfão ainda ganhar uma CHAVE no mapa (lista vazia), mesmo sem
 * nenhum dono de verdade.
 *
 * NÃO É TRABALHO DA FILA
 * ------------------------
 * Sem `jobId`: `createImpersonatedClient` cai pra marca `app.automation_job`
 * vazia, que o banco já trata como "sem marca nenhuma" — nunca exercitado na
 * prática, porque semear não chama `runAgent` e não gasta token de IA.
 */
import { createImpersonatedClient } from "@/lib/automation/impersonate";
import { ownerMembershipsForSeed } from "@/lib/automation/queue";
import { logError } from "@/lib/logger";
import { materializarWorkspace } from "./materializar";

/**
 * Por que um workspace ficou de fora desta rodada.
 *
 * ⚠️ NÃO É `string` (rodada de conserto 1, M1): um union com `| string` no
 * fim colapsa TUDO pra `string` — `"sem-dono "` (com espaço) compilaria sem
 * aviso nenhum, e a checagem dos dois motivos fixos (`"sem-dono"`,
 * `"dono-ambiguo"`) deixaria de existir na prática. Motivo com texto livre
 * (impersonação falhou, ou a materialização lançou) vira um terceiro membro
 * do union, com o texto num campo PRÓPRIO (`mensagem`) — nunca dentro de
 * `tipo`, que continua sendo checado contra os literais.
 */
export type MotivoDoWorkspacePulado =
  | { readonly tipo: "sem-dono" }
  | { readonly tipo: "dono-ambiguo" }
  | { readonly tipo: "erro-ao-materializar" }
  | { readonly tipo: "impersonacao-falhou"; readonly mensagem: string };

export type WorkspacePulado = {
  organizationId: string;
  motivo: MotivoDoWorkspacePulado;
};

export type ResultadoDoSemear = {
  /** Quantos workspaces foram materializados de verdade nesta chamada. */
  workspaces: number;
  agentes: number;
  bases: number;
  agendamentos: number;
  webhooks: number;
  /** Agendamentos pulados dentro de workspaces materializados (ver `materializarWorkspace`). */
  agendamentosPulados: string[];
  /** Workspaces inteiros pulados — nunca chegaram a materializar. */
  workspacesPulados: WorkspacePulado[];
};

/**
 * Materializa UM workspace (`organizationId` presente) ou TODOS (ausente).
 *
 * Roda um workspace de cada vez, nunca em paralelo: é o mesmo motivo do
 * trabalhador rodar um trabalho por vez — um comando que já mexe na peça mais
 * delicada do sistema não precisa também disputar conexão com ela.
 */
export async function semearWorkspaces(organizationId?: string): Promise<ResultadoDoSemear> {
  const linhas = await ownerMembershipsForSeed(organizationId);

  // `owner_memberships_for_seed` faz `left join`: todo workspace relevante
  // aparece aqui com PELO MENOS uma linha, mesmo sem dono (`userId: null`).
  // Por isso a chave do mapa nasce da PRESENÇA da linha, não da presença de
  // um dono — só o `userId` em si é que só entra na lista quando não é nulo.
  const donosPorWorkspace = new Map<string, string[]>();
  for (const linha of linhas) {
    const lista = donosPorWorkspace.get(linha.organizationId) ?? [];
    if (linha.userId) lista.push(linha.userId);
    donosPorWorkspace.set(linha.organizationId, lista);
  }

  // Defesa extra pro `organizationId` explícito: se o valor passado nem
  // existir em `organizations`, a função do banco devolve ZERO linhas (o
  // `left join` parte DE `organizations`, então workspace inexistente não
  // aparece nunca). Ainda assim registra — não some em silêncio.
  if (organizationId && !donosPorWorkspace.has(organizationId)) {
    donosPorWorkspace.set(organizationId, []);
  }

  const resultado: ResultadoDoSemear = {
    workspaces: 0,
    agentes: 0,
    bases: 0,
    agendamentos: 0,
    webhooks: 0,
    agendamentosPulados: [],
    workspacesPulados: [],
  };

  for (const [orgId, donos] of donosPorWorkspace) {
    if (donos.length === 0) {
      resultado.workspacesPulados.push({ organizationId: orgId, motivo: { tipo: "sem-dono" } });
      continue;
    }
    if (donos.length > 1) {
      resultado.workspacesPulados.push({ organizationId: orgId, motivo: { tipo: "dono-ambiguo" } });
      continue;
    }

    const ownerId = donos[0]!;
    // Sem `jobId`: isto não é trabalho da fila (ver o comentário do topo).
    const sessao = await createImpersonatedClient({ userId: ownerId, organizationId: orgId });
    if (!sessao.ok) {
      resultado.workspacesPulados.push({
        organizationId: orgId,
        motivo: { tipo: "impersonacao-falhou", mensagem: sessao.error },
      });
      continue;
    }

    try {
      const materializado = await materializarWorkspace(sessao.sessao.supabase, orgId, ownerId);
      resultado.workspaces += 1;
      resultado.agentes += materializado.agentes;
      resultado.bases += materializado.bases;
      resultado.agendamentos += materializado.agendamentos;
      resultado.webhooks += materializado.webhooks;
      resultado.agendamentosPulados.push(...materializado.agendamentosPulados);
    } catch (err) {
      logError("seed.semear", err);
      resultado.workspacesPulados.push({
        organizationId: orgId,
        motivo: { tipo: "erro-ao-materializar" },
      });
    } finally {
      // R3 da ponte: a conexão MORRE aqui, inclusive quando deu errado.
      await sessao.sessao
        .close()
        .catch((fecharErr) => logError("seed.semear.fecharSessao", fecharErr));
    }
  }

  return resultado;
}
