-- ============================================================================
-- Correções apontadas pela revisão adversarial da onda 6 (teto de gasto).
--
-- A mais grave foi reproduzida no banco: um membro comum travava os agentes do
-- workspace inteiro pelo resto do mês.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O medidor não acredita mais em número que veio de fora
-- ----------------------------------------------------------------------------
-- O QUE ACONTECIA (reproduzido: US$ 999 forjados, workspace bloqueado):
-- `agent_run_steps` dava INSERT a qualquer membro, e `finish_agent_run` SOMA
-- essas linhas pra apurar o custo. Um membro comum abria uma execução própria,
-- gravava um passo dizendo "custei US$ 999", fechava — e o medidor do mês
-- estourava. Todo mundo do workspace ficava sem agente até virar o mês.
--
-- A ORIGEM DO ERRO foi uma decisão do bloco 1: "somar do rastro, porque o
-- rastro é append-only". Append-only impede REESCREVER o número. Não impede
-- ESCREVER mentira na primeira vez. As duas coisas pareciam a mesma.
--
-- O QUE MUDA: ninguém grava mais direto na tabela. Passo entra pela função
-- abaixo, que confere se a execução é de quem está gravando e, principalmente,
-- LIMITA quanto um passo e uma execução podem custar. O limite sai de
-- `org_ai_limits.max_run_cost_micros`, que já existia.
--
-- ⚠️ O QUE ISSO **NÃO** RESOLVE — e está aqui escrito pra ninguém achar que
-- resolveu: o preço continua chegando de fora, calculado pelo aplicativo. O
-- banco não tem tabela de preço (o catálogo é código, por decisão do bloco 1),
-- então ele não consegue conferir se US$ 0,004 é mesmo o preço daquele modelo.
-- O que existe agora é um TETO: a mentira fica limitada ao teto por execução,
-- em vez de ser ilimitada. Fechar isso de vez exigiria trazer a tabela de preço
-- pro banco — mudança de arquitetura, não correção de bug.
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
  v_teto bigint;
  v_ja_gasto bigint;
  v_custo bigint;
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

  -- O teto por execução. Sem configuração, US$ 5 — o suficiente pra qualquer
  -- agente honesto deste template (20 passos no modelo mais caro dão ~US$ 16,
  -- mas isso é o extremo do extremo; quem precisa disso configura).
  select coalesce(l.max_run_cost_micros, 5000000)
    into v_teto
    from public.org_ai_limits l
   where l.organization_id = v_run.organization_id;
  v_teto := coalesce(v_teto, 5000000);

  v_custo := _cost_micros;

  if v_custo is not null then
    if v_custo < 0 then
      raise exception 'cost cannot be negative';
    end if;

    select coalesce(sum(s.cost_micros), 0)
      into v_ja_gasto
      from public.agent_run_steps s
     where s.run_id = _run_id;

    -- Corta no teto em vez de recusar: a execução já rodou e já custou de
    -- verdade: recusar o passo apagaria o rastro do que aconteceu.
    if v_ja_gasto + v_custo > v_teto then
      v_custo := greatest(v_teto - v_ja_gasto, 0);
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
    _tokens_input, _tokens_output, v_custo
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

-- Fecha a porta antiga: sem policy de INSERT E sem permissão de INSERT.
drop policy if exists "members insert run steps" on public.agent_run_steps;
revoke insert on public.agent_run_steps from authenticated;


