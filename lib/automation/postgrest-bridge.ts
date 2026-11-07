/**
 * A PONTE: o `fetch` que o cliente do Supabase usa quando não existe ninguém
 * logado.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ LEIA ISTO ANTES DE MEXER. É a peça mais delicada da automação.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * O PROBLEMA, EM UMA FRASE
 * ------------------------
 * Agendamento e webhook rodam sem ninguém logado. O template NÃO tem chave de
 * service role (foi tirada de propósito) e NÃO tem a chave que assina os
 * tokens do Supabase — ou seja, não existe jeito de fabricar um token que a
 * API do Supabase aceite. Só que o motor (`runAgent`) exige um cliente do
 * Supabase de verdade, e todas as regras de segurança do banco descobrem quem
 * é a pessoa por `auth.uid()`.
 *
 * A SAÍDA
 * -------
 * Um cliente do Supabase DE VERDADE, com o `fetch` trocado por este arquivo.
 * Os pedidos que ele faria pra internet (`/rest/v1/...`) viram consultas SQL
 * numa conexão que entra como `authenticated` levando
 * `request.jwt.claims = { sub: <quem a automação representa> }`. Resultado:
 * `auth.uid()` funciona e AS MESMAS REGRAS DE SEGURANÇA VALEM. A isolação
 * continua sendo do banco, não da disciplina de quem programa.
 *
 * O que isso custa: este arquivo reimplementa o pedacinho da API do Supabase
 * que o nosso próprio código usa. O pior caso de um erro de tradução aqui é
 * **linha errada dentro do MESMO workspace** — nunca vazamento entre
 * workspaces, porque a regra do banco continua valendo por baixo.
 *
 * AS REGRAS QUE FAZEM ISSO VALER (cada uma tem teste)
 * ---------------------------------------------------
 * R1. O papel `authenticated` é trocado no `connect` da conexão, em nível de
 *     SESSÃO (ver `pg.ts`). Falha fechada.
 * R2. TODA consulta roda dentro de uma transação explícita, e os três
 *     `set_config` usam `is_local = true`. Sem isso a identidade vazaria pro
 *     próximo trabalho na mesma conexão.
 * R3. UMA conexão por trabalho, destruída no fim (`encerrar()`).
 * R4. SQL só por parâmetro (`$1`, `$2`…). Nome de tabela sai de lista fechada;
 *     nome de coluna passa por expressão regular E é conferido contra a lista
 *     de colunas daquela tabela. VALOR nunca entra no texto da consulta.
 * R5. A ponte serve `/rest/v1/*` e MAIS NADA. Storage, auth, realtime e
 *     functions levam `BridgeUnsupportedError` — erro com nome, alto. Foi por
 *     causa disto que a ingestão de documento NÃO roda pela fila.
 * R6. Lista fechada de funções (`FUNCOES_DA_PONTE`).
 * R7. Lista fechada de operadores (`OPERADORES_DA_PONTE`).
 * R8. Quem serializa é o Postgres (`json_agg` + `::text`). Nenhuma data,
 *     nenhum número grande e nenhum `jsonb` é formatado por JavaScript — é o
 *     mesmo caminho que a API do Supabase usa, então não existe divergência.
 * R9. A ponte NUNCA fala com `systemPool()`. Só `queue.ts` fala.
 *
 * ⚠️ NÃO FAÇA (pra ninguém "melhorar" isso depois):
 *   ❌ concatenar valor dentro do texto da consulta "só nesse caso";
 *   ❌ deixar a ponte responder `/storage/v1/*` "porque seria prático";
 *   ❌ ampliar `FUNCOES_DA_PONTE` sem olhar o que a função faz com `auth.uid()`.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import type pg from "pg";
import type { OrgScopedTable } from "@/lib/agents/tool-context";
import type { Database } from "@/types/supabase";

// ---------------------------------------------------------------------------
// O erro com nome
// ---------------------------------------------------------------------------

/**
 * "Isso a ponte não sabe fazer."
 *
 * Existe com nome próprio porque a alternativa é o pior tipo de defeito: a
 * automação devolver DADO ERRADO em silêncio. Quando isto estoura, o trabalho
 * falha com uma frase específica e o agendamento é PAUSADO — em vez de falhar
 * todo dia às 8h sem ninguém entender.
 */
export class BridgeUnsupportedError extends Error {
  readonly detalhe: string;

  constructor(detalhe: string) {
    super(
      `Essa automação usa um recurso do banco que ainda não roda sozinho (fora da tela): ${detalhe}`,
    );
    this.name = "BridgeUnsupportedError";
    this.detalhe = detalhe;
  }
}

export function isBridgeUnsupportedError(err: unknown): err is BridgeUnsupportedError {
  return err instanceof BridgeUnsupportedError;
}

// ---------------------------------------------------------------------------
// R4 — as listas fechadas de TABELA
// ---------------------------------------------------------------------------

/**
 * As tabelas escopadas por workspace. É a mesma lista que o `ctx.db` das
 * ferramentas enxerga (`OrgScopedTable`), então uma ferramenta que roda no
 * painel roda igual na automação.
 */
export const TABELAS_DA_PONTE: readonly OrgScopedTable[] = [
  "agent_run_steps",
  "agent_runs",
  "agents",
  "automation_usage",
  "document_chunks",
  "documents",
  "invitations",
  "jobs",
  "knowledge_bases",
  "memberships",
  "org_ai_limits",
  "org_ai_spend",
  "schedules",
  "thread_messages",
  "threads",
  "webhook_endpoints",
];

/**
 * ⚠️ DIFERENÇA EM RELAÇÃO AO CONTRATO, ANOTADA DE PROPÓSITO.
 *
 * O contrato declarava `TABELAS_DA_PONTE: readonly OrgScopedTable[]` e mais
 * nada. Só que `runAgent` exige `organization: { id, slug, name }` — o apelido
 * do workspace vai pro link que a ferramenta devolve, e o nome vai pro prompt.
 * A linha da fila (`jobs`) carrega só o `organization_id`, e `organizations`
 * NÃO tem coluna `organization_id` (ela é a própria organização), então não
 * cabe em `OrgScopedTable`.
 *
 * As alternativas eram piores: ler `organizations` pelo conjunto de conexão de
 * SISTEMA seria SQL solto rodando como `postgres` (sem regra de segurança) —
 * exatamente o que a regra R9 proíbe.
 *
 * Continua sendo lista FECHADA, e a tabela continua sob a regra de segurança
 * do banco ("members read their orgs"): quem a automação representa só enxerga
 * o workspace do qual ele é membro.
 */
