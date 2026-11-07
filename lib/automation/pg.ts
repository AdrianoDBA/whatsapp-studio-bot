/**
 * AS DUAS CONEXÕES DIRETAS COM O BANCO.
 *
 * O resto do app fala com o Supabase pela API (PostgREST), que é quem aplica as
 * regras de segurança do banco pra quem está logado. A automação não tem
 * ninguém logado, então ela precisa falar com o Postgres direto — e é aqui que
 * isso acontece, em dois conjuntos de conexão com finalidades MUITO diferentes:
 *
 * ┌────────────────────┬──────────────────────────────────────────────────────┐
 * │ `systemPool()`     │ entra como `postgres` (o dono das tabelas).          │
 * │                    │ SÓ a fila e a contabilidade, SÓ chamando funções     │
 * │                    │ com nome. NENHUMA consulta de dado do aluno.         │
 * ├────────────────────┼──────────────────────────────────────────────────────┤
 * │ `impersonatedPool()`│ entra e IMEDIATAMENTE vira `authenticated`.         │
 * │                    │ É por ele que a ponte (postgrest-bridge.ts) fala,    │
 * │                    │ vestindo a identidade de quem a automação representa.│
 * └────────────────────┴──────────────────────────────────────────────────────┘
 *
 * ⚠️ A LINHA MAIS PERIGOSA DO BLOCO MORA AQUI: o `set role authenticated`.
 *
 * Ele é de SESSÃO (roda no evento `connect`), não `SET LOCAL`. A diferença
 * importa e é o contrário do que a intuição diz:
 *
 *   • Com SET ROLE de sessão, uma consulta que por algum motivo escape da
 *     transação roda como `authenticated` SEM `auth.uid()` — e devolve ZERO
 *     linha. Falha FECHADA.
 *   • Com `SET LOCAL ROLE` dentro da transação, a mesma consulta escapada
 *     rodaria como `postgres`, que é DONO das tabelas. Como o template não usa
 *     `FORCE ROW LEVEL SECURITY` (regra 2 do CLAUDE.md), ela PULARIA A RLS
 *     INTEIRA. Falha ABERTA — ou seja, vazamento entre workspaces.
 *
 * Quem for "melhorar" isto: leia `tests/automation-impersonation.test.ts`
 * antes. Ele existe pra provar essas duas coisas.
 *
 * ⚠️ FALA COM O BANCO. Não importe de um componente com `"use client"`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { requireDatabaseUrl } from "@/lib/env";
import { logError } from "@/lib/logger";

/**
 * O trabalhador roda UM trabalho por vez, de propósito (container pequeno).
 * Duas conexões dá folga pra uma sobrando sem virar desperdício.
 */
const MAX_CONEXOES_IMPERSONADAS = 2;
/**
 * A fila e a contabilidade são chamadas curtas.
 *
 * ⚠️ ESTE POOL DEIXOU DE SER SÓ DO TRABALHADOR. Desde o webhook que responde
 * (onda 7), a rota pública `GET /api/webhooks/<id>/j/<jobId>` também passa por
 * aqui — e ela consulta o banco ANTES de conferir o token, porque é a consulta
 * que traz o token pra comparar. Ou seja: chamada não autenticada consome
 * conexão daqui, limitada só pelo balde do porteiro (`RATE_MAX_WEBHOOK_BUSCA`
 * em `proxy.ts`). Quem fica esperando conexão é o trabalhador, e o sintoma é a
 * fila parando — não um erro na rota. Se subir o teto do porteiro, olhe este
 * número junto.
 */
const MAX_CONEXOES_DE_SISTEMA = 5;
/** Chamada de fila que passar disso é sinal de banco em apuros, não de fila cheia. */
const TETO_DE_TEMPO_DE_SISTEMA_MS = 20_000;

/**
 * O Supabase assina os certificados dos bancos dele com uma autoridade própria,
 * que o Node não conhece de fábrica. O certificado dela vem junto no projeto —
 * a mesma receita de `scripts/migrate.mjs`. Ver `supabase/certs/README.md`.
 */
const CAMINHO_CA_SUPABASE = join(process.cwd(), "supabase", "certs", "supabase-root-2021-ca.crt");

function ehBancoLocal(dbUrl: string): boolean {
  return /@(127\.0\.0\.1|localhost|host\.docker\.internal)[:/]/.test(dbUrl);
}

