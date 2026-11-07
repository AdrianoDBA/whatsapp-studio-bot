-- =============================================================================
-- ONDA 6 — O TETO DE GASTO
-- =============================================================================
-- O que esta migration acrescenta:
--
--   org_ai_limits   → quanto este workspace pode gastar com IA (em DÓLAR)
--   org_ai_spend    → quanto ele JÁ gastou, acumulado por dia
--
-- E o que ela muda no que já existia:
--
--   finish_agent_run / finish_agent_run_system  → passam a SOMAR no medidor
--   finish_document_indexing                    → idem (custo de indexar)
--   enqueue_due_schedules                       → pula a rodada com teto cheio
--   enqueue_webhook_job                         → devolve o MOTIVO da recusa
--   consume_llm_tokens / automation_budget_left → dia no fuso de São Paulo
--
-- ⚠️ DINHEIRO É INTEIRO, EM MICRO-DÓLARES. US$ 1,00 = 1.000.000.
--    `null` = "sem teto" (nos limites) ou "preço desconhecido" (no gasto).
--    NUNCA 0 pra dizer "não sei".
--
-- ⚠️ IDEMPOTÊNCIA: o critério deste projeto NÃO é "roda duas vezes" — é
--    apagar `supabase_migrations.schema_migrations` num banco que já tem tudo
--    e reaplicar as 37 por cima. Por isso: `create table if not exists`,
--    `drop constraint if exists` antes de `add constraint`, `drop policy if
--    exists` antes de `create policy`, `drop trigger if exists` antes de
--    `create trigger`, e `drop function if exists` com a ASSINATURA INTEIRA
--    antes de toda função que muda de tipo de retorno — `create or replace`
--    não troca tipo de retorno (erra com "cannot change return type of
--    existing function").
--
--    ⚠️ E o contrário TAMBÉM vale: as três funções que mudam de tipo aqui
--    (`finish_agent_run`, `finish_agent_run_system`, `enqueue_webhook_job`)
--    ganharam um `drop function if exists` nas migrations ANTIGAS que as
--    criam (20260820030000 e 20260821010000). Sem isso, reaplicar a pilha por
--    cima de um banco que já rodou esta migration falharia lá atrás, quando a
--    versão antiga (`returns void`) tentasse substituir a nova (`returns
--    jsonb`).
--
--    Nenhum tipo (`create type`) novo nesta onda.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. O relógio: tudo vira à meia-noite de Brasília
-- -----------------------------------------------------------------------------
-- O banco costuma rodar em UTC e a tela escreve sempre no fuso de São Paulo
-- (lib/format.ts). Sem isto, o medidor zeraria 3 horas antes do que a tela
-- promete — todo mês, e todo dia.
create or replace function public.ai_today()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

comment on function public.ai_today() is
  'O dia de HOJE no fuso de São Paulo. Todo balde de uso de IA usa este, nunca current_date.';

create or replace function public.ai_month_start()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
$$;

comment on function public.ai_month_start() is
  'O dia 1º do mês corrente, no fuso de São Paulo. É a chave do teto mensal.';

revoke execute on function public.ai_today() from public, anon;
revoke execute on function public.ai_month_start() from public, anon;
grant execute on function public.ai_today() to authenticated;
grant execute on function public.ai_month_start() to authenticated;


-- -----------------------------------------------------------------------------
-- 2. org_ai_limits — o teto deste workspace
-- -----------------------------------------------------------------------------
-- ⚠️ NINGUÉM LOGADO ESCREVE NESTA TABELA. Sem `grant insert/update`, sem policy
-- de escrita. Quem grava são `set_org_ai_limits` (dono/admin do workspace) e
-- `set_org_platform_cap` (dono do SISTEMA) — e são duas funções separadas
-- exatamente pra que um admin de workspace não consiga mexer no teto que quem
-- paga a conta colocou em cima dele.
create table if not exists public.org_ai_limits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,

  -- Todos em MICRO-DÓLARES. `null` = sem teto.
  monthly_budget_micros bigint,
  daily_budget_micros bigint,
  max_run_cost_micros bigint,

  -- ⚠️ SÓ O DONO DA PLATAFORMA MEXE. Vale POR CIMA do teto do workspace, e
  -- corta mesmo com `hard_stop` desligado (senão o workspace desligaria o
  -- corte e gastaria a chave de quem paga).
  platform_cap_micros bigint,

  -- Ligado: passou do teto, para. Desligado: passou, só avisa.
  hard_stop boolean not null default true,
  alert_at_percent smallint not null default 80,

  -- O aviso deste mês já foi reivindicado? Escrito DENTRO da transação que
  -- soma o gasto, então dez execuções fechando juntas avisam uma vez só.
  alert_month date,
  alert_level smallint,

  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.org_ai_limits is
  'Quanto este workspace pode gastar com IA por mês e por dia, em micro-dólares. Linha ausente = sem teto.';
comment on column public.org_ai_limits.platform_cap_micros is
  'Teto colocado por quem cuida do SISTEMA. Vale por cima do teto do workspace e corta mesmo com hard_stop desligado.';
comment on column public.org_ai_limits.alert_level is
  'Maior nível de aviso já dado no mês de alert_month (80 ou 100). Zera quando o teto do mês muda.';

-- Postgres não tem `add constraint if not exists`: derruba antes de criar.
alter table public.org_ai_limits drop constraint if exists org_ai_limits_monthly_range;
alter table public.org_ai_limits
  add constraint org_ai_limits_monthly_range
  check (monthly_budget_micros is null
         or monthly_budget_micros between 1000000 and 100000000000);

alter table public.org_ai_limits drop constraint if exists org_ai_limits_daily_range;
alter table public.org_ai_limits
  add constraint org_ai_limits_daily_range
  check (daily_budget_micros is null
         or daily_budget_micros between 100000 and 100000000000);

alter table public.org_ai_limits drop constraint if exists org_ai_limits_run_range;
alter table public.org_ai_limits
  add constraint org_ai_limits_run_range
  check (max_run_cost_micros is null
         or max_run_cost_micros between 10000 and 1000000000);

alter table public.org_ai_limits drop constraint if exists org_ai_limits_platform_range;
alter table public.org_ai_limits
  add constraint org_ai_limits_platform_range
  check (platform_cap_micros is null
         or platform_cap_micros between 1000000 and 100000000000);

alter table public.org_ai_limits drop constraint if exists org_ai_limits_alert_range;
alter table public.org_ai_limits
  add constraint org_ai_limits_alert_range
  check (alert_at_percent between 50 and 99);

alter table public.org_ai_limits drop constraint if exists org_ai_limits_alert_level_range;
alter table public.org_ai_limits
  add constraint org_ai_limits_alert_level_range
  check (alert_level is null or alert_level between 1 and 100);

-- ⚠️ O `revoke all` NÃO é enfeite: o Supabase concede `TRUNCATE` a `anon` e
-- `authenticated` em toda tabela nova, e TRUNCATE ignora a RLS.
revoke all on public.org_ai_limits from anon, authenticated;
grant select on public.org_ai_limits to authenticated;
grant select, insert, update, delete on public.org_ai_limits to service_role;

alter table public.org_ai_limits enable row level security;

-- ⚠️ MEMBRO COMUM LÊ, e isso é decisão. Sem leitura, a frase que ele vê quando
-- o agente para não conseguiria dizer QUAL é o teto — e "peça pra quem
-- administra" sem número nenhum é pior que a verdade.
drop policy if exists "members read ai limits" on public.org_ai_limits;
create policy "members read ai limits"
  on public.org_ai_limits for select
  using (public.is_org_member(organization_id));

drop trigger if exists org_ai_limits_set_updated_at on public.org_ai_limits;
create trigger org_ai_limits_set_updated_at
  before update on public.org_ai_limits
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. org_ai_spend — o medidor, acumulado por DIA
-- -----------------------------------------------------------------------------
-- Por dia, e não por mês, porque a MESMA linha serve o freio do dia (1 leitura)
-- e o teto do mês (soma de no máximo 31 linhas, pela chave primária). Somar
-- `agent_runs` na hora custaria varrer o mês inteiro A CADA execução.
--
-- ⚠️ NINGUÉM ESCREVE AQUI — nem quem administra. Sem grant e sem policy de
-- escrita: quem soma é `org_ai_spend_add`, que é security definer. É a mesma
-- disciplina que a 20260820030000 aplicou em `agent_runs`.
--
-- ⚠️ APAGAR EXECUÇÃO NÃO DEVOLVE SALDO. A policy "admins delete runs" continua
-- valendo, mas o medidor é outra tabela e não é decrementado. Se fosse, limpar
-- o histórico seria o botão de zerar a conta.
create table if not exists public.org_ai_spend (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,

  -- Micro-dólares. Separados pra tela conseguir dizer de onde veio o gasto.
  agent_micros bigint not null default 0,
  embedding_micros bigint not null default 0,

  -- ⚠️ Execução/documento cujo modelo não está no catálogo de preços grava
  -- `cost_micros = null` (regra 7 de lib/agents/CLAUDE.md). Aqui ela soma ZERO
  -- e é CONTADA à parte. Somar como zero seria mentir; somar um chute seria
  -- pior. A tela mostra os dois números.
  unpriced_runs integer not null default 0,
  unpriced_documents integer not null default 0,

  updated_at timestamptz not null default now(),
  primary key (organization_id, day)
);

comment on table public.org_ai_spend is
  'Quanto este workspace gastou com IA em cada dia, em micro-dólares. Só funções security definer escrevem.';

alter table public.org_ai_spend drop constraint if exists org_ai_spend_nonneg;
alter table public.org_ai_spend
  add constraint org_ai_spend_nonneg
  check (agent_micros >= 0 and embedding_micros >= 0
         and unpriced_runs >= 0 and unpriced_documents >= 0);

revoke all on public.org_ai_spend from anon, authenticated;
grant select on public.org_ai_spend to authenticated;
grant select, insert, update, delete on public.org_ai_spend to service_role;

alter table public.org_ai_spend enable row level security;

drop policy if exists "members read ai spend" on public.org_ai_spend;
create policy "members read ai spend"
  on public.org_ai_spend for select
  using (public.is_org_member(organization_id));


-- -----------------------------------------------------------------------------
-- 4. org_ai_spend_add — somar no medidor e reivindicar o aviso
-- -----------------------------------------------------------------------------
-- Devolve o nível de aviso RECÉM-CRUZADO (80 ou 100), ou null quando não houve.
-- Reivindicar dentro desta transação é o que garante UM aviso por mês por
-- nível, mesmo com dez execuções fechando ao mesmo tempo.
--
-- ⚠️ SEM GRANT NENHUM. Só é chamada de dentro de outras funções security
-- definer (as de fechar execução e de fechar indexação).
create or replace function public.org_ai_spend_add(
  _organization_id uuid,
  _agent_micros bigint default 0,
  _embedding_micros bigint default 0,
  _unpriced_runs integer default 0,
  _unpriced_documents integer default 0
)
returns smallint
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_mes date := public.ai_month_start();
  v_gasto bigint;
  v_lim public.org_ai_limits%rowtype;
  v_teto bigint;
  v_pct integer;
  v_nivel smallint;
  v_ja smallint;
begin
  if _organization_id is null then
    return null;
  end if;

  insert into public.org_ai_spend as s (
    organization_id, day, agent_micros, embedding_micros, unpriced_runs, unpriced_documents
  )
  values (
    _organization_id,
    public.ai_today(),
    greatest(coalesce(_agent_micros, 0), 0),
    greatest(coalesce(_embedding_micros, 0), 0),
    greatest(coalesce(_unpriced_runs, 0), 0),
    greatest(coalesce(_unpriced_documents, 0), 0)
  )
  on conflict (organization_id, day) do update
    set agent_micros       = s.agent_micros + excluded.agent_micros,
        embedding_micros   = s.embedding_micros + excluded.embedding_micros,
        unpriced_runs      = s.unpriced_runs + excluded.unpriced_runs,
        unpriced_documents = s.unpriced_documents + excluded.unpriced_documents,
        updated_at         = now();

  -- Sem linha de limite, não existe teto — e sem teto não existe aviso.
  select * into v_lim from public.org_ai_limits where organization_id = _organization_id;
  if not found then
    return null;
  end if;

  -- `least` ignora nulo: least(null, 5) = 5. É exatamente a semântica de
  -- "sem teto vale infinito".
  v_teto := least(v_lim.monthly_budget_micros, v_lim.platform_cap_micros);
  if v_teto is null then
    return null;
  end if;

  select coalesce(sum(s2.agent_micros + s2.embedding_micros), 0)
    into v_gasto
    from public.org_ai_spend s2
   where s2.organization_id = _organization_id
     and s2.day >= v_mes
     and s2.day < (v_mes + interval '1 month')::date;

  v_pct := floor((v_gasto::numeric * 100) / v_teto)::integer;

  if v_pct >= 100 then
    v_nivel := 100;
  elsif v_pct >= v_lim.alert_at_percent then
    v_nivel := v_lim.alert_at_percent;
  else
    return null;
  end if;

  v_ja := case
            when v_lim.alert_month = v_mes then coalesce(v_lim.alert_level, 0)
            else 0
          end;
  if v_nivel <= v_ja then
    return null;
  end if;

  update public.org_ai_limits
     set alert_month = v_mes,
         alert_level = v_nivel
   where organization_id = _organization_id;

  return v_nivel;
end;
$$;

revoke execute on function public.org_ai_spend_add(uuid, bigint, bigint, integer, integer)
  from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 5. org_ai_budget_status — a pergunta que o motor faz antes de rodar
-- -----------------------------------------------------------------------------
-- Uma leitura só responde tudo: quanto pode, quanto já foi, se está bloqueado e
-- por qual dos três tetos. É ela que a faixa da tela também usa.
--
-- ⚠️ Com sessão, exige pertencer ao workspace. SEM sessão só chega aqui o
-- processo do container (que entra como `postgres` pelo DATABASE_URL) — é o
-- mesmo desenho de `automation_budget_left`.
drop function if exists public.org_ai_budget_status(uuid);
create function public.org_ai_budget_status(_organization_id uuid)
returns table (
  month date,
  day date,
  monthly_budget_micros bigint,
  daily_budget_micros bigint,
  platform_cap_micros bigint,
  effective_monthly_micros bigint,
  max_run_cost_micros bigint,
  hard_stop boolean,
  alert_at_percent smallint,
  month_spent_micros bigint,
  day_spent_micros bigint,
  month_agent_micros bigint,
  month_embedding_micros bigint,
  unpriced_runs integer,
  unpriced_documents integer,
  percent_used integer,
  over_budget boolean,
  blocked boolean,
  blocked_by text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_mes date := public.ai_month_start();
  v_dia date := public.ai_today();
  v_lim public.org_ai_limits%rowtype;
  v_teto bigint;
  v_mes_gasto bigint := 0;
  v_dia_gasto bigint := 0;
  v_mes_agente bigint := 0;
  v_mes_embed bigint := 0;
  v_sem_preco_run integer := 0;
  v_sem_preco_doc integer := 0;
  v_pct integer;
  v_passou boolean := false;
  v_bloqueado boolean := false;
  v_por text := null;
begin
  if _organization_id is null then
    raise exception 'organization is required';
  end if;
  if auth.uid() is not null and not public.is_org_member(_organization_id) then
    raise exception 'not a member of this organization';
  end if;

  select * into v_lim from public.org_ai_limits where organization_id = _organization_id;

  select
    coalesce(sum(s.agent_micros + s.embedding_micros), 0),
    coalesce(sum(s.agent_micros), 0),
    coalesce(sum(s.embedding_micros), 0),
    coalesce(sum(s.unpriced_runs), 0),
    coalesce(sum(s.unpriced_documents), 0)
  into v_mes_gasto, v_mes_agente, v_mes_embed, v_sem_preco_run, v_sem_preco_doc
  from public.org_ai_spend s
  where s.organization_id = _organization_id
    and s.day >= v_mes
    and s.day < (v_mes + interval '1 month')::date;

  select coalesce(s.agent_micros + s.embedding_micros, 0)
    into v_dia_gasto
    from public.org_ai_spend s
   where s.organization_id = _organization_id
     and s.day = v_dia;
  v_dia_gasto := coalesce(v_dia_gasto, 0);

  v_teto := least(v_lim.monthly_budget_micros, v_lim.platform_cap_micros);

  if v_teto is not null and v_teto > 0 then
    v_pct := floor((v_mes_gasto::numeric * 100) / v_teto)::integer;
  else
    v_pct := null;
  end if;

  -- A ORDEM É A PRECEDÊNCIA DA MENSAGEM: plataforma > mês > dia.
  --
  -- ⚠️ O teto da plataforma corta MESMO com hard_stop desligado. Se não
  -- cortasse, o workspace desligaria o corte e gastaria a chave de quem paga.
  if v_lim.platform_cap_micros is not null
     and v_mes_gasto >= v_lim.platform_cap_micros then
    v_passou := true;
    v_bloqueado := true;
    v_por := 'plataforma';
  elsif v_lim.monthly_budget_micros is not null
        and v_mes_gasto >= v_lim.monthly_budget_micros then
    v_passou := true;
    v_bloqueado := coalesce(v_lim.hard_stop, true);
    v_por := case when coalesce(v_lim.hard_stop, true) then 'mes' else null end;
  elsif v_lim.daily_budget_micros is not null
        and v_dia_gasto >= v_lim.daily_budget_micros then
    v_passou := true;
    v_bloqueado := coalesce(v_lim.hard_stop, true);
    v_por := case when coalesce(v_lim.hard_stop, true) then 'dia' else null end;
  end if;

  return query select
    v_mes,
    v_dia,
    v_lim.monthly_budget_micros,
    v_lim.daily_budget_micros,
    v_lim.platform_cap_micros,
    v_teto,
    v_lim.max_run_cost_micros,
    coalesce(v_lim.hard_stop, true),
    coalesce(v_lim.alert_at_percent, 80::smallint),
    v_mes_gasto,
    v_dia_gasto,
    v_mes_agente,
    v_mes_embed,
    v_sem_preco_run,
    v_sem_preco_doc,
    v_pct,
    v_passou,
    v_bloqueado,
    v_por;
end;
$$;

revoke execute on function public.org_ai_budget_status(uuid) from public, anon;
grant execute on function public.org_ai_budget_status(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 6. Quem grava o teto: DUAS funções, de propósito
-- -----------------------------------------------------------------------------
-- Separadas porque o teto do workspace e o teto da plataforma têm donos
-- diferentes. Uma função só, com um `if`, deixaria a porta perto demais.
create or replace function public.set_org_ai_limits(
  _organization_id uuid,
  _monthly_budget_micros bigint,
  _daily_budget_micros bigint,
  _max_run_cost_micros bigint,
  _hard_stop boolean,
  _alert_at_percent smallint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_org_role(
       _organization_id, array['owner', 'admin']::public.org_role[]
     ) then
    raise exception 'not allowed to change the AI budget of this organization';
  end if;

  insert into public.org_ai_limits (
    organization_id, monthly_budget_micros, daily_budget_micros,
    max_run_cost_micros, hard_stop, alert_at_percent, updated_by
  )
  values (
    _organization_id, _monthly_budget_micros, _daily_budget_micros,
    _max_run_cost_micros, coalesce(_hard_stop, true),
    coalesce(_alert_at_percent, 80::smallint), auth.uid()
  )
  on conflict (organization_id) do update
    set monthly_budget_micros = excluded.monthly_budget_micros,
        daily_budget_micros   = excluded.daily_budget_micros,
        max_run_cost_micros   = excluded.max_run_cost_micros,
        hard_stop             = excluded.hard_stop,
        alert_at_percent      = excluded.alert_at_percent,
        updated_by            = excluded.updated_by,
        -- ⚠️ MUDOU O TETO DO MÊS? O aviso volta a valer. Sem isto, quem sobe
        -- de US$ 20 pra US$ 100 depois do aviso de 80% nunca mais é avisado
        -- naquele mês.
        --
        -- ⚠️ O nome da tabela aqui é SEM SCHEMA (`org_ai_limits.x`, nunca
        -- `public.org_ai_limits.x`): dentro de `on conflict do update` esse
        -- nome é o apelido da linha que JÁ existe, e qualificar com o schema
        -- não é aceito.
        alert_month = case
          when excluded.monthly_budget_micros
               is distinct from org_ai_limits.monthly_budget_micros
          then null else org_ai_limits.alert_month end,
        alert_level = case
          when excluded.monthly_budget_micros
               is distinct from org_ai_limits.monthly_budget_micros
          then null else org_ai_limits.alert_level end;
end;
$$;

revoke execute on function public.set_org_ai_limits(uuid, bigint, bigint, bigint, boolean, smallint)
  from public, anon;
grant execute on function public.set_org_ai_limits(uuid, bigint, bigint, bigint, boolean, smallint)
  to authenticated;

-- ⚠️ Só dono da PLATAFORMA. Esta é a única coluna que um admin de workspace não
-- alcança — e é por isso que ela existe.
create or replace function public.set_org_platform_cap(
  _organization_id uuid,
  _platform_cap_micros bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can set the platform cap';
  end if;
  if _organization_id is null
     or not exists (select 1 from public.organizations o where o.id = _organization_id) then
    raise exception 'organization not found';
  end if;

  insert into public.org_ai_limits (organization_id, platform_cap_micros, updated_by)
  values (_organization_id, _platform_cap_micros, auth.uid())
  on conflict (organization_id) do update
    set platform_cap_micros = excluded.platform_cap_micros,
        alert_month = null,
        alert_level = null;
end;
$$;

revoke execute on function public.set_org_platform_cap(uuid, bigint) from public, anon;
grant execute on function public.set_org_platform_cap(uuid, bigint) to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Reconciliar o medidor com a verdade
-- -----------------------------------------------------------------------------
-- O medidor é um acumulado, e acumulado pode ficar torto (o site caiu entre o
-- update de agent_runs e a soma? não caiu — é a mesma transação — mas linha
-- gravada por versão antiga do código, sim). Esta função reconstrói o período
-- a partir das tabelas de verdade.
--
-- ⚠️ USA O MESMO RELÓGIO DO ACUMULADOR: `finished_at` pra execução e
-- `processed_at` pra documento. Com outro clock, os dois discordariam pra
-- sempre.
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
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can recompute AI spend';
  end if;
  if _organization_id is null or _from is null or _to is null or _to < _from then
    raise exception 'invalid period';
  end if;
  if (_to - _from) > 400 then
    raise exception 'period too long';
  end if;

  delete from public.org_ai_spend s
   where s.organization_id = _organization_id
     and s.day between _from and _to;

  insert into public.org_ai_spend (
    organization_id, day, agent_micros, embedding_micros, unpriced_runs, unpriced_documents
  )
  select
    _organization_id,
    d.dia,
    coalesce(r.custo, 0),
    coalesce(e.custo, 0),
    coalesce(r.sem_preco, 0),
    coalesce(e.sem_preco, 0)
  from generate_series(_from, _to, interval '1 day') as g(dia_ts)
  cross join lateral (select g.dia_ts::date as dia) d
  left join lateral (
    select
      coalesce(sum(ar.cost_micros), 0)::bigint as custo,
      -- Os parênteses NÃO são enfeite: sem eles o `::integer` gruda no `filter`
      -- e o Postgres reclama de sintaxe.
      (count(*) filter (where ar.cost_micros is null))::integer as sem_preco
    from public.agent_runs ar
    where ar.organization_id = _organization_id
      and ar.finished_at is not null
      and (ar.finished_at at time zone 'America/Sao_Paulo')::date = d.dia
  ) r on true
  left join lateral (
    select
      coalesce(sum(doc.embed_cost_micros), 0)::bigint as custo,
      (count(*) filter (where doc.embed_cost_micros is null))::integer as sem_preco
    from public.documents doc
    where doc.organization_id = _organization_id
      and doc.status = 'ready'
      and doc.processed_at is not null
      and (doc.processed_at at time zone 'America/Sao_Paulo')::date = d.dia
  ) e on true
  where coalesce(r.custo, 0) > 0 or coalesce(e.custo, 0) > 0
     or coalesce(r.sem_preco, 0) > 0 or coalesce(e.sem_preco, 0) > 0;

  get diagnostics v_dias = row_count;
  return v_dias;
end;
$$;

revoke execute on function public.recompute_org_ai_spend(uuid, date, date) from public, anon;
grant execute on function public.recompute_org_ai_spend(uuid, date, date) to authenticated;


-- -----------------------------------------------------------------------------
-- 8. A visão do dono do sistema: quem está gastando a chave dele
-- -----------------------------------------------------------------------------
-- ⚠️ `drop function if exists` antes: esta é uma função que devolve TABELA, e
-- mexer numa coluna do `returns table` depois é "mudar o tipo de retorno".
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
    exists (select 1 from public.credentials c where c.organization_id = o.id)
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


-- -----------------------------------------------------------------------------
-- 9. Fechar execução passa a somar no medidor
-- -----------------------------------------------------------------------------
-- ⚠️ MUDA O TIPO DE RETORNO (void → jsonb), então tem que DERRUBAR antes:
-- `create or replace` não troca tipo de retorno ("cannot change return type of
-- existing function"). O jsonb carrega só `{"alerta": 80|100|null}` — o nível
-- recém-cruzado, pra tela poder reagir na hora.
--
-- ⚠️ A SOMA ESTÁ NA MESMA TRANSAÇÃO DO UPDATE. Não existe execução fechada que
-- não tenha entrado no medidor.
--
-- ⚠️ CUSTO DESCONHECIDO SOMA ZERO e conta em `unpriced_runs` — igual ao que a
-- linha de `agent_runs` grava. Somar um chute quebraria a reconciliação.
drop function if exists public.finish_agent_run(uuid, public.agent_run_status, text, text);
create function public.finish_agent_run(
  _run_id uuid,
  _status public.agent_run_status,
  _output text default null,
  _error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_run public.agent_runs%rowtype;
  v_tokens_in integer;
  v_tokens_out integer;
  v_cost bigint;
  v_custo_desconhecido boolean;
  v_alerta smallint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if _status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid terminal status';
  end if;

  select * into v_run from public.agent_runs where id = _run_id;
  if not found then
    raise exception 'run not found';
  end if;

  if v_run.triggered_by is distinct from auth.uid()
     and not public.has_org_role(
       v_run.organization_id,
       array['owner', 'admin']::public.org_role[]
     ) then
    raise exception 'not allowed to finish this run';
  end if;

  -- Execução já fechada não reabre e não soma de novo. Sai calado: fechar duas
  -- vezes é corrida normal entre o tempo estourando e o modelo respondendo.
  if v_run.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object('alerta', null);
  end if;

  select
    coalesce(sum(coalesce(s.tokens_input, 0)), 0)::integer,
    coalesce(sum(coalesce(s.tokens_output, 0)), 0)::integer,
    coalesce(sum(s.cost_micros), 0)::bigint,
    coalesce(bool_or(s.kind = 'model' and s.cost_micros is null), false)
  into v_tokens_in, v_tokens_out, v_cost, v_custo_desconhecido
  from public.agent_run_steps s
  where s.run_id = _run_id;

  update public.agent_runs
     set status = _status,
         output = _output,
         error_message = _error_message,
         tokens_input = v_tokens_in,
         tokens_output = v_tokens_out,
         cost_micros = case when v_custo_desconhecido then null else v_cost end,
         finished_at = now()
   where id = _run_id;

  v_alerta := public.org_ai_spend_add(
    v_run.organization_id,
    case when v_custo_desconhecido then 0 else v_cost end,
    0,
    case when v_custo_desconhecido then 1 else 0 end,
    0
  );

  return jsonb_build_object('alerta', v_alerta);
end;
$$;

revoke execute on function public.finish_agent_run(
  uuid, public.agent_run_status, text, text
) from public, anon;
grant execute on function public.finish_agent_run(
  uuid, public.agent_run_status, text, text
) to authenticated;

-- Redundante de propósito (a 20260821010000 já fazia): reaplicar fora de ordem
-- não pode devolver o UPDATE direto em agent_runs.
revoke update on public.agent_runs from authenticated;

drop function if exists public.finish_agent_run_system(uuid, public.agent_run_status, text, text);
create function public.finish_agent_run_system(
  _run_id uuid,
  _status public.agent_run_status,
  _output text default null,
  _error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_run public.agent_runs%rowtype;
  v_tokens_in integer;
  v_tokens_out integer;
  v_cost bigint;
  v_custo_desconhecido boolean;
  v_alerta smallint;
begin
  if _status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid terminal status';
  end if;

  select * into v_run from public.agent_runs where id = _run_id;
  if not found then
    return jsonb_build_object('alerta', null);
  end if;

  if v_run.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object('alerta', null);
  end if;

  select
    coalesce(sum(coalesce(s.tokens_input, 0)), 0)::integer,
    coalesce(sum(coalesce(s.tokens_output, 0)), 0)::integer,
    coalesce(sum(s.cost_micros), 0)::bigint,
    coalesce(bool_or(s.kind = 'model' and s.cost_micros is null), false)
  into v_tokens_in, v_tokens_out, v_cost, v_custo_desconhecido
  from public.agent_run_steps s
  where s.run_id = _run_id;

  update public.agent_runs
     set status = _status,
         output = _output,
         error_message = _error_message,
         tokens_input = v_tokens_in,
         tokens_output = v_tokens_out,
         cost_micros = case when v_custo_desconhecido then null else v_cost end,
         finished_at = now()
   where id = _run_id;

  v_alerta := public.org_ai_spend_add(
    v_run.organization_id,
    case when v_custo_desconhecido then 0 else v_cost end,
    0,
    case when v_custo_desconhecido then 1 else 0 end,
    0
  );

  return jsonb_build_object('alerta', v_alerta);
end;
$$;

revoke execute on function public.finish_agent_run_system(
  uuid, public.agent_run_status, text, text
) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 10. Indexar documento entra na mesma conta
-- -----------------------------------------------------------------------------
-- Hoje `documents.embed_cost_micros` é apurado e não entra em teto nenhum. Uma
-- base de conhecimento grande custa dinheiro de verdade — se ela ficasse fora,
-- o teto teria um buraco do tamanho de um PDF.
--
-- ⚠️ A assinatura NÃO muda (continua `returns void`), pra não mexer na ponte
-- da automação nem no TypeScript que já chama.
create or replace function public.finish_document_indexing(
  _document_id uuid,
  _embedding_model text,
  _embed_tokens integer default 0,
  _embed_cost_micros bigint default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_pedacos integer;
  v_chars bigint;
  v_org uuid;
  v_custo bigint;
begin
  perform public.assert_document_admin(_document_id);

  select count(*), coalesce(sum(char_length(c.content)), 0)
    into v_pedacos, v_chars
    from public.document_chunks c
   where c.document_id = _document_id;

  if v_pedacos = 0 then
    raise exception 'no chunks were indexed for this document';
  end if;

  v_custo := case
               when _embed_cost_micros is null then null
               else greatest(_embed_cost_micros, 0)
             end;

  update public.documents
     set status = 'ready',
         error_message = null,
         chunk_count = v_pedacos,
         char_count = least(v_chars, 2147483647)::integer,
         embedding_model = left(_embedding_model, 120),
         embed_tokens = greatest(coalesce(_embed_tokens, 0), 0),
         embed_cost_micros = v_custo,
         processed_at = now(),
         updated_at = now()
   where id = _document_id
  returning organization_id into v_org;

  perform public.org_ai_spend_add(
    v_org,
    0,
    coalesce(v_custo, 0),
    0,
    case when v_custo is null then 1 else 0 end
  );
end;
$$;

revoke execute on function public.finish_document_indexing(uuid, text, integer, bigint)
  from public, anon;
grant execute on function public.finish_document_indexing(uuid, text, integer, bigint)
  to authenticated;


-- -----------------------------------------------------------------------------
-- 11. Agendamento: com o teto cheio, a rodada é PULADA (e não pausada)
-- -----------------------------------------------------------------------------
-- Não criar trabalho que já se sabe que vai falhar. E NÃO desligar a
-- automação: o teto zera sozinho na virada do mês; desligar deixaria ela morta
-- esperando alguém lembrar de religar.
create or replace function public.enqueue_due_schedules(_limite integer default 20)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_s public.schedules%rowtype;
  v_key text;
  v_count integer := 0;
  v_bloqueado boolean;
  v_por text;
begin
  for v_s in
    select s.*
      from public.schedules s
     where s.is_active
       and s.next_run_at is not null
       and s.next_run_at <= now()
     order by s.next_run_at asc
     limit greatest(coalesce(_limite, 20), 1)
     for update skip locked
  loop
    -- Quem esta automação representa ainda está no time?
    if v_s.run_as is null or not exists (
      select 1 from public.memberships m
       where m.organization_id = v_s.organization_id
         and m.user_id = v_s.run_as
    ) then
      update public.schedules
         set is_active = false,
             last_error = 'Quem armou esta automação não está mais no workspace, então ela foi desligada. Um administrador pode assumir e ligar de novo.',
             updated_at = now()
       where id = v_s.id;
      continue;
    end if;

    -- ⚠️ TETO DE GASTO. Pula a rodada, avança o relógio e CONTINUA LIGADA.
    select b.blocked, b.blocked_by
      into v_bloqueado, v_por
      from public.org_ai_budget_status(v_s.organization_id) b;

    if coalesce(v_bloqueado, false) then
      update public.schedules
         set last_error = case
               when v_por = 'dia' then
                 'A rodada de hoje foi pulada: o workspace chegou no teto de gasto com IA de hoje. A automação continua ligada e tenta de novo amanhã.'
               when v_por = 'plataforma' then
                 'A rodada de hoje foi pulada: foi atingido o limite de gasto com IA definido por quem cuida do sistema. A automação continua ligada e volta sozinha na virada do mês.'
               else
                 'A rodada de hoje foi pulada: o workspace chegou no teto de gasto com IA deste mês. A automação continua ligada e volta sozinha na virada do mês.'
             end,
             last_run_at = now(),
             next_run_at = public.next_schedule_run(
               v_s.kind, v_s.hour, v_s.minute, v_s.weekdays,
               v_s.day_of_month, v_s.every_minutes, v_s.timezone,
               greatest(now(), v_s.next_run_at)
             ),
             updated_at = now()
       where id = v_s.id;
      continue;
    end if;

    v_key := 'schedule:' || v_s.id::text || ':'
             || to_char(v_s.next_run_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI');

    insert into public.jobs (
      organization_id, kind, agent_id, run_as, payload, source_kind, source_id, idempotency_key
    )
    values (
      v_s.organization_id, 'run_agent', v_s.agent_id, v_s.run_as,
      coalesce(v_s.input, '{}'::jsonb), 'schedule', v_s.id, v_key
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;

    update public.schedules
       set last_run_at = now(),
           next_run_at = public.next_schedule_run(
             v_s.kind, v_s.hour, v_s.minute, v_s.weekdays,
             v_s.day_of_month, v_s.every_minutes, v_s.timezone,
             greatest(now(), v_s.next_run_at)
           ),
           updated_at = now()
     where id = v_s.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_due_schedules(integer) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 12. Webhook: a recusa passa a ter NOME
-- -----------------------------------------------------------------------------
-- ⚠️ MUDA O TIPO DE RETORNO (uuid → jsonb): derruba antes.
-- Antes a função devolvia `null` pra três motivos diferentes, e a rota fazia
-- uma leitura extra pra adivinhar qual era (o comentário dela já reclamava
-- disso). Agora o motivo vem com nome, e o teto de gasto entra como mais um.
drop function if exists public.enqueue_webhook_job(uuid, jsonb, text);
create function public.enqueue_webhook_job(
  _endpoint_id uuid,
  _payload jsonb default '{}'::jsonb,
  _idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_ep public.webhook_endpoints%rowtype;
  v_pendentes integer;
  v_id uuid;
  v_bloqueado boolean;
  v_por text;
begin
  select * into v_ep from public.webhook_endpoints where id = _endpoint_id;
  if not found or not v_ep.is_active then
    return jsonb_build_object('job_id', null, 'motivo', 'desligado');
  end if;

  if v_ep.run_as is null or not exists (
    select 1 from public.memberships m
     where m.organization_id = v_ep.organization_id
       and m.user_id = v_ep.run_as
  ) then
    update public.webhook_endpoints
       set is_active = false, updated_at = now()
     where id = v_ep.id;
    return jsonb_build_object('job_id', null, 'motivo', 'sem-responsavel');
  end if;

  -- ⚠️ TETO DE GASTO ANTES DA FILA. Responder 202 ("aceitei") pra um trabalho
  -- que nunca vai rodar é mentir pro sistema do outro lado.
  select b.blocked, b.blocked_by
    into v_bloqueado, v_por
    from public.org_ai_budget_status(v_ep.organization_id) b;

  if coalesce(v_bloqueado, false) then
    return jsonb_build_object(
      'job_id', null,
      'motivo', 'teto-de-gasto',
      'escopo', coalesce(v_por, 'mes')
    );
  end if;

  select count(*) into v_pendentes
    from public.jobs j
   where j.organization_id = v_ep.organization_id
     and j.status in ('pending', 'running');
  if v_pendentes >= 25 then
    return jsonb_build_object('job_id', null, 'motivo', 'fila-cheia');
  end if;

  insert into public.jobs (
    organization_id, kind, agent_id, run_as, payload, source_kind, source_id, idempotency_key
  )
  values (
    v_ep.organization_id, 'run_agent', v_ep.agent_id, v_ep.run_as,
    jsonb_build_object('data', coalesce(_payload, '{}'::jsonb)),
    'webhook', v_ep.id, nullif(_idempotency_key, '')
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('job_id', null, 'motivo', 'repetida');
  end if;

  return jsonb_build_object('job_id', v_id, 'motivo', null);
end;
$$;

revoke execute on function public.enqueue_webhook_job(uuid, jsonb, text)
  from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 13. Os baldes de token passam a virar à meia-noite de Brasília
-- -----------------------------------------------------------------------------
-- Só o fuso muda. Estrutura e teto continuam iguais (ver §5 do contrato: eles
-- CONTINUAM existindo, como primeira camada).
--
-- Consequência única, e é inofensiva: NO DIA da migration, um balde pode
-- nascer parcialmente consumido.
alter table public.llm_usage        alter column day set default public.ai_today();
alter table public.automation_usage alter column day set default public.ai_today();

create or replace function public.consume_llm_tokens(_tokens integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_current int;
  v_cap constant int := 50000;
  v_marca text;
  v_job_id uuid;
  v_job public.jobs%rowtype;
  v_hoje date := public.ai_today();
begin
  if auth.uid() is null then
    return false;
  end if;
  if _tokens is null or _tokens <= 0 or _tokens > 100000 then
    raise exception 'invalid token count';
  end if;

  -- A marca `app.automation_job` é colocada pela ponte, dentro da transação de
  -- cada consulta da automação. Ela só vale se apontar pra um trabalho DE
  -- VERDADE, RODANDO, cujo dono é EXATAMENTE quem está pedindo.
  v_marca := nullif(current_setting('app.automation_job', true), '');
  if v_marca is not null then
    begin
      v_job_id := v_marca::uuid;
    exception when others then
      v_job_id := null;
    end;
  end if;

  if v_job_id is not null then
    select * into v_job from public.jobs where id = v_job_id;
    if found and v_job.status = 'running' and v_job.run_as = auth.uid() then
      insert into public.automation_usage (organization_id, day, tokens_used)
      values (v_job.organization_id, v_hoje, _tokens)
      on conflict (organization_id, day) do update
        set tokens_used = automation_usage.tokens_used + excluded.tokens_used
      returning tokens_used into v_current;
      return v_current <= public.automation_daily_cap();
    end if;
  end if;

  insert into public.llm_usage (user_id, day, tokens_used)
  values (auth.uid(), v_hoje, _tokens)
  on conflict (user_id, day) do update
    set tokens_used = llm_usage.tokens_used + excluded.tokens_used
  returning tokens_used into v_current;

  return v_current <= v_cap;
end;
$$;

revoke execute on function public.consume_llm_tokens(integer) from public, anon;
grant execute on function public.consume_llm_tokens(integer) to authenticated;

create or replace function public.automation_budget_left(_organization_id uuid)
returns integer
language plpgsql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_usado integer;
begin
  if _organization_id is null then
    return 0;
  end if;

  if auth.uid() is not null and not public.is_org_member(_organization_id) then
    raise exception 'not a member of this organization';
  end if;

  select tokens_used into v_usado
    from public.automation_usage
   where organization_id = _organization_id
     and day = public.ai_today();

  return greatest(public.automation_daily_cap() - coalesce(v_usado, 0), 0);
end;
$$;

-- ⚠️ SAIU DA MÃO DE QUEM ESTÁ LOGADO. Quem lê este balde é só o processo do
-- container (que conecta como `postgres` pelo DATABASE_URL), em
-- `lib/automation/queue.ts`. Nenhuma tela chama isto.
revoke execute on function public.automation_budget_left(uuid) from public, anon, authenticated;