export const TABELAS_DE_APOIO_DA_PONTE = ["organizations"] as const;

export type TabelaDaPonte = OrgScopedTable | (typeof TABELAS_DE_APOIO_DA_PONTE)[number];

function ehTabelaDaPonte(nome: string): nome is TabelaDaPonte {
  return (
    (TABELAS_DA_PONTE as readonly string[]).includes(nome) ||
    (TABELAS_DE_APOIO_DA_PONTE as readonly string[]).includes(nome)
  );
}

// ---------------------------------------------------------------------------
// R4 — as colunas de cada tabela
// ---------------------------------------------------------------------------

type ColunasDeclaradas = {
  readonly [T in TabelaDaPonte]: readonly (keyof Database["public"]["Tables"][T]["Row"])[];
};

/**
 * Lista escrita à mão, tabela por tabela — a mesma disciplina de
 * `lib/agents/tool-context.ts`, e pelo mesmo motivo: o TypeScript confere que
 * nenhum nome aqui é inventado, e a conferência logo abaixo garante que
 * nenhuma coluna ficou de fora.
 *
 * ➕ CRIOU COLUNA NOVA? O `npm run verify` quebra apontando o nome que falta.
 */
export const COLUNAS_DA_PONTE = {
  agent_run_steps: [
    "cost_micros",
    "created_at",
    "duration_ms",
    "error_message",
    "id",
    "input",
    "kind",
    "organization_id",
    "output",
    "run_id",
    "seq",
    // ⚠️ Onda 7. Alfabeticamente vem DEPOIS de "seq" ("seq" < "simulado" — o
    // brief da tarefa 1 pedia entre "run_id" e "seq", mas isso quebraria a
    // ordem alfabética que o teste `automation-bridge-colunas.test.ts` confere.
    "simulado",
    "tokens_input",
    "tokens_output",
    "tool_name",
  ],
  agent_runs: [
    "agent_id",
    "agent_slug",
    "cost_micros",
    "created_at",
    "error_message",
    "finished_at",
    "id",
    "input",
    "model",
    // ⚠️ Onda 7. Sem esta linha, `createRun` (`lib/agents/recorder.ts`) manda
    // `modo` num `insert` que a ponte recusa por coluna desconhecida — e a
    // AUTOMAÇÃO, que é justamente quem nasce em ensaio (regra 10-L), perderia a
    // execução inteira. Alfabeticamente "model" < "modo" < "organization_id"
    // (a ordem é conferida por `tests/automation-bridge-colunas.test.ts`).
    "modo",
    "organization_id",
    "output",
    "started_at",
    "status",
    "thread_id",
    "tokens_input",
    "tokens_output",
    "trigger_kind",
    "triggered_by",
  ],
  agents: [
    "config",
    "created_at",
    "created_by",
    "description",
    "id",
    "max_output_tokens",
    "max_steps",
    "model",
    "name",
    "organization_id",
    "slug",
    "status",
    "system_prompt",
    "temperature",
    "tools",
    "updated_at",
  ],
  automation_usage: ["day", "organization_id", "tokens_used"],
  document_chunks: [
    "content",
    "created_at",
    "document_id",
    "embedding",
    "id",
    "knowledge_base_id",
    "organization_id",
    "seq",
    "tokens",
  ],
  documents: [
    "byte_size",
    "char_count",
    "chunk_count",
    "content",
    "created_at",
    "created_by",
    "embed_cost_micros",
    "embed_tokens",
    "embedding_model",
    "error_message",
    "id",
    "knowledge_base_id",
    "mime_type",
    "organization_id",
    "processed_at",
    "source_kind",
    "status",
    "storage_path",
    "title",
    "updated_at",
  ],
  invitations: [
    "accepted_at",
    "created_at",
    "email",
    "expires_at",
    "id",
    "invited_by",
    "organization_id",
    "role",
    "token",
  ],
  jobs: [
    "agent_id",
    "attempts",
    "created_at",
    "finished_at",
    "id",
    "idempotency_key",
    "kind",
    "last_error",
    "locked_at",
    "locked_by",
    "max_attempts",
    "organization_id",
    "payload",
    "run_after",
    "run_as",
    "run_id",
    "source_id",
    "source_kind",
    "started_at",
    "status",
    "updated_at",
  ],
  knowledge_bases: [
    "created_at",
    "created_by",
    "description",
    "embedding_dimensions",
    "embedding_model",
    "id",
    "name",
    "organization_id",
    "slug",
    "status",
    "updated_at",
  ],
  memberships: ["created_at", "id", "organization_id", "role", "user_id"],
  organizations: ["created_at", "created_by", "id", "logo_url", "name", "slug", "updated_at"],
  // ⚠️ As duas tabelas do teto de gasto entram aqui SÓ PRA LEITURA. Escrever
  // nelas falha com 42501 do outro lado (não existe grant de escrita pra quem
  // está logado) — é o desenho, não um esquecimento.
  org_ai_limits: [
    "alert_at_percent",
    "alert_level",
    "alert_month",
    "created_at",
    "daily_budget_micros",
    "hard_stop",
    "max_run_cost_micros",
    "monthly_budget_micros",
    "organization_id",
    "platform_cap_micros",
    "updated_at",
    "updated_by",
  ],
  org_ai_spend: [
    "agent_micros",
    "day",
    "embedding_micros",
    "organization_id",
    "unpriced_documents",
    "unpriced_runs",
    "updated_at",
  ],
  schedules: [
    "agent_id",
    "created_at",
    "created_by",
    "day_of_month",
    // Onda 7. `{ tipo: 'nenhuma' | 'email' | 'conexao', ... }` — pra onde o
    // resultado do agendamento vai quando `modo` é 'real'.
    "entrega",
    "every_minutes",
    "hour",
    "id",
    "input",
    "is_active",
    "kind",
    "last_error",
    "last_run_at",
    "minute",
    // Onda 7. 'ensaio' (padrão) ou 'real' — se a ferramenta de agir só simula
    // ou executa de verdade.
    "modo",
    "name",
    "next_run_at",
    "organization_id",
    "run_as",
    // Apelido da declaração em arquivo (chave do materializador). Nulo = linha
    // criada no painel, que o materializador nunca toca.
    "slug",
    "timezone",
    "updated_at",
    "weekdays",
  ],
  thread_messages: [
    "created_at",
    "id",
    "metadata",
    "organization_id",
    "parts",
    "role",
    "run_id",
    "seq",
    "thread_id",
  ],
  threads: [
    "agent_id",
    "created_at",
    "id",
    "last_message_at",
    "message_count",
    "organization_id",
    "title",
    "updated_at",
    "user_id",
  ],
  webhook_endpoints: [
    "agent_id",
    "calls_count",
    "created_at",
    "created_by",
    // Onda 7. Se true, quem chamou o webhook espera a resposta do agente na
    // hora (em vez do 202 de "tá na fila").
    "esperar_resposta",
    "id",
    "is_active",
    "label",
    "last_called_at",
    // Onda 7. 'ensaio' (padrão) ou 'real' — mesma regra de `schedules.modo`.
    "modo",
    "organization_id",
    "run_as",
    // Apelido da declaração em arquivo (chave do materializador). Nulo = linha
    // criada no painel, que o materializador nunca toca.
    "slug",
    "token_hash",
    "token_prefix",
    "updated_at",
    "window_count",
    "window_started_at",
  ],
  whatsapp_instances: [
    "cloud_access_token",
    "cloud_phone_number_id",
    "cloud_waba_id",
    "connected_at",
    "created_at",
    "id",
    "instance_name",
    "last_seen_at",
    "organization_id",
    "phone_number",
    "provider",
    "qr_code",
    "status",
    "updated_at",
  ],
} satisfies ColunasDeclaradas;

