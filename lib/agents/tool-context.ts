/**
 * O CONTEXTO QUE TODA FERRAMENTA RECEBE — e o ponto central da segurança desta
 * pasta.
 *
 * A ideia em uma frase: **quem escreve uma ferramenta não consegue esquecer de
 * filtrar pelo workspace, porque ele nunca chega a segurar um acesso ao banco
 * sem filtro.**
 *
 * O que uma ferramenta recebe é `ctx.db`. Toda leitura já sai com
 * `eq("organization_id", …)` colado, e toda gravação tem o `organization_id`
 * escrito por cima com o workspace da execução. Não existe `ctx.supabase`, não
 * existe `ctx.client`. Se o autor quiser dado de outro workspace, ele não tem
 * por onde pedir.
 *
 * Isso é a SEGUNDA camada. A primeira continua sendo a RLS do banco: mesmo que
 * alguém fure isto aqui, o Postgres recusa a linha. Duas camadas porque uma
 * sozinha sempre acaba tendo um buraco.
 *
 * ⚠️ O que este arquivo NÃO consegue impedir: alguém escrever
 * `import { createClient } from "@/lib/supabase/server"` dentro da ferramenta.
 * Contra isso existe o teste `tests/agents-tools-no-raw-client.test.ts`, que
 * quebra o `npm run verify`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
// Só o TIPO. `lib/knowledge/types.ts` é puro (não fala com banco, não lê
// cookie), então esta linha não arrasta nada pro lado do navegador.
import type { OrgScopedKnowledge } from "@/lib/knowledge/types";
import type { Database, TablesInsert, TablesUpdate } from "@/types/supabase";
// Só os TIPOS. `lib/agents/acoes.ts` é o mecanismo de `ctx.acao` (onda 7);
// quem MONTA a implementação de verdade é `criarAcoesDoMotor`, chamado pelo
// motor (`engine.ts`) — este arquivo só descreve a forma.
import type { Acoes, ModoDeExecucao } from "./acoes";
import type { AgentTriggerKind, OrgRole } from "./types";

type PublicTables = Database["public"]["Tables"];

/**
 * Só as tabelas que TÊM `organization_id` obrigatório.
 *
 * Passar `"profiles"` (que não tem a coluna) ou `"credentials"` (onde ela
 * aceita nulo, porque nulo ali significa "chave da plataforma") é erro de
 * COMPILAÇÃO, não de execução. O `npm run verify` pega antes de subir.
 *
 * ⚠️ `"tasks"` fica de fora, de propósito. A demo de tarefas saiu do template
 * (Onda "código é o dono"), e a migration que criava a tabela foi apagada —
 * mas o disco só decide o que roda em banco NOVO (regra 9 do CLAUDE.md), então
 * um banco que já tinha `tasks` continua com ela, órfã. A coluna
 * `organization_id` da tabela ainda existe (por isso ela QUALIFICARIA aqui
 * embaixo, estruturalmente), só que não tem mais bloco em `criarAcessos()` —
 * e é exatamente esse desalinhamento que o `Exclude` fecha: sem ele, `db.from`
 * prometeria um acesso que não existe, e o TypeScript reprovaria com um erro
 * que não aponta pra cá.
 *
 * A RAIZ do problema não é este `Exclude` — é `types/supabase.ts` ter sido
 * gerado contra um banco que ainda tem a tabela órfã. Rode `npm run types`
 * contra um banco limpo (sem `tasks`) e `PublicTables` deixa de ter a chave
 * sozinho; a partir daí este `Exclude` vira `Exclude<OrgScopedTable, never>`,
 * ou seja, morto — pode apagar. Se um dia `tasks` voltar como tabela de
 * verdade (com bloco em `criarAcessos()`), apague o `Exclude` e rode
 * `npm run types`: os dois passos andam juntos.
 */
export type OrgScopedTable = Exclude<
  {
    [K in keyof PublicTables]: PublicTables[K]["Row"] extends { organization_id: string }
      ? K
      : never;
  }[keyof PublicTables],
  "tasks"