function caDoSupabase(dbUrl: string): string | undefined {
  const ehSupabase = /@[^/]*\.(supabase\.(co|com|in)|pooler\.supabase\.com)[:/]/.test(dbUrl);
  if (!ehSupabase || !existsSync(CAMINHO_CA_SUPABASE)) return undefined;
  return readFileSync(CAMINHO_CA_SUPABASE, "utf8");
}

/**
 * As opções de conexão, com a MESMA disciplina de certificado do
 * `scripts/migrate.mjs`: banco na sua máquina sem criptografia, banco na
 * internet criptografado E com o certificado conferido de verdade.
 *
 * Desligar a conferência entregaria a senha do banco (que vai dentro do
 * endereço) pra quem estiver no meio do caminho.
 */
function opcoesDeConexao(): pg.PoolConfig {
  const dbUrl = requireDatabaseUrl();
  const local = ehBancoLocal(dbUrl);
  const ca = caDoSupabase(dbUrl);
  return {
    connectionString: dbUrl,
    ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    application_name: "automacao",
  };
}

let poolDeSistema: pg.Pool | null = null;
let poolImpersonado: pg.Pool | null = null;

/**
 * Erro em conexão parada não pode derrubar o processo.
 *
 * Sem este ouvinte, o `pg` joga o erro como exceção não tratada e o Node
 * encerra — o site inteiro cairia porque o banco fechou uma conexão ociosa.
 */
function naoDerrubarOProcesso(pool: pg.Pool, apelido: string) {
  pool.on("error", (err) => logError(`automation/pg/${apelido}`, err));
}

/**
 * A conexão de SISTEMA: entra como `postgres`.
 *
 * ⚠️ SÓ `lib/automation/queue.ts` usa isto, e SÓ pra chamar função com nome
 * (`claim_job`, `finish_job`, `finish_agent_run_system`…). Nenhuma string de
 * SQL solta, nenhuma consulta em tabela de dado do aluno.
 *
 * Usar este conjunto pra ler dado do aluno seria PULAR A RLS: `postgres` é
 * dono das tabelas e o template não usa `FORCE ROW LEVEL SECURITY`.
 */
export function systemPool(): pg.Pool {
  if (poolDeSistema) return poolDeSistema;
  poolDeSistema = new pg.Pool({
    ...opcoesDeConexao(),
    max: MAX_CONEXOES_DE_SISTEMA,
    statement_timeout: TETO_DE_TEMPO_DE_SISTEMA_MS,
  });
  naoDerrubarOProcesso(poolDeSistema, "sistema");
  return poolDeSistema;
}

/**
 * A conexão IMPERSONADA: entra e vira `authenticated` na hora.
 *
 * O `set role` roda no evento `connect`, antes de qualquer consulta: o `pg`
 * enfileira as consultas de uma conexão em ordem, então nada consegue passar
 * na frente dele.
 *
 * Se o `set role` FALHAR, a conexão continua como `postgres` — e é por isso
 * que a ponte repete a troca de papel DENTRO de cada transação
 * (`set_config('role', 'authenticated', true)`). Se essa segunda também
 * falhar, a transação inteira estoura e nenhum dado sai. Falha fechada nos
 * dois caminhos.
 */
export function impersonatedPool(): pg.Pool {
  if (poolImpersonado) return poolImpersonado;
  poolImpersonado = new pg.Pool({
    ...opcoesDeConexao(),
    max: MAX_CONEXOES_IMPERSONADAS,
  });
  naoDerrubarOProcesso(poolImpersonado, "impersonado");
  poolImpersonado.on("connect", (client) => {
    // Sem `await` porque o `pg` não espera este ouvinte — mas a consulta já
    // entrou na fila desta conexão, e a fila é em ordem de chegada.
    client.query("set role authenticated").catch((err) => {
      logError("automation/pg/setRole", err);
    });
  });
  return poolImpersonado;
}

/**
 * Fecha os dois conjuntos. Serve pro teste e pro desligamento educado do
 * processo — em produção o container morre inteiro, o que também resolve.
 */
export async function closeAutomationPools(): Promise<void> {
  const abertos = [poolDeSistema, poolImpersonado].filter((p): p is pg.Pool => p !== null);
  poolDeSistema = null;
  poolImpersonado = null;
  await Promise.allSettled(abertos.map((p) => p.end()));
}