/** Coluna que existe no banco e ficou de fora da lista acima. */
type ColunaEsquecida = {
  [T in TabelaDaPonte]: Exclude<
    keyof Database["public"]["Tables"][T]["Row"],
    (typeof COLUNAS_DA_PONTE)[T][number]
  >;
}[TabelaDaPonte];

/**
 * A CONFERÊNCIA: quando alguma coluna nova fica de fora de `COLUNAS_DA_PONTE`,
 * `ColunaEsquecida` deixa de ser `never` e a linha abaixo vira erro de
 * compilação com o NOME da coluna que falta. É o que impede o defeito mais
 * chato de diagnosticar do template: "funciona no painel, falha às 8h".
 */
type ConferenciaDeColunas = [ColunaEsquecida] extends [never] ? true : ColunaEsquecida;
export const COLUNAS_DA_PONTE_CONFERIDAS: ConferenciaDeColunas = true;

const NOME_DE_COLUNA_RE = /^[a-z_][a-z0-9_]*$/;

function colunaValida(tabela: TabelaDaPonte, nome: string): string {
  if (!NOME_DE_COLUNA_RE.test(nome)) {
    throw new BridgeUnsupportedError(`nome de coluna fora do formato ("${nome}")`);
  }
  const conhecidas = COLUNAS_DA_PONTE[tabela] as readonly string[];
  if (!conhecidas.includes(nome)) {
    throw new BridgeUnsupportedError(`a tabela "${tabela}" não tem a coluna "${nome}"`);
  }
  return nome;
}

// ---------------------------------------------------------------------------
// R6 — a lista fechada de FUNÇÕES
// ---------------------------------------------------------------------------

export const FUNCOES_DA_PONTE = [
  "consume_llm_tokens",
  "finish_agent_run",
  "resolve_credential",
  "match_document_chunks",
  // ⚠️ SEM ESTA LINHA O TETO DE GASTO FUNCIONA NO PAINEL E QUEBRA ÀS 8H DA
  // MANHÃ: o motor lê o teto no passo 2a, e pela automação essa leitura passa
  // por aqui. É exatamente a pegadinha que o CLAUDE.md desta pasta descreve.
  "org_ai_budget_status",
  // ⚠️ SEM ESTA LINHA A AUTOMAÇÃO RODA E NÃO DEIXA RASTRO. Medido: pelo painel
  // a execução gravava 3 passos e US$ 0,0005; pela automação gravava ZERO
  // passos e custo zero — o agente respondia certo e o histórico ficava vazio,
  // o gasto invisível pro teto e o aluno sem nada pra depurar.
  //
  // Aconteceu porque gravar passo deixou de ser `insert` e virou função (a
  // correção do preço forjado), e a ponte só conhece o que está nesta lista.
  "record_agent_run_step",
  // Indexar documento pela fila soma o custo do embedding por aqui.
  "org_ai_spend_add",
  // A ferramenta buscar-na-base roda dentro do agente, inclusive agendado.
  "org_ai_spend_add_embedding",
  // As quatro de indexar documento. Desde que ler o arquivo virou trabalho de
  // fila, ELAS RODAM AQUI — antes rodavam só na requisição do upload.
  "start_document_processing",
  "append_document_chunks",
  "finish_document_indexing",
  "fail_document",
] as const;

export type FuncaoDaPonte = (typeof FUNCOES_DA_PONTE)[number];

/**
 * O formato de cada função, porque o SQL muda:
 *   • "setof"   → devolve linhas   → `json_agg`
 *   • "escalar" → devolve um valor → `to_json`
 *   • "vazio"   → não devolve nada → resposta 204, sem corpo
 *
 * Os nomes dos argumentos também são lista fechada: só eles viram
 * `nome => $n`. Qualquer outro estoura alto.
 *
 * `args`/`json` são tipados por `keyof Database["public"]["Functions"][F]["Args"]`
 * — NÃO por `readonly string[]` genérico — pelo MESMO motivo de
 * `ColunasDeclaradas` (acima): com um tipo contextual genérico, o array
 * literal escrito à mão infere pra `string[]` largo (perde o literal de cada
 * nome), e a conferência `ArgumentoEsquecido` logo abaixo nunca acusaria
 * nada — o defeito ficaria com cara de resolvido sem estar. Com o tipo
 * contextual sendo o `keyof` de verdade, dois efeitos de graça: (1) nome de
 * argumento inventado já quebra `npm run typecheck` na hora de ESCREVER a
 * lista, não só na conferência; (2) `(typeof FORMA_DA_FUNCAO)[F]["args"][number]`
 * fica literal o bastante pra `Exclude` funcionar.
 */
type FormaDaFuncaoDeclarada = {
  readonly [F in FuncaoDaPonte]: {
    forma: "setof" | "escalar" | "vazio";
    args: readonly (keyof Database["public"]["Functions"][F]["Args"])[];
    json?: readonly (keyof Database["public"]["Functions"][F]["Args"])[];
  };
};