-- ----------------------------------------------------------------------------
-- 2. Recalcular não devolve saldo
-- ----------------------------------------------------------------------------
-- ANTES: `recompute_org_ai_spend` reconstruía o período a partir das execuções
-- que AINDA EXISTEM. Como um administrador do workspace pode apagar execução,
-- a sequência "apaga as execuções → recalcula" zerava o medidor. Virava o botão
-- de zerar a conta que o desenho proíbe expressamente.
--
-- AGORA: recalcular só pode AUMENTAR o medidor, nunca diminuir. Ele serve pra
-- consertar medidor que ficou ATRASADO (execução que fechou sem somar), que é
-- o problema real que ele foi feito pra resolver.
-- Mantém `returns integer` igual ao original DE PROPÓSITO. Trocar o retorno
-- aqui quebraria a reaplicação da pilha: na próxima passada a migration
-- anterior tentaria um `create or replace` por cima desta versão e o Postgres
-- recusaria com "cannot change return type".
create or replace function public.recompute_org_ai_spend(
  _organization_id uuid,
  _from date,
  _to date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_dias integer := 0;
  v_dia date;
  v_agent bigint;
  v_embed bigint;
  v_unpriced_runs integer;
  v_unpriced_docs integer;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin';
  end if;

  v_dia := _from;
  while v_dia <= _to loop
    select
      coalesce(sum(r.cost_micros), 0)::bigint,
      count(*) filter (where r.cost_micros is null)::integer
      into v_agent, v_unpriced_runs
      from public.agent_runs r
     where r.organization_id = _organization_id
       and (r.finished_at at time zone 'America/Sao_Paulo')::date = v_dia;

    select
      coalesce(sum(d.embed_cost_micros), 0)::bigint,
      count(*) filter (where d.embed_cost_micros is null)::integer
      into v_embed, v_unpriced_docs
      from public.documents d
     where d.organization_id = _organization_id
       and (d.processed_at at time zone 'America/Sao_Paulo')::date = v_dia;

    -- `greatest` com o que já está gravado: recalcular NUNCA devolve saldo.
    -- Sem isso, apagar execução viraria desconto na conta.
    insert into public.org_ai_spend as s (
      organization_id, day, agent_micros, embedding_micros,
      unpriced_runs, unpriced_documents
    )
    values (
      _organization_id, v_dia, v_agent, v_embed, v_unpriced_runs, v_unpriced_docs
    )
    on conflict (organization_id, day) do update
      set agent_micros = greatest(s.agent_micros, excluded.agent_micros),
          embedding_micros = greatest(s.embedding_micros, excluded.embedding_micros),
          unpriced_runs = greatest(s.unpriced_runs, excluded.unpriced_runs),
          unpriced_documents = greatest(s.unpriced_documents, excluded.unpriced_documents);

    v_dias := v_dias + 1;
    v_dia := v_dia + 1;
  end loop;

  return v_dias;
end;
$$;

-- A função confere `is_platform_admin()` por dentro, então continuar
-- alcançável por `authenticated` é seguro — e é o que a original fazia.
revoke execute on function public.recompute_org_ai_spend(uuid, date, date)
  from public, anon;
grant execute on function public.recompute_org_ai_spend(uuid, date, date)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 3. "Chave própria" só conta chave de IA
-- ----------------------------------------------------------------------------
-- A coluna existe pra o dono do sistema responder "quem está queimando a MINHA
-- chave". Ela marcava "Sim" pra qualquer credencial — inclusive a do Resend,
-- que é envio de email e não gasta IA nenhuma. O workspace aparecia como se
-- pagasse a própria conta quando na verdade estava gastando a do dono.
-- A função original fica IGUAL — a única mudança é o `exists` do `uses_own_key`,
-- que agora ignora a credencial de email. Reescrever a assinatura aqui
-- quebraria as telas que já leem as outras colunas.
drop function if exists public.platform_ai_spend_overview(date);
create function public.platform_ai_spend_overview(_month date default null)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  month_spent_micros bigint,
  unpriced_runs integer,
  monthly_budget_micros bigint,
  platform_cap_micros bigint,
  percent_used integer,
  uses_own_key boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_mes date := coalesce(date_trunc('month', _month)::date, public.ai_month_start());
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can read the platform spend overview';
  end if;

  return query
  select
    o.id,
    o.name,
    o.slug,
    coalesce(s.gasto, 0)::bigint,
    coalesce(s.sem_preco, 0)::integer,
    l.monthly_budget_micros,
    l.platform_cap_micros,
    case
      when least(l.monthly_budget_micros, l.platform_cap_micros) is null then null
      else floor((coalesce(s.gasto, 0)::numeric * 100)
                 / least(l.monthly_budget_micros, l.platform_cap_micros))::integer
    end,
    exists (
      select 1 from public.credentials c
       where c.organization_id = o.id
         -- SÓ provedor de IA. `resend` é envio de email e não gasta IA nenhuma:
         -- contar ela fazia a tela dizer que o workspace paga a própria conta
         -- quando ele estava gastando a do dono do sistema.
         and c.provider <> 'resend'::public.credential_provider
    )
  from public.organizations o
  left join public.org_ai_limits l on l.organization_id = o.id
  left join lateral (
    select
      sum(sp.agent_micros + sp.embedding_micros) as gasto,
      sum(sp.unpriced_runs) as sem_preco
    from public.org_ai_spend sp
    where sp.organization_id = o.id
      and sp.day >= v_mes
      and sp.day < (v_mes + interval '1 month')::date
  ) s on true
  order by coalesce(s.gasto, 0) desc, o.name asc;
end;
$$;

revoke execute on function public.platform_ai_spend_overview(date) from public, anon;
grant execute on function public.platform_ai_spend_overview(date) to authenticated;
