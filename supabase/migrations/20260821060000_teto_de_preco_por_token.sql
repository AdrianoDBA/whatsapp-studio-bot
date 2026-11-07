-- ============================================================================
-- O medidor passa a conferir se o preço faz SENTIDO, não só se é pequeno.
--
-- CONTEXTO
-- A correção anterior (20260821050000) limitou quanto uma execução inteira pode
-- custar. Isso barrou o ataque de "custei US$ 999", mas ainda deixava alguém
-- gastar o teto por execução inteiro com um punhado de tokens — e, repetindo,
-- comer o teto do mês do workspace.
--
-- POR QUE NÃO UMA TABELA DE PREÇO NO BANCO
-- Seria o ideal: o banco calcularia o preço e ignoraria o que veio de fora. Mas
-- o catálogo de modelos é CÓDIGO (decisão do bloco 1), e copiar ele pra cá
-- criaria duas verdades que dessincronizam em silêncio — trocando um problema
-- por outro pior.
--
-- O QUE DÁ PRA FAZER SEM ISSO
-- O banco não sabe quanto custa cada modelo, mas sabe uma coisa que basta:
-- NENHUM modelo do catálogo passa de US$ 25 por milhão de tokens. Então o preço
-- de um passo tem um teto que sai da própria quantidade de tokens.
--
-- Com isso, forjar "custei US$ 999" em 100 tokens vira US$ 0,003. O ataque
-- morre, e o custo REAL informado pelo provedor (o OpenRouter informa, e ele é
-- mais exato que a tabela) continua passando intacto, porque ele sempre cabe
-- abaixo do teto.
-- ============================================================================

/**
 * O teto de preço por token, em micro-dólares por milhão de tokens.
 *
 * US$ 30 — folga de propósito sobre o modelo mais caro do catálogo hoje
 * (Claude Opus 5, US$ 25 de saída por milhão). Se um dia entrar um modelo mais
 * caro que isso, o efeito é o custo dele ser cortado pra baixo; o conserto é
 * subir este número.
 */
create or replace function public.max_micros_per_million_tokens()
returns bigint
language sql
immutable
as $$ select 30000000::bigint $$;

comment on function public.max_micros_per_million_tokens() is
  'Teto de preço por milhão de tokens. Existe pra impedir que alguém grave um custo inventado no rastro.';


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
  _cost_micros bigint default null
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
    tokens_input, tokens_output, cost_micros
  )
  values (
    _run_id, v_run.organization_id, _seq, _kind, _tool_name,
    coalesce(_input, 'null'::jsonb), coalesce(_output, 'null'::jsonb),
    _error_message, _duration_ms,
    -- Grava o token JÁ LIMITADO: senão o rastro mostraria um número e a conta
    -- usaria outro.
    nullif(v_tokens_in, 0), nullif(v_tokens_out, 0), v_custo
  );
end;
$$;

revoke execute on function public.record_agent_run_step(
  uuid, smallint, public.agent_step_kind, text, jsonb, jsonb, text,
  integer, integer, integer, bigint
) from public, anon;
grant execute on function public.record_agent_run_step(
  uuid, smallint, public.agent_step_kind, text, jsonb, jsonb, text,
  integer, integer, integer, bigint
) to authenticated;
