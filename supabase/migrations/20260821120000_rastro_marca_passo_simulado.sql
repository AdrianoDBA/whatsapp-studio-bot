-- ============================================================================
-- ONDA 7, TASK 4 — `record_agent_run_step` aprende a marcar um passo como
-- SIMULADO.
--
-- CONTEXTO: `ctx.acao` (task 3, `lib/agents/acoes.ts`) devolve
-- `simulado: true` quando a execução está em modo ensaio, e a coluna
-- `agent_run_steps.simulado` já existe desde a task 1 exatamente pra guardar
-- isso — mas NINGUÉM grava nela ainda. `insert` direto em `agent_run_steps`
-- foi revogado de `authenticated` na correção da onda 6
-- (20260821050000_correcoes_revisao_onda_6.sql): a ÚNICA porta de escrita é
-- esta função. Sem um parâmetro pra `simulado`, o rastro gravaria SEMPRE
-- `false` (o padrão da coluna) — inclusive pra ação que rodou em ensaio — e a
-- tela do rastro (task 5) mostraria a automação "agindo de verdade" quando na
-- verdade nada saiu pra fora.
--
-- POR QUE DROP DA ANTIGA + `create or replace` DA NOVA
-- Acrescentar um parâmetro muda a lista de TIPOS da assinatura (de 11 pra 12
-- posições), e pra Postgres isso é identidade de uma função DIFERENTE — um
-- `create or replace function` com uma lista de tipos nova não substitui a
-- função de 11 argumentos, cria um SEGUNDO overload ao lado dela. Por isso o
-- `drop function if exists` da assinatura ANTIGA vem primeiro (mesmo problema,
-- de retorno em vez de parâmetro, que `webhook_endpoint_for_check` já teve
-- nesta mesma onda, task 1).
--
-- ⚠️ MAS A CRIAÇÃO EM SI usa `create or replace`, NÃO `create` puro — e isso
-- foi conferido rodando o critério de verdade do CLAUDE.md (apagar a linha em
-- `supabase_migrations.schema_migrations` e reaplicar num banco que já tem
-- tudo). Com `create` puro, a PRIMEIRA aplicação funciona (dropa a de 11
-- argumentos, cria a de 12), mas a SEGUNDA falha com "function already exists
-- with same argument types": o `drop` da assinatura antiga não encontra mais
-- nada pra apagar (o banco já está na versão nova, de 12 argumentos), e o
-- `create` sem `or replace` recusa recriar uma função que já existe. Com
-- `create or replace`, a reaplicação apenas REDEFINE a função de 12
-- argumentos que já está lá — idempotente de verdade, não só "rodei duas
-- vezes e deu certo por acaso".
--
-- QUEM MAIS PRECISA SABER DISSO
--   • `lib/automation/postgrest-bridge.ts` — a ponte da automação valida os
--     argumentos de toda função numa lista fechada
--     (`FORMA_DA_FUNCAO.record_agent_run_step.args`). Sem `_simulado` ali, TODO
--     passo de ação gravado durante um agendamento ou webhook estoura
--     `BridgeUnsupportedError` — silenciosamente engolido por `recorder.ts`
--     (gravar rastro nunca derruba a execução), mas o passo de ação
--     simplesmente NUNCA aparece no rastro de uma automação. Corrigido no
--     mesmo commit desta migration.
--   • `supabase/reset-dev.sql` — o `drop function` de
--     `record_agent_run_step` lá precisa da assinatura NOVA (com o
--     `boolean` no fim), senão um reset completo do banco de dev não
--     consegue apagar a função (a assinatura antiga não bate com o que
--     está no banco) e o replay das migrations do zero quebra com
--     "function already exists".
-- ============================================================================

drop function if exists public.record_agent_run_step(
  uuid, smallint, public.agent_step_kind, text, jsonb, jsonb, text,
  integer, integer, integer, bigint
);