>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O mapa de acessos, uma entrada por tabela escopada por organização.
 *
 * POR QUE ESTA LISTA É ESCRITA À MÃO, TABELA POR TABELA
 * ----------------------------------------------------
 * A versão "elegante" disto seria uma função genérica
 * `from<T extends OrgScopedTable>(t: T)` chamando `supabase.from(t)` lá dentro.
 * Isso **não compila**: os tipos do supabase-js são condicionais recursivos e,
 * com o nome da tabela ainda indefinido (um `T` genérico), o TypeScript não
 * consegue resolver nem `.eq()` nem `.insert()`. Com o seletor de colunas
 * genérico junto, ele entra em recursão e estoura a memória do `tsc` de
 * verdade — testado nesta máquina: `JavaScript heap out of memory`.
 *
 * Com o nome da tabela escrito à mão, tudo resolve na hora, o `tsc` roda em
 * segundos e a inferência do supabase-js fica intacta: **zero `any`, zero
 * `as unknown as`.** O preço é esta lista.
 *
 * ➕ CRIOU UMA TABELA NOVA COM `organization_id`? Acrescente um bloco aqui.
 *    Você não precisa lembrar: o `from()` é tipado com `OrgScopedTable`, então
 *    esquecer vira erro de compilação apontando o nome que falta.
 */