export const FORMA_DA_FUNCAO = {
  consume_llm_tokens: { forma: "escalar", args: ["_tokens"], json: undefined },
  // ⚠️ "escalar", NÃO "vazio": desde a onda 6 ela devolve `jsonb`
  // (`{"alerta": 80|100|null}`). Deixar "vazio" faria a ponte responder 204 e o
  // aviso do teto sumir no caminho da automação.
  finish_agent_run: {
    forma: "escalar",
    args: ["_run_id", "_status", "_output", "_error_message"],
    json: undefined,
  },
  org_ai_budget_status: { forma: "setof", args: ["_organization_id"], json: undefined },
  resolve_credential: { forma: "setof", args: ["_organization_id", "_provider"], json: undefined },
  match_document_chunks: {
    forma: "setof",
    args: ["_organization_id", "_knowledge_base_id", "_embedding", "_limite", "_min_similarity"],
    json: undefined,
  },
  record_agent_run_step: {
    forma: "vazio",
    json: ["_input", "_output"],
    args: [
      "_run_id",
      "_seq",
      "_kind",
      "_tool_name",
      "_input",
      "_output",
      "_error_message",
      "_duration_ms",
      "_tokens_input",
      "_tokens_output",
      "_cost_micros",
      // ⚠️ SEM ESTE ARGUMENTO, TODO PASSO DE AÇÃO (`ctx.acao`, onda 7) GRAVADO
      // POR UMA AUTOMAÇÃO ESTOURA `BridgeUnsupportedError` — silenciosamente
      // engolido por `recorder.ts` (gravar rastro nunca derruba a execução),
      // mas o passo simplesmente NUNCA aparece no rastro de um agendamento ou
      // webhook. Pelo painel funcionaria (o cliente ali fala com a API de
      // verdade, que já aceita `_simulado` desde a migration
      // `20260821120000_rastro_marca_passo_simulado.sql`) — é exatamente o
      // defeito que este arquivo inteiro existe pra impedir, na outra metade.
      "_simulado",
    ],
  },
  org_ai_spend_add: {
    forma: "vazio",
    args: [
      "_organization_id",
      "_agent_micros",
      "_embedding_micros",
      "_unpriced_runs",
      "_unpriced_documents",
    ],
    json: undefined,
  },
  org_ai_spend_add_embedding: {
    forma: "vazio",
    args: ["_organization_id", "_tokens"],
    json: undefined,
  },
  start_document_processing: { forma: "escalar", args: ["_document_id"], json: undefined },
  append_document_chunks: {
    forma: "escalar",
    json: ["_chunks"],
    args: ["_document_id", "_chunks"],
  },
  finish_document_indexing: {
    forma: "vazio",
    args: ["_document_id", "_embedding_model", "_embed_tokens", "_embed_cost_micros"],
    json: undefined,
  },
  fail_document: { forma: "vazio", args: ["_document_id", "_motivo"], json: undefined },
} satisfies FormaDaFuncaoDeclarada;

/**
 * Argumento que a função aceita DE VERDADE no banco (`Database["public"]["Functions"]`,
 * gerado por `npm run types`/`types:local`) mas ficou de fora do `args`
 * declarado em `FORMA_DA_FUNCAO` pra ela.
 *
 * ⚠️ ESTA É A TERCEIRA VEZ que "declarado à mão diverge do banco de verdade"
 * aparece neste projeto (as duas primeiras: `COLUNAS_DA_PONTE`, que tem a
 * mesma conferência logo acima neste arquivo, e o próprio `_simulado` que
 * fugiu desta lista até alguém ir olhar o banco na mão). Fonte da verdade é
 * o tipo GERADO, não uma lista de novo mantida à mão — senão o próximo
 * argumento novo passa batido do mesmo jeito.
 */
type ArgumentoEsquecido = {
  [F in FuncaoDaPonte]: Exclude<
    keyof Database["public"]["Functions"][F]["Args"],
    (typeof FORMA_DA_FUNCAO)[F]["args"][number]
  >;
}[FuncaoDaPonte];

/**
 * A CONFERÊNCIA: quando uma função da ponte ganha um argumento novo no banco
 * e ninguém acrescenta em `FORMA_DA_FUNCAO`, `ArgumentoEsquecido` deixa de
 * ser `never` e a linha abaixo vira erro de compilação com o NOME do
 * argumento que falta — `npm run typecheck` (parte de `npm run verify`) pega
 * antes de a automação quebrar em silêncio.
 */
type ConferenciaDeArgumentos = [ArgumentoEsquecido] extends [never] ? true : ArgumentoEsquecido;
export const FORMA_DA_FUNCAO_CONFERIDA: ConferenciaDeArgumentos = true;

export const OPERADORES_DA_PONTE = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "cs",
  "cd",
  "not",
] as const;

export type OperadorDaPonte = (typeof OPERADORES_DA_PONTE)[number];

/** Operador → o sinal correspondente no SQL. `is`, `in` e `not` são à parte. */
const SINAL_SQL: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "like",
  ilike: "ilike",
  cs: "@>",
  cd: "<@",
};

/** Os parâmetros de URL que NÃO são filtro. */
const PARAMETROS_RESERVADOS = new Set(["select", "order", "limit", "offset"]);

// ---------------------------------------------------------------------------
// O tipo público
// ---------------------------------------------------------------------------

export type BridgeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * O que `createBridgeFetch` devolve de verdade: um `BridgeFetch` com dois
 * botões junto.
 *
 * Ele continua sendo aceito em todo lugar que espera um `fetch`:
 *
 * • `encerrar()` — existe pra `impersonate.ts` conseguir DESTRUIR a conexão no
 *   fim do trabalho (regra R3), coisa que uma função solta não teria como
 *   oferecer.
 * • `recursoNaoSuportado()` — o detalhe do último `BridgeUnsupportedError`,
 *   ou `null`. Existe porque o cliente do Supabase ENGOLE a exceção que sai do
 *   `fetch` e a transforma num erro de rede comum; sem esta memória, "essa
 *   ferramenta ainda não roda sozinha" chegaria em `run-job.ts` disfarçado de
 *   "o provedor não respondeu", e o agendamento continuaria falhando todo dia.
 */
export type PonteFetch = BridgeFetch & {
  encerrar(): Promise<void>;
  recursoNaoSuportado(): string | null;
};

type ClaimsDaPonte = { sub: string; role: "authenticated" };