-- Corpo idêntico ao de 20260821060000_teto_de_preco_por_token.sql, só com
-- `_simulado` acrescentado no fim da lista de parâmetros (todo parâmetro novo
-- tem que ter `default`, senão toda chamada existente pararia de compilar) e
-- na lista de colunas do `insert`.
create or replace function public.record_agent_run_step(
  _run_id uuid,
  _seq smallint,
  _kind public.agent_step_kind,
  _tool_name text default null,
  _input jsonb default null,
  _output jsonb default null,
  _error_message text default null,
  _duration_ms integer default null,
  _tokens_input integer default null,
  _tokens_output integer default null,
  _cost_micros bigint default null,
  _simulado boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_run public.agent_runs%rowtype;
  v_teto_da_execucao bigint;
  v_ja_gasto bigint;
  v_tokens bigint;
  v_teto_do_passo bigint;
  v_custo bigint;
  v_tokens_in integer;
  v_tokens_out integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_run from public.agent_runs where id = _run_id;
  if not found then
    raise exception 'run not found';
  end if;

  -- Só quem abriu a execução escreve no rastro dela, e só enquanto ela roda.
  if v_run.triggered_by is distinct from auth.uid() then
    raise exception 'not your run';
  end if;
  if v_run.status <> 'running' then
    raise exception 'run is not running';
  end if;

  -- Token também é número que veio de fora. Sem teto, alguém alegaria bilhões
  -- de tokens pra empurrar o teto do passo pra cima. 2 milhões é maior que a
  -- janela de qualquer modelo do catálogo.
  v_tokens_in := least(greatest(coalesce(_tokens_input, 0), 0), 2000000);
  v_tokens_out := least(greatest(coalesce(_tokens_output, 0), 0), 2000000);

  v_custo := _cost_micros;

  if v_custo is not null then
    if v_custo < 0 then
      raise exception 'cost cannot be negative';
    end if;

    -- 1º teto: o preço tem que caber no que aqueles tokens poderiam custar.
    v_tokens := v_tokens_in + v_tokens_out;
    v_teto_do_passo := ceil(
      (v_tokens::numeric * public.max_micros_per_million_tokens()) / 1000000
    )::bigint;

    -- Passo sem token informado (ferramenta, por exemplo) não tem como ser
    -- precificado por token. Esse fica só com o teto da execução.
    if v_tokens > 0 then
      v_custo := least(v_custo, v_teto_do_passo);
    end if;

    -- 2º teto: a execução inteira.
    select coalesce(l.max_run_cost_micros, 5000000)
      into v_teto_da_execucao
      from public.org_ai_limits l
     where l.organization_id = v_run.organization_id;
    v_teto_da_execucao := coalesce(v_teto_da_execucao, 5000000);

    select coalesce(sum(s.cost_micros), 0)
      into v_ja_gasto
      from public.agent_run_steps s
     where s.run_id = _run_id;

    if v_ja_gasto + v_custo > v_teto_da_execucao then
      v_custo := greatest(v_teto_da_execucao - v_ja_gasto, 0);
    end if;
  end if;

  insert into public.agent_run_steps (
    run_id, organization_id, seq, kind, tool_name,
    input, output, error_message, duration_ms,
    tokens_input, tokens_output, cost_micros, simulado
  )
  values (
    _run_id, v_run.organization_id, _seq, _kind, _tool_name,
    coalesce(_input, 'null'::jsonb), coalesce(_output, 'null'::jsonb),
    _error_message, _duration_ms,
    -- Grava o token JÁ LIMITADO: senão o rastro mostraria um número e a conta
    -- usaria outro.
    nullif(v_tokens_in, 0), nullif(v_tokens_out, 0), v_custo,
    -- `coalesce` só por cautela: a coluna já é `not null default false`, mas
    -- quem chama pela ponte manda o valor explícito sempre (ver
    -- postgrest-bridge.ts), então isto nunca deveria precisar do padrão.
    coalesce(_simulado, false)
  );
end;
$$;

revoke execute on function public.record_agent_run_step(
  uuid, smallint, public.agent_step_kind, text, jsonb, jsonb, text,
  integer, integer, integer, bigint, boolean
) from public, anon;
grant execute on function public.record_agent_run_step(
  uuid, smallint, public.agent_step_kind, text, jsonb, jsonb, text,
  integer, integer, integer, bigint, boolean
) to authenticated;