function criarAcessos(supabase: SupabaseClient<Database>, organizationId: string) {
  return {
    agent_run_steps: {
      select: () =>
        supabase.from("agent_run_steps").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"agent_run_steps">, "organization_id">) =>
        supabase.from("agent_run_steps").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"agent_run_steps">, "organization_id" | "created_by">) =>
        supabase.from("agent_run_steps").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("agent_run_steps").delete().eq("organization_id", organizationId),
    },
    agent_runs: {
      select: () => supabase.from("agent_runs").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"agent_runs">, "organization_id">) =>
        supabase.from("agent_runs").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"agent_runs">, "organization_id" | "created_by">) =>
        supabase.from("agent_runs").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("agent_runs").delete().eq("organization_id", organizationId),
    },
    agents: {
      select: () => supabase.from("agents").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"agents">, "organization_id">) =>
        supabase.from("agents").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"agents">, "organization_id" | "created_by">) =>
        supabase.from("agents").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("agents").delete().eq("organization_id", organizationId),
    },
    automation_usage: {
      select: () =>
        supabase.from("automation_usage").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"automation_usage">, "organization_id">) =>
        supabase.from("automation_usage").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"automation_usage">, "organization_id" | "created_by">) =>
        supabase.from("automation_usage").update(patch).eq("organization_id", organizationId),
      delete: () =>
        supabase.from("automation_usage").delete().eq("organization_id", organizationId),
    },
    /**
     * ⚠️ ATENÇÃO: `select()` TRAZ A COLUNA `embedding` INTEIRA — são 1536
     * números, uns 20 KB POR LINHA. Cinco linhas já passam de 100 KB, e o teto
     * de resposta de ferramenta é 8.000 caracteres: a ferramenta falha inteira,
     * e a falha NÃO diz que o motivo foi tamanho.
     *
     * Pra procurar trecho use `ctx.knowledge.search()`. Isto aqui existe pra
     * CONTAR (`.select().eq("document_id", …)` com `head`/`count`), nada mais.
     */
    document_chunks: {
      select: () =>
        supabase.from("document_chunks").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"document_chunks">, "organization_id">) =>
        supabase.from("document_chunks").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"document_chunks">, "organization_id" | "created_by">) =>
        supabase.from("document_chunks").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("document_chunks").delete().eq("organization_id", organizationId),
    },
    documents: {
      select: () => supabase.from("documents").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"documents">, "organization_id">) =>
        supabase.from("documents").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"documents">, "organization_id" | "created_by">) =>
        supabase.from("documents").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("documents").delete().eq("organization_id", organizationId),
    },
    invitations: {
      select: () => supabase.from("invitations").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"invitations">, "organization_id">) =>
        supabase.from("invitations").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"invitations">, "organization_id" | "created_by">) =>
        supabase.from("invitations").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("invitations").delete().eq("organization_id", organizationId),
    },
    jobs: {
      select: () => supabase.from("jobs").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"jobs">, "organization_id">) =>
        supabase.from("jobs").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"jobs">, "organization_id" | "created_by">) =>
        supabase.from("jobs").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("jobs").delete().eq("organization_id", organizationId),
    },
    knowledge_bases: {
      select: () =>
        supabase.from("knowledge_bases").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"knowledge_bases">, "organization_id">) =>
        supabase.from("knowledge_bases").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"knowledge_bases">, "organization_id" | "created_by">) =>
        supabase.from("knowledge_bases").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("knowledge_bases").delete().eq("organization_id", organizationId),
    },
    memberships: {
      select: () => supabase.from("memberships").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"memberships">, "organization_id">) =>
        supabase.from("memberships").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"memberships">, "organization_id" | "created_by">) =>
        supabase.from("memberships").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("memberships").delete().eq("organization_id", organizationId),
    },
    /**
     * ⚠️ ATENÇÃO: aqui só `select()` funciona de verdade.
     *
     * `insert()`, `update()` e `delete()` COMPILAM e FALHAM EM EXECUÇÃO com o
     * código 42501 ("permission denied"). Não é bug: quem está logado não tem
     * permissão de escrita nesta tabela, de propósito — o teto de gasto é
     * gravado por `set_org_ai_limits` (dono/admin do workspace) e por
     * `set_org_platform_cap` (dono do sistema), que conferem quem está pedindo.
     * Se uma ferramenta pudesse dar `update` aqui, furar o próprio teto seria
     * uma linha de código.
     */
    org_ai_limits: {
      select: () =>
        supabase.from("org_ai_limits").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"org_ai_limits">, "organization_id">) =>
        supabase.from("org_ai_limits").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"org_ai_limits">, "organization_id" | "created_by">) =>
        supabase.from("org_ai_limits").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("org_ai_limits").delete().eq("organization_id", organizationId),
    },
    /**
     * ⚠️ MESMA COISA, e aqui é ainda mais importante: este é o MEDIDOR de
     * gasto. `insert()`, `update()` e `delete()` compilam e falham com 42501.
     * Quem soma é `org_ai_spend_add`, dentro da mesma transação que fecha a
     * execução. Zerar o medidor não é uma operação que exista.
     */
    org_ai_spend: {
      select: () => supabase.from("org_ai_spend").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"org_ai_spend">, "organization_id">) =>
        supabase.from("org_ai_spend").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"org_ai_spend">, "organization_id" | "created_by">) =>
        supabase.from("org_ai_spend").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("org_ai_spend").delete().eq("organization_id", organizationId),
    },
    schedules: {
      select: () => supabase.from("schedules").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"schedules">, "organization_id">) =>
        supabase.from("schedules").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"schedules">, "organization_id" | "created_by">) =>
        supabase.from("schedules").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("schedules").delete().eq("organization_id", organizationId),
    },
    thread_messages: {
      select: () =>
        supabase.from("thread_messages").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"thread_messages">, "organization_id">) =>
        supabase.from("thread_messages").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"thread_messages">, "organization_id" | "created_by">) =>
        supabase.from("thread_messages").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("thread_messages").delete().eq("organization_id", organizationId),
    },
    threads: {
      select: () => supabase.from("threads").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"threads">, "organization_id">) =>
        supabase.from("threads").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"threads">, "organization_id" | "created_by">) =>
        supabase.from("threads").update(patch).eq("organization_id", organizationId),
      delete: () => supabase.from("threads").delete().eq("organization_id", organizationId),
    },
    /**
     * ⚠️ ATENÇÃO: `select()` aqui COMPILA e FALHA EM EXECUÇÃO com o código
     * 42501 ("permission denied for column token_hash"). Não é bug: a coluna
     * `token_hash` fica FORA do `grant select` de propósito, pra que nem uma
     * ferramenta nem uma consulta distraída consiga levar o hash do token
     * embora. É a rede de segurança funcionando.
     *
     * Quem precisa listar webhook usa `lib/automation/queries.ts`, que pede as
     * colunas na mão.
     *
     * ⚠️ `update()` EXCLUI `token_hash` e `token_prefix` do tipo, além de
     * `organization_id`/`created_by`. Girar o segredo do webhook é ação
     * HUMANA e NOMEADA (`girarTokenDoWebhookAction`, atrás de
     * `requireOrgRole`) — uma ferramenta de agente não decide rotação de
     * credencial. A migration `20260823020000_grant_update_token_webhook.sql`
     * deu `grant update (token_hash, token_prefix)` pra essa tela funcionar,
     * mas o grant vale pro papel `authenticated` inteiro, tela E ferramenta
     * de agente juntas — quem fecha a ferramenta é este `Omit`. Ler já era
     * impossível (`token_hash` nunca teve `grant select`, ver acima); o risco
     * real aqui era ESCREVER: uma ferramenta futura gravando um hash
     * escolhido giraria o segredo do webhook sem passar pela ação humana.
     * `tests/agents-tool-context-webhook-token.test.ts` trava isso lendo o
     * `Omit` no fonte.
     */
    webhook_endpoints: {
      select: () =>
        supabase.from("webhook_endpoints").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"webhook_endpoints">, "organization_id">) =>
        supabase.from("webhook_endpoints").insert({ ...values, organization_id: organizationId }),
      update: (
        patch: Omit<
          TablesUpdate<"webhook_endpoints">,
          "organization_id" | "created_by" | "token_hash" | "token_prefix"
        >,
      ) => supabase.from("webhook_endpoints").update(patch).eq("organization_id", organizationId),
      delete: () =>
        supabase.from("webhook_endpoints").delete().eq("organization_id", organizationId),
    },
    whatsapp_instances: {
      select: () =>
        supabase.from("whatsapp_instances").select("*").eq("organization_id", organizationId),
      insert: (values: Omit<TablesInsert<"whatsapp_instances">, "organization_id">) =>
        supabase.from("whatsapp_instances").insert({ ...values, organization_id: organizationId }),
      update: (patch: Omit<TablesUpdate<"whatsapp_instances">, "organization_id">) =>
        supabase.from("whatsapp_instances").update(patch).eq("organization_id", organizationId),
      delete: () =>
        supabase.from("whatsapp_instances").delete().eq("organization_id", organizationId),
    },
  };
}

