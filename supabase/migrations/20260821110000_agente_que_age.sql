-- supabase/migrations/20260821110000_agente_que_age.sql
--
-- ONDA 7 — o agente que age.
--
-- Nenhuma tabela nova: quatro colunas e uma função. O contrato inteiro está em
-- docs/superpowers/specs/2026-08-21-contrato-onda-7-agente-que-age.md
--
-- ⚠️ AUTOMAÇÃO NASCE EM ENSAIO. O padrão 'ensaio' é de graça pra quem já tem
-- agendamento: hoje nenhuma ferramenta age e `entrega` nasce 'nenhuma', então
-- um agendamento existente se comporta EXATAMENTE igual ao que fazia antes.

alter table public.schedules
  add column if not exists modo text not null default 'ensaio';

alter table public.schedules drop constraint if exists schedules_modo_check;
alter table public.schedules add constraint schedules_modo_check
  check (modo in ('ensaio', 'real'));

alter table public.schedules
  add column if not exists entrega jsonb not null default '{"tipo":"nenhuma"}'::jsonb;

alter table public.schedules drop constraint if exists schedules_entrega_check;
alter table public.schedules add constraint schedules_entrega_check check (
  jsonb_typeof(entrega) = 'object'
  and entrega ? 'tipo'
  and entrega ->> 'tipo' in ('nenhuma', 'email', 'conexao')
);

alter table public.webhook_endpoints
  add column if not exists modo text not null default 'ensaio';

alter table public.webhook_endpoints drop constraint if exists webhook_endpoints_modo_check;
alter table public.webhook_endpoints add constraint webhook_endpoints_modo_check
  check (modo in ('ensaio', 'real'));

alter table public.webhook_endpoints
  add column if not exists esperar_resposta boolean not null default false;

-- ⚠️ ARMADILHA DAS PERMISSÕES POR COLUNA, DE NOVO (ver
-- 20260820011000_credentials_vault.sql). `webhook_endpoints` dá `select` e
-- `update` COLUNA A COLUNA pra quem está logado
-- (20260821010000_automacao_fila.sql + 20260821030000_correcoes_revisao_bloco_2.sql).
-- Toda coluna nova nasce INVISÍVEL até entrar nesses `grant`: sem esta linha,
-- `modo` e `esperar_resposta` dão "permission denied for column" (42501) pra
-- QUALQUER `select`/`update` que peça elas — inclusive a ponte da automação,
-- que conecta como `authenticated` (regra R1 do cabeçalho de
-- `postgrest-bridge.ts`). `grant` por coluna é aditivo: isto só ACRESCENTA as
-- duas colunas ao que já existe, sem repetir a lista inteira.
grant select (modo, esperar_resposta) on public.webhook_endpoints to authenticated;
grant update (modo, esperar_resposta) on public.webhook_endpoints to authenticated;

alter table public.agent_run_steps
  add column if not exists simulado boolean not null default false;

-- ---------------------------------------------------------------------------
-- `webhook_endpoint_for_check` passa a devolver `modo` e `esperar_resposta`
-- ---------------------------------------------------------------------------
-- ⚠️ Essa função já existe (20260821010000_automacao_fila.sql) e é quem a
-- rota do webhook usa hoje pra achar o endpoint (`lib/automation/queue.ts` →
-- `webhookEndpointForCheck`, chamado por `systemPool()`, papel `postgres`,
-- nunca pela ponte). Uma tarefa mais adiante desta onda vai precisar ler
-- `endpoint.modo` e `endpoint.esperar_resposta` do retorno dela.
--
-- Postgres NÃO deixa mudar o tipo de retorno de uma função com
-- `create or replace` (erro "cannot change return type of existing
-- function") — por isso o `drop` explícito antes do `create`. E o `drop`
-- LEVA OS GRANTS JUNTO: uma função nova recém-criada volta a ter `EXECUTE`
-- concedido a `PUBLIC` por padrão, então o `revoke` que fecha essa função pra
-- `authenticated` (o `token_hash` não pode vazar pela ponte) precisa ser
-- refeito depois do `create`, e é o que a última linha deste bloco faz.
drop function if exists public.webhook_endpoint_for_check(uuid);

create function public.webhook_endpoint_for_check(_endpoint_id uuid)
returns table (
  id uuid,
  organization_id uuid,
  agent_id uuid,
  token_hash text,
  is_active boolean,
  run_as uuid,
  modo text,
  esperar_resposta boolean
)
language sql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
  select w.id, w.organization_id, w.agent_id, w.token_hash, w.is_active, w.run_as,
         w.modo, w.esperar_resposta
    from public.webhook_endpoints w
   where w.id = _endpoint_id;
$$;

revoke execute on function public.webhook_endpoint_for_check(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O resultado de um trabalho, pra quem chamou o webhook
-- ---------------------------------------------------------------------------
-- ⚠️ POR QUE UMA FUNÇÃO, E NÃO UMA CONSULTA NA ROTA. Quem chama o webhook não
-- está logado: não existe `auth.uid()` ali. A rota fala com o banco por
-- `systemPool()` (papel `postgres`), e a regra 10-G diz que por ali só se chama
-- FUNÇÃO COM NOME — sem `FORCE ROW LEVEL SECURITY`, uma consulta solta pularia
-- a regra de segurança do banco inteira.
--
-- O `_endpoint_id` no `where` é o que prende o resultado ao endereço que fez a
-- chamada: com o jobId de outro workspace na mão, a resposta é vazia.
drop function if exists public.webhook_job_result(uuid, uuid);

create function public.webhook_job_result(_endpoint_id uuid, _job_id uuid)
returns table (
  status text,
  last_error text,
  run_id uuid,
  output text,
  cost_micros bigint,
  run_status text
)
language sql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
  select j.status::text,
         j.last_error,
         j.run_id,
         r.output,
         r.cost_micros,
         r.status::text
    from public.jobs j
    left join public.agent_runs r on r.id = j.run_id
   where j.id = _job_id
     and j.source_kind = 'webhook'
     and j.source_id = _endpoint_id;
$$;

comment on function public.webhook_job_result(uuid, uuid) is
  'O resultado de um trabalho de webhook, preso ao endereço que o criou.';

revoke execute on function public.webhook_job_result(uuid, uuid) from public, anon, authenticated;
