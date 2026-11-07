-- supabase/migrations/20260821140000_resultado_do_webhook_sabe_o_modo.sql
--
-- ONDA 7 — CORREÇÃO: O CAMPO `ensaio` DA RESPOSTA DO WEBHOOK PODIA MENTIR.
--
-- O DEFEITO
-- ---------------------------------------------------------------------------
-- As duas rotas de webhook devolvem `"ensaio": true|false` pro sistema do outro
-- lado saber se aquela rodada foi de mentirinha (nenhum email saiu) ou de
-- verdade. Só que o valor vinha do ESTADO ATUAL DO ENDEREÇO
-- (`webhook_endpoints.modo`, lido junto com o token), e não da execução.
--
-- Aí basta alguém virar a chavinha de "ensaio" pra "real" na tela de Automações
-- entre o disparo e a leitura do resultado, e a resposta afirma `ensaio: true`
-- numa rodada em que o email SAIU. É exatamente a classe de defeito que a onda
-- inteira combateu: o registro tem que descrever o que aconteceu, nunca o que
-- está configurado agora.
--
-- A COLUNA JÁ EXISTE. `agent_runs.modo` nasceu na 20260821130000 justamente
-- pra isso, e é imutável (`freeze_agent_run_keys`). O que faltava era o
-- caminho do webhook enxergar ela: `webhook_job_result` é a ÚNICA leitura que
-- as duas rotas fazem (regra 10-G — por ali só se chama função com nome), e
-- ela não trazia `modo`.
--
-- ---------------------------------------------------------------------------
-- POR QUE `drop` E DEPOIS `create`, E NÃO `create or replace`
-- ---------------------------------------------------------------------------
-- Acrescentar uma coluna ao `returns table` MUDA O TIPO DE RETORNO, e Postgres
-- recusa `create or replace` nesse caso ("cannot change return type of existing
-- function"). A armadilha que mordeu `webhook_endpoint_for_check` e
-- `record_agent_run_step` nesta mesma onda.
--
-- A LISTA DE ARGUMENTOS NÃO MUDA (`uuid, uuid`), então:
--   • o `drop function if exists` acha a versão antiga e a nova (mesma
--     assinatura) — a migration roda duas vezes sem quebrar;
--   • `supabase/reset-dev.sql` já derruba essa mesma assinatura e continua
--     valendo — nada pra ajustar lá.
--
-- ⚠️ O `drop` LEVA OS GRANTS JUNTO: função recém-criada volta a ter `EXECUTE`
-- pra `PUBLIC`. O `revoke` no fim é o que fecha ela de novo.
--
-- ⚠️ NADA DE `grant` DE COLUNA AQUI. Quem lê `agent_runs.modo` é a própria
-- função, que roda `security definer` como dono — permissão de quem está
-- logado não entra nessa conta.
-- ---------------------------------------------------------------------------

drop function if exists public.webhook_job_result(uuid, uuid);

create function public.webhook_job_result(_endpoint_id uuid, _job_id uuid)
returns table (
  status text,
  last_error text,
  run_id uuid,
  output text,
  cost_micros bigint,
  run_status text,
  -- ⚠️ `r.modo`, NUNCA `webhook_endpoints.modo`. O primeiro descreve a rodada
  -- que aconteceu; o segundo descreve como o endereço está configurado AGORA.
  -- `null` quando o trabalho nem chegou a abrir execução — e aí quem chama
  -- trata como "não foi ensaio", que é o silêncio, nunca a promessa de que
  -- nada saiu (mesmo critério do `default 'real'` da 20260821130000).
  run_modo text
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
         r.status::text,
         r.modo
    from public.jobs j
    left join public.agent_runs r on r.id = j.run_id
   where j.id = _job_id
     and j.source_kind = 'webhook'
     and j.source_id = _endpoint_id;
$$;

comment on function public.webhook_job_result(uuid, uuid) is
  'O resultado de um trabalho de webhook, preso ao endereço que o criou. `run_modo` vem de agent_runs.modo (o que a rodada FOI), nunca de webhook_endpoints.modo (como o endereço está configurado agora).';

revoke execute on function public.webhook_job_result(uuid, uuid) from public, anon, authenticated;