/** O conjunto de acessos de uma tabela: `select`, `insert`, `update`, `delete`. */
type AcessosPorTabela = ReturnType<typeof criarAcessos>;

/**
 * Monta o acesso ao banco JÁ PRESO a um workspace.
 *
 * O tipo de retorno é INFERIDO de propósito (a função não leva anotação de
 * retorno): é o que preserva 100% da inferência do supabase-js. Quem precisar
 * do tipo usa `OrgScopedDb`, logo abaixo.
 *
 * A garantia mora aqui dentro, e ela é possível por causa de um detalhe do
 * PostgREST: filtro só se ACUMULA, nunca se remove. Quem recebe o construtor
 * de consulta já filtrado pode acrescentar quantos filtros quiser — e não tem
 * como tirar o `eq("organization_id", …)` que já está lá, nem de propósito.
 */
export function createOrgScopedDb(supabase: SupabaseClient<Database>, organizationId: string) {
  if (!UUID_RE.test(organizationId)) {
    // Não é mensagem de tela: é erro de programação de quem montou o contexto.
    // Explode alto, cedo, e não deixa passar um filtro vazio.
    throw new Error("createOrgScopedDb: organizationId inválido");
  }

  const acessos = criarAcessos(supabase, organizationId);

  return {
    /** O workspace ao qual TUDO aqui dentro está preso. */
    organizationId,

    /**
     * Abre uma tabela já presa ao workspace.
     *
     * - `select()` lê todas as colunas daquela tabela, já filtradas. Encadeie
     *   o resto normalmente: `.eq("status", "pending").order("created_at")`.
     *   Não dá pra escolher colunas — ver a nota em `criarAcessos` sobre por
     *   que o seletor de colunas genérico derruba o `tsc`.
     * - `insert()` NÃO aceita `organization_id`: ele é escrito por cima.
     * - `update()` e `delete()` já saem filtrados pelo workspace.
     */
    from<T extends OrgScopedTable>(table: T): AcessosPorTabela[T] {
      return acessos[table];
    },
  };
}