/** Teto de tempo de UMA consulta. Vira `SET LOCAL statement_timeout`. */
const TETO_DE_TEMPO_POR_CONSULTA_MS = 20_000;

// ---------------------------------------------------------------------------
// Tradução: pedido HTTP → SQL
// ---------------------------------------------------------------------------

type Consulta = { text: string; values: unknown[] };

/** Acumula os valores e devolve o `$n` de cada um. Nenhum valor vira texto. */
class Parametros {
  readonly values: unknown[] = [];

  add(valor: unknown): string {
    this.values.push(valor);
    return `$${this.values.length}`;
  }
}

/**
 * Quebra a lista de um filtro `in.(a,b,"c,d")`.
 *
 * A API do Supabase põe aspas duplas em volta do valor quando ele tem vírgula
 * dentro, e escapa aspas com `\"`. Sem isto, um valor com vírgula viraria dois
 * valores — e o filtro devolveria linha errada em silêncio.
 */
function separarLista(bruto: string): string[] {
  const itens: string[] = [];
  let atual = "";
  let dentroDeAspas = false;
  let escapando = false;

  for (const c of bruto) {
    if (escapando) {
      atual += c;
      escapando = false;
      continue;
    }
    if (c === "\\") {
      escapando = true;
      continue;
    }
    if (c === '"') {
      dentroDeAspas = !dentroDeAspas;
      continue;
    }
    if (c === "," && !dentroDeAspas) {
      itens.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  itens.push(atual);
  return itens;
}

/**
 * `*` é o curinga da API do Supabase; no SQL o curinga é `%`. A tradução é a
 * mesma que o PostgREST faz. As nossas ferramentas já mandam `%` (elas montam
 * o padrão na mão), então na prática isto quase nunca dispara.
 */
function padraoLike(valor: string): string {
  return valor.replace(/\*/g, "%");
}

/** Um filtro só (`coluna=op.valor`) vira um pedaço de `where`. */
function traduzirFiltro(
  tabela: TabelaDaPonte,
  coluna: string,
  bruto: string,
  p: Parametros,
): string {
  const corte = bruto.indexOf(".");
  if (corte === -1) {
    throw new BridgeUnsupportedError(`filtro sem operador em "${coluna}"`);
  }
  const op = bruto.slice(0, corte);
  const valor = bruto.slice(corte + 1);

  if (op === "not") {
    return `not (${traduzirFiltro(tabela, coluna, valor, p)})`;
  }

  if (!(OPERADORES_DA_PONTE as readonly string[]).includes(op)) {
    throw new BridgeUnsupportedError(`o filtro "${op}" ainda não roda fora da tela`);
  }

  const col = colunaValida(tabela, coluna);

  if (op === "is") {
    // Estes quatro NÃO podem virar parâmetro: `is` compara com uma palavra do
    // SQL, não com um valor. Por isso a lista é fechada e curtíssima.
    const permitidos: Record<string, string> = {
      null: "null",
      true: "true",
      false: "false",
      unknown: "unknown",
    };
    const palavra = permitidos[valor.toLowerCase()];
    if (!palavra) {
      throw new BridgeUnsupportedError(`"is.${valor}" não é um teste que a ponte conhece`);
    }
    return `"${col}" is ${palavra}`;
  }

  if (op === "in") {
    const dentro = valor.startsWith("(") && valor.endsWith(")") ? valor.slice(1, -1) : valor;
    if (dentro.trim() === "") return "false";
    const marcadores = separarLista(dentro).map((item) => p.add(item));
    return `"${col}" in (${marcadores.join(", ")})`;
  }

  const sinal = SINAL_SQL[op];
  if (!sinal) {
    throw new BridgeUnsupportedError(`o filtro "${op}" ainda não roda fora da tela`);
  }

  const valorFinal = op === "like" || op === "ilike" ? padraoLike(valor) : valor;
  return `"${col}" ${sinal} ${p.add(valorFinal)}`;
}

/** Todos os filtros da URL viram um `where` só. Sem filtro → `true`. */
function montarWhere(tabela: TabelaDaPonte, url: URL, p: Parametros): string {
  const pedacos: string[] = [];
  for (const [chave, bruto] of url.searchParams) {
    if (PARAMETROS_RESERVADOS.has(chave)) continue;
    pedacos.push(traduzirFiltro(tabela, chave, bruto, p));
  }
  return pedacos.length === 0 ? "true" : pedacos.join(" and ");
}

/** A lista de colunas do `select`. `*` continua `*`. */
function montarSelect(tabela: TabelaDaPonte, url: URL): string {
  const bruto = url.searchParams.get("select");
  if (!bruto || bruto.trim() === "" || bruto.trim() === "*") return "*";

  if (/[()!:]/.test(bruto)) {
    // `select("a, outra:outra_tabela(x)")` é o "trazer a tabela vizinha junto"
    // da API do Supabase. A ponte não faz isso — e é melhor estourar com nome
    // do que devolver metade do dado.
    throw new BridgeUnsupportedError(
      "trazer tabela vizinha junto no select ainda não roda fora da tela",
    );
  }

  return bruto
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "")
    .map((c) => `"${colunaValida(tabela, c)}"`)
    .join(", ");
}

/** `order=created_at.desc,seq.asc` vira o `order by`. */
function montarOrderBy(tabela: TabelaDaPonte, url: URL): string {
  const bruto = url.searchParams.get("order");
  if (!bruto) return "";

  const pedacos = bruto
    .split(",")
    .map((pedaco) => pedaco.trim())
    .filter((pedaco) => pedaco !== "")
    .map((pedaco) => {
      const partes = pedaco.split(".");
      const coluna = colunaValida(tabela, partes[0] ?? "");
      let direcao = "asc";
      let nulos = "";
      for (const extra of partes.slice(1)) {
        if (extra === "asc" || extra === "desc") direcao = extra;
        else if (extra === "nullsfirst") nulos = " nulls first";
        else if (extra === "nullslast") nulos = " nulls last";
        else throw new BridgeUnsupportedError(`ordenação "${extra}" desconhecida`);
      }
      return `"${coluna}" ${direcao}${nulos}`;
    });

  return pedacos.length === 0 ? "" : ` order by ${pedacos.join(", ")}`;
}

function inteiroDaUrl(url: URL, nome: string): number | null {
  const bruto = url.searchParams.get(nome);
  if (bruto === null) return null;
  const n = Number.parseInt(bruto, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BridgeUnsupportedError(`"${nome}" precisa ser um número inteiro`);
  }
  return n;
}

/** O `limit`/`offset` da URL. Ambos entram como parâmetro, nunca como texto. */
function montarLimite(url: URL, p: Parametros): string {
  let sql = "";
  const limite = inteiroDaUrl(url, "limit");
  if (limite !== null) sql += ` limit ${p.add(limite)}`;
  const salto = inteiroDaUrl(url, "offset");
  if (salto !== null) sql += ` offset ${p.add(salto)}`;
  return sql;
}

/** Embrulha um `select` de linhas no `json_agg` do próprio Postgres (R8). */
function comoJson(interno: string): string {
  return `select coalesce(json_agg(t), '[]'::json)::text as corpo from (${interno}) t`;
}

// ---------------------------------------------------------------------------
// Tradução por método
// ---------------------------------------------------------------------------

function corpoComoLinhas(corpo: unknown): Record<string, unknown>[] {
  if (Array.isArray(corpo)) {
    for (const linha of corpo) {
      if (linha === null || typeof linha !== "object" || Array.isArray(linha)) {
        throw new BridgeUnsupportedError("o corpo do pedido precisa ser um objeto ou uma lista");
      }
    }
    return corpo as Record<string, unknown>[];
  }
  if (corpo !== null && typeof corpo === "object") {
    return [corpo as Record<string, unknown>];
  }
  throw new BridgeUnsupportedError("o corpo do pedido precisa ser um objeto ou uma lista");
}

function sqlDeSelect(tabela: TabelaDaPonte, url: URL): Consulta {
  const p = new Parametros();
  const colunas = montarSelect(tabela, url);
  const where = montarWhere(tabela, url, p);
  const ordem = montarOrderBy(tabela, url);
  const limite = montarLimite(url, p);
  const interno = `select ${colunas} from public."${tabela}" where ${where}${ordem}${limite}`;
  return { text: comoJson(interno), values: p.values };
}

function sqlDeContagem(tabela: TabelaDaPonte, url: URL): Consulta {
  const p = new Parametros();
  const where = montarWhere(tabela, url, p);
  return {
    text: `select count(*)::text as total from public."${tabela}" where ${where}`,
    values: p.values,
  };
}

function sqlDeInsert(
  tabela: TabelaDaPonte,
  url: URL,
  corpo: unknown,
  querRepresentacao: boolean,
): Consulta {
  if (url.searchParams.get("on_conflict") !== null) {
    throw new BridgeUnsupportedError("gravar-ou-atualizar (upsert) ainda não roda fora da tela");
  }

  const linhas = corpoComoLinhas(corpo);
  const primeira = linhas[0];
  if (primeira === undefined) {
    throw new BridgeUnsupportedError("insert sem nenhuma linha");
  }

  const colunas = Object.keys(primeira).map((c) => colunaValida(tabela, c));
  for (const linha of linhas) {
    const chaves = Object.keys(linha);
    if (chaves.length !== colunas.length || chaves.some((c) => !colunas.includes(c))) {
      throw new BridgeUnsupportedError(
        "gravar várias linhas com campos diferentes ainda não roda fora da tela",
      );
    }
  }

  const p = new Parametros();
  const tuplas = linhas
    .map((linha) => `(${colunas.map((c) => p.add(linha[c])).join(", ")})`)
    .join(", ");
  const nomes = colunas.map((c) => `"${c}"`).join(", ");
  const base = `insert into public."${tabela}" (${nomes}) values ${tuplas}`;

  if (!querRepresentacao) return { text: base, values: p.values };

  const devolver = montarSelect(tabela, url);
  return {
    text: `with gravadas as (${base} returning ${devolver}) ${comoJson("select * from gravadas")}`,
    values: p.values,
  };
}

function sqlDeUpdate(
  tabela: TabelaDaPonte,
  url: URL,
  corpo: unknown,
  querRepresentacao: boolean,
): Consulta {
  const linhas = corpoComoLinhas(corpo);
  const patch = linhas[0];
  if (linhas.length !== 1 || patch === undefined) {
    throw new BridgeUnsupportedError("update precisa de um objeto só");
  }
  const campos = Object.keys(patch);
  if (campos.length === 0) {
    throw new BridgeUnsupportedError("update sem nenhum campo");
  }

  const p = new Parametros();
  const sets = campos.map((c) => `"${colunaValida(tabela, c)}" = ${p.add(patch[c])}`).join(", ");
  const where = montarWhere(tabela, url, p);
  const base = `update public."${tabela}" set ${sets} where ${where}`;

  if (!querRepresentacao) return { text: base, values: p.values };

  const devolver = montarSelect(tabela, url);
  return {
    text: `with alteradas as (${base} returning ${devolver}) ${comoJson("select * from alteradas")}`,
    values: p.values,
  };
}

function sqlDeDelete(tabela: TabelaDaPonte, url: URL, querRepresentacao: boolean): Consulta {
  const p = new Parametros();
  const where = montarWhere(tabela, url, p);
  const base = `delete from public."${tabela}" where ${where}`;

  if (!querRepresentacao) return { text: base, values: p.values };

  const devolver = montarSelect(tabela, url);
  return {
    text: `with apagadas as (${base} returning ${devolver}) ${comoJson("select * from apagadas")}`,
    values: p.values,
  };
}

function sqlDeFuncao(
  nome: string,
  corpo: unknown,
): { consulta: Consulta; forma: "setof" | "escalar" | "vazio" } {
  if (!(FUNCOES_DA_PONTE as readonly string[]).includes(nome)) {
    throw new BridgeUnsupportedError(`a função "${nome}" não está na lista da ponte`);
  }
  const meta = FORMA_DA_FUNCAO[nome as FuncaoDaPonte];
  // `args`/`json` são tipados NARROW POR FUNÇÃO em `FormaDaFuncaoDeclarada`
  // (de propósito — é o que faz `ArgumentoEsquecido` funcionar). Indexando
  // por um `nome` que pode ser QUALQUER função da lista, o TypeScript junta
  // os tipos de `args` de TODAS as funções — e como os argumentos de
  // funções diferentes são conjuntos praticamente disjuntos, a interseção
  // dá `never`. Aqui, em tempo de execução, só interessa "é uma lista de
  // texto": a conferência de verdade já aconteceu na declaração.
  const args = meta.args as readonly string[];
  const json = meta.json as readonly string[] | undefined;

  if (
    corpo !== null &&
    corpo !== undefined &&
    (typeof corpo !== "object" || Array.isArray(corpo))
  ) {
    throw new BridgeUnsupportedError(`os argumentos de "${nome}" precisam ser um objeto`);
  }
  const argumentos = (corpo ?? {}) as Record<string, unknown>;

  const p = new Parametros();
  const pedacos: string[] = [];
  for (const [chave, valor] of Object.entries(argumentos)) {
    if (valor === undefined) continue;
    if (!args.includes(chave)) {
      throw new BridgeUnsupportedError(`a função "${nome}" não tem o argumento "${chave}"`);
    }

    // Argumento `jsonb` vai como TEXTO com `::jsonb`, nunca solto: ver o
    // comentário do campo `json` em FORMA_DA_FUNCAO.
    if (json?.includes(chave)) {
      const comoTexto = valor === null ? null : JSON.stringify(valor);
      pedacos.push(`${chave} => ${p.add(comoTexto)}::jsonb`);
      continue;
    }

    pedacos.push(`${chave} => ${p.add(valor)}`);
  }

  const chamada = `public."${nome}"(${pedacos.join(", ")})`;

  if (meta.forma === "setof") {
    return {
      consulta: { text: comoJson(`select * from ${chamada}`), values: p.values },
      forma: "setof",
    };
  }
  if (meta.forma === "escalar") {
    return {
      consulta: { text: `select to_json(${chamada})::text as corpo`, values: p.values },
      forma: "escalar",
    };
  }
  return { consulta: { text: `select ${chamada}`, values: p.values }, forma: "vazio" };
}

// ---------------------------------------------------------------------------
// Erro do Postgres → resposta no formato que o cliente do Supabase entende
// ---------------------------------------------------------------------------

/** O mesmo mapa que a API do Supabase usa. */
function statusDoErro(code: string | undefined): number {
  switch (code) {
    case "42501":
      return 403;
    case "23505":
    case "23503":
      return 409;
    case "23502":
    case "23514":
    case "22P02":
    case "42703":
    case "P0001":
      return 400;
    case "57014":
      return 504;
    default:
      return 500;
  }
}

type ErroDoPostgres = { code?: string; message?: string; detail?: string; hint?: string };

function respostaJson(corpo: string, status: number, extras?: Record<string, string>): Response {
  return new Response(corpo, {
    status,
    headers: { "content-type": "application/json", ...(extras ?? {}) },
  });
}

function respostaDeErro(err: ErroDoPostgres): Response {
  const corpo = JSON.stringify({
    code: err.code ?? "",
    message: err.message ?? "erro no banco",
    details: err.detail ?? null,
    hint: err.hint ?? null,
  });
  return respostaJson(corpo, statusDoErro(err.code));
}

/** O formato que o cliente do Supabase espera de um `.single()`. */
function respostaDeObjetoUnico(texto: string): Response {
  let linhas: unknown;
  try {
    linhas = JSON.parse(texto);
  } catch {
    linhas = [];
  }
  const lista = Array.isArray(linhas) ? linhas : [linhas];
  if (lista.length === 1) {
    return respostaJson(JSON.stringify(lista[0]), 200);
  }
  return respostaJson(
    JSON.stringify({
      code: "PGRST116",
      details: `Results contain ${lista.length} rows, application/vnd.pgrst.object+json requires 1 row`,
      hint: null,
      message: "JSON object requested, multiple (or no) rows returned",
    }),
    406,
  );
}

function erroDeCancelamento(): Error {
  const err = new Error("A automação foi interrompida.");
  err.name = "AbortError";
  return err;
}

// ---------------------------------------------------------------------------
// A ponte
// ---------------------------------------------------------------------------

/**
 * Monta o `fetch` que veste a identidade de quem a automação representa.
 *
 * @param params.pool   o conjunto de conexões impersonadas (`impersonatedPool()`)
 * @param params.claims quem a automação representa (`sub`) — vira `auth.uid()`
 * @param params.jobId  a marca `app.automation_job`, que é o que faz a cota de
 *                      IA ser descontada do balde da AUTOMAÇÃO em vez do balde
 *                      pessoal de quem armou o agendamento.
 *
 *                      OPCIONAL: `npm run semear` não passa por trabalho
 *                      nenhum da fila e não gasta IA, então essa marca não
 *                      deveria existir pra ele. Ausente, cai pra `""` — que o
 *                      SQL que lê a marca (`nullif(current_setting(
 *                      'app.automation_job', true), '')`, nas duas cópias de
 *                      `consume_llm_tokens`) já trata como "sem marca
 *                      nenhuma", idêntico a nunca ter sido setada. Não é
 *                      gambiarra: é a mesma equivalência que o próprio SQL já
 *                      declarou, não uma nova. Como semear nunca chama
 *                      `runAgent`, esse caminho nunca é exercitado na
 *                      prática — mas se um dia fosse, cairia certo no balde
 *                      pessoal de quem está sendo impersonado, nunca no da
 *                      automação.
 */
export function createBridgeFetch(params: {
  pool: pg.Pool;
  claims: ClaimsDaPonte;
  jobId?: string;
  statementTimeoutMs?: number;
}): PonteFetch {
  const { pool, claims } = params;
  const jobId = params.jobId ?? "";
  const tetoMs = params.statementTimeoutMs ?? TETO_DE_TEMPO_POR_CONSULTA_MS;
  const claimsJson = JSON.stringify({ sub: claims.sub, role: claims.role });

  /** R3: UMA conexão por trabalho, guardada aqui e destruída no `encerrar()`. */
  let conexao: pg.PoolClient | null = null;
  /**
   * O motor pode rodar duas ferramentas ao mesmo tempo. Com uma conexão só,
   * duas transações ao mesmo tempo se atropelariam (o `begin` de uma cairia
   * dentro da outra). Esta fila põe uma consulta atrás da outra.
   */
  let fila: Promise<unknown> = Promise.resolve();
  /** O último recurso que a ponte não soube servir. Ver `PonteFetch`. */
  let ultimoNaoSuportado: string | null = null;

  async function pegarConexao(): Promise<pg.PoolClient> {
    if (conexao) return conexao;
    const nova = await pool.connect();
    // Conferência do papel: se o `set role` do `connect` não tiver pegado, a
    // conexão ainda seria `postgres` — que pularia a regra de segurança do
    // banco. Melhor não existir do que existir errada.
    const { rows } = await nova.query<{ quem: string }>("select current_user as quem");
    if (rows[0]?.quem !== "authenticated") {
      nova.release(true);
      throw new Error(
        "A automação não conseguiu entrar no banco com a identidade certa. " +
          "Nenhum dado foi lido nem gravado.",
      );
    }
    conexao = nova;
    return nova;
  }

  /**
   * R2: a transação. Os três `set_config` usam `is_local = true` — sem isso a
   * identidade de um trabalho vazaria pro próximo na mesma conexão.
   */
  async function rodar(consulta: Consulta): Promise<{ rows: Record<string, unknown>[] }> {
    const client = await pegarConexao();
    await client.query("begin");
    try {
      await client.query({
        text:
          "select set_config('statement_timeout', $1, true), " +
          "set_config('role', $2, true), " +
          "set_config('request.jwt.claims', $3, true), " +
          "set_config('app.automation_job', $4, true)",
        // ⚠️ OS QUATRO SÃO `true` (is_local). Trocar qualquer um por `false`
        // faria a identidade deste trabalho sobrar pro próximo que pegasse a
        // mesma conexão. Tem teste em cima disso.
        values: [`${tetoMs}ms`, claims.role, claimsJson, jobId],
      });
      const resultado = await client.query(consulta);
      await client.query("commit");
      return { rows: resultado.rows as Record<string, unknown>[] };
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    }
  }

  async function atender(url: URL, init: RequestInit | undefined): Promise<Response> {
    const caminho = url.pathname;

    // R5: a ponte serve /rest/v1/* e MAIS NADA.
    const marca = "/rest/v1/";
    if (!caminho.includes(marca)) {
      throw new BridgeUnsupportedError(
        `${caminho} — a automação só fala com as tabelas e as funções do banco`,
      );
    }

    const resto = caminho.slice(caminho.indexOf(marca) + marca.length);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const cabecalhos = new Headers(init?.headers);
    const prefer = cabecalhos.get("Prefer") ?? "";
    const accept = cabecalhos.get("Accept") ?? "";
    const querUmObjetoSo = accept.includes("application/vnd.pgrst.object+json");
    const querRepresentacao = prefer.includes("return=representation");
    const querContagem = /count=(exact|planned|estimated)/.test(prefer);

    const corpoBruto = typeof init?.body === "string" ? init.body : null;
    let corpo: unknown = null;
    if (corpoBruto !== null && corpoBruto !== "") {
      try {
        corpo = JSON.parse(corpoBruto);
      } catch {
        throw new BridgeUnsupportedError("o corpo do pedido não é um JSON válido");
      }
    }

    // ----- função (rpc) -----
    if (resto.startsWith("rpc/")) {
      const { consulta, forma } = sqlDeFuncao(resto.slice("rpc/".length), corpo);
      const { rows } = await rodar(consulta);
      if (forma === "vazio") return new Response(null, { status: 204 });
      const texto = (rows[0]?.corpo as string | null) ?? "null";
      return respostaJson(texto, 200);
    }

    // ----- tabela -----
    if (!ehTabelaDaPonte(resto)) {
      throw new BridgeUnsupportedError(`a tabela "${resto}" não está na lista da ponte`);
    }
    const tabela = resto;

    if (metodo === "HEAD") {
      const { rows } = await rodar(sqlDeContagem(tabela, url));
      const total = (rows[0]?.total as string | undefined) ?? "0";
      return new Response(null, { status: 200, headers: { "content-range": `*/${total}` } });
    }

    if (metodo === "GET") {
      const { rows } = await rodar(sqlDeSelect(tabela, url));
      const texto = (rows[0]?.corpo as string | null) ?? "[]";
      if (querUmObjetoSo) return respostaDeObjetoUnico(texto);
      if (!querContagem) return respostaJson(texto, 200);
      const contagem = await rodar(sqlDeContagem(tabela, url));
      const total = (contagem.rows[0]?.total as string | undefined) ?? "0";
      return respostaJson(texto, 200, { "content-range": `*/${total}` });
    }

    if (metodo === "POST" || metodo === "PATCH" || metodo === "DELETE") {
      const consulta =
        metodo === "POST"
          ? sqlDeInsert(tabela, url, corpo, querRepresentacao)
          : metodo === "PATCH"
            ? sqlDeUpdate(tabela, url, corpo, querRepresentacao)
            : sqlDeDelete(tabela, url, querRepresentacao);

      const { rows } = await rodar(consulta);
      if (!querRepresentacao) {
        return new Response(null, { status: metodo === "POST" ? 201 : 204 });
      }
      const texto = (rows[0]?.corpo as string | null) ?? "[]";
      if (querUmObjetoSo) return respostaDeObjetoUnico(texto);
      return respostaJson(texto, metodo === "POST" ? 201 : 200);
    }

    throw new BridgeUnsupportedError(`o método ${metodo} ainda não roda fora da tela`);
  }

  const ponte = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const sinal = init?.signal;
    if (sinal?.aborted) throw erroDeCancelamento();

    const url = new URL(typeof input === "string" ? input : input.toString());

    // Uma consulta atrás da outra, na mesma conexão.
    const minhaVez = fila.then(
      () => atender(url, init),
      () => atender(url, init),
    );
    fila = minhaVez.then(
      () => undefined,
      () => undefined,
    );

    try {
      return await minhaVez;
    } catch (err) {
      // ⚠️ O erro com NOME sobe: quem chamou precisa saber que a automação
      // esbarrou num recurso que a ponte não serve, pra pausar o agendamento
      // em vez de falhar todo dia calado. E fica ANOTADO, porque o cliente do
      // Supabase engole exceção que sai do `fetch`.
      if (isBridgeUnsupportedError(err)) {
        ultimoNaoSuportado = err.detalhe;
        throw err;
      }
      if (sinal?.aborted) throw erroDeCancelamento();
      const comoErro = err as ErroDoPostgres;
      if (typeof comoErro?.code === "string" || typeof comoErro?.message === "string") {
        return respostaDeErro(comoErro);
      }
      throw err;
    }
  }) as PonteFetch;

  ponte.encerrar = async () => {
    const atual = conexao;
    conexao = null;
    // `release(true)` DESTRÓI a conexão em vez de devolver ela pro conjunto.
    // Estado de sessão nunca sobrevive a um trabalho (regra R3).
    if (atual) atual.release(true);
  };

  ponte.recursoNaoSuportado = () => ultimoNaoSuportado;

  return ponte;
}