/** O banco visto de dentro de uma ferramenta: sempre preso a um workspace. */
export type OrgScopedDb = ReturnType<typeof createOrgScopedDb>;

/**
 * Tudo o que uma ferramenta enxerga do mundo.
 *
 * Repare no que NÃO existe aqui: nenhum `supabase`, nenhum `client`, nenhum
 * `db` cru. O único jeito de tocar no banco de dentro de uma ferramenta é
 * `ctx.db`, que já vem escopado.
 */
export type ToolContext = {
  /** O workspace dono da execução. Já embutido no `ctx.db`. */
  readonly organizationId: string;
  /** Apelido do workspace na URL. Serve pra montar link na resposta. */
  readonly organizationSlug: string;
  /** Nome do workspace como o aluno escreveu. Também vai pro prompt. */
  readonly organizationName: string;
  /** Quem mandou rodar. */
  readonly userId: string;
  /** O papel dessa pessoa neste workspace. É o que filtra `requiresRole`. */
  readonly role: OrgRole;
  /** A execução em que essa ferramenta está rodando (pro rastro). */
  readonly runId: string;
  /** Apelido do agente que pediu a ferramenta. */
  readonly agentSlug: string;
  /** De onde veio o gatilho: chat, botão, agendamento ou webhook. */
  readonly triggerKind: AgentTriggerKind;
  /** Cancelamento: quando a pessoa fecha a tela ou o tempo estoura. */
  readonly signal: AbortSignal | undefined;
  /** O banco, já preso a este workspace. É a única porta. */
  readonly db: OrgScopedDb;
  /**
   * A base de conhecimento, já presa a este workspace.
   *
   * MESMO ESPÍRITO DO `ctx.db`: uma capacidade NOMEADA e estreita, não um
   * cliente cru. Continua não existindo `ctx.supabase` nem `ctx.rpc`.
   *
   * ⚠️ É POR AQUI QUE SE PROCURA TRECHO DE DOCUMENTO, nunca por
   * `ctx.db.from("document_chunks")` — aquele `select()` traz a coluna
   * `embedding` inteira (~20 KB por linha) e estoura o teto de resposta de
   * ferramenta sem dizer por quê.
   */
  readonly knowledge: OrgScopedKnowledge;
  /**
   * O modo desta execução. `"ensaio"` = nada sai pra fora.
   *
   * A ferramenta quase nunca precisa olhar isto: quem intercepta de verdade é
   * o `ctx.acao`, mais abaixo. Este campo existe pra ferramenta conseguir
   * escrever uma frase melhor quando quiser ("em ensaio, eu teria…") — sem
   * precisar inferir o modo a partir do resultado da ação.
   */
  readonly modo: ModoDeExecucao;
  /**
   * A ÚNICA PORTA PRA AGIR — mandar email, chamar sistema de fora.
   *
   * MESMO ESPÍRITO DO `ctx.db` e do `ctx.knowledge`: uma capacidade NOMEADA e
   * estreita, nunca um `fetch` cru nem um `import` direto de `lib/email`. Em
   * `modo = "ensaio"` ela não age de verdade — devolve `simulado: true` com o
   * que teria feito, e grava esse passo no rastro sozinha (a ferramenta não
   * precisa lembrar de gravar nada).
   *
   * ⚠️ Ferramenta que importe `lib/email` ou chame `fetch` direto está errada
   * por construção (regra 10-K do CLAUDE.md raiz): em ensaio ela agiria de
   * verdade achando que estava simulando. A guarda contra isso é um teste que
   * vasculha `lib/agents/tools/**` atrás desses dois padrões — mesma
   * disciplina do `ctx.db` (regra 10-A): quem protege é não existir outro
   * caminho; o teste é rede, não mecanismo.
   */
  readonly acao: Acoes;
};
