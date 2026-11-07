-- =============================================================================
-- Automação (onda 4): a fila, os agendamentos e os webhooks
-- =============================================================================
-- O QUE ISSO RESOLVE
-- Até agora o agente só rodava quando alguém estava com a tela aberta. Aqui ele
-- passa a rodar sozinho: todo dia às 8h, a cada 15 minutos, ou quando um
-- sistema de fora chama um endereço secreto (webhook).
--
-- São quatro tabelas:
--
--   jobs               → a FILA. Uma linha por "trabalho pra fazer".
--   schedules          → os agendamentos ("rode esse agente toda segunda às 9h")
--   webhook_endpoints  → os endereços secretos que disparam um agente de fora
--   automation_usage   → o balde de tokens DA AUTOMAÇÃO, por workspace e por dia
--
-- ⚠️ POR QUE A AUTOMAÇÃO TEM BALDE PRÓPRIO
-- A cota diária de IA é descontada por PESSOA (`llm_usage`, por `auth.uid()`).
-- Numa automação, "a pessoa" é quem armou o agendamento — que pode estar
-- dormindo às 3h da manhã. Sem um balde separado, o agendamento queimaria a
-- cota pessoal dela e ela chegaria de manhã sem conseguir usar o chat, sem
-- entender por quê. Por isso `consume_llm_tokens` passa a olhar a marca
-- `app.automation_job`: quando o pedido vem de um trabalho DE VERDADE, que está
-- RODANDO, e cujo dono é exatamente quem está pedindo, o desconto vai pro balde
-- do workspace (`automation_usage`) em vez do balde da pessoa.
--
-- ⚠️ NINGUÉM ESCREVE NA FILA NA MÃO
-- `jobs` só dá `select` pra quem está logado. Entrar na fila é por
-- `enqueue_agent_job` / `enqueue_due_schedules` / `enqueue_webhook_job`, e sair
-- é por `claim_job` / `finish_job` / `release_job`. É isso que garante que o
-- trabalho carregue a organização, o agente e o dono vindos do BANCO, e nunca
-- do corpo de um pedido HTTP.
--
-- ⚠️ `agent_runs` CONTINUA SEM PERMISSÃO DE UPDATE
-- A migration 20260820030000 tirou o `update` de `agent_runs` de propósito:
-- quem disparava uma execução conseguia reescrever quanto ela custou. Nada
-- aqui devolve essa permissão. Quem fecha execução continua sendo função:
-- `finish_agent_run` (pra quem está logado) e `finish_agent_run_system` (pro
-- processo do container, que não tem sessão nenhuma). As duas somam o rastro
-- (`agent_run_steps`), que é só-de-acréscimo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Situação de um trabalho da fila
-- -----------------------------------------------------------------------------
-- Bloco condicional porque o Postgres não tem "create type if not exists".
do $$
begin
  create type public.job_status as enum ('pending', 'running', 'done', 'failed', 'cancelled');
exception
  when duplicate_object then null;
end
$$;

-- =============================================================================
-- 2. jobs — a fila
-- =============================================================================
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Hoje só existe um tipo de trabalho. É texto (e não enum) porque a onda 8
  -- vai querer acrescentar outros sem precisar de `alter type`.
  kind text not null default 'run_agent',
  agent_id uuid not null references public.agents(id) on delete cascade,
  -- ⚠️ A IDENTIDADE DA AUTOMAÇÃO. É esta pessoa que o agente representa quando
  -- roda sozinho — e é o `sub` que a ponte usa pra que a RLS continue valendo.
  -- Nunca vem do corpo de um pedido: é gravado pelas funções de enfileirar.
  run_as uuid references auth.users(id) on delete set null,
  -- A entrada do agente (o mesmo formato de `agent_runs.input`).
  payload jsonb not null default '{}'::jsonb,
  source_kind text not null,
  -- O agendamento ou o webhook que originou isto. Nulo quando foi "rodar agora".
  source_id uuid,
  status public.job_status not null default 'pending',
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  locked_at timestamptz,
  locked_by text,
  -- ⚠️ started_at é o que separa "nunca chegou a rodar" de "já gastou dinheiro".
  -- Trabalho que já começou NÃO é refeito: perder uma rodada é melhor que
  -- cobrar duas vezes.
  started_at timestamptz,
  finished_at timestamptz,
  run_id uuid references public.agent_runs(id) on delete set null,
  -- JÁ em português claro. A tela mostra cru.
  last_error text,
  -- Slot de idempotência ("este agendamento, neste horário"). Impede trabalho
  -- em dobro quando duas réplicas rodam ao mesmo tempo, e no horário que
  -- acontece duas vezes na virada do horário de verão.
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_kind_check check (kind in ('run_agent')),
  constraint jobs_source_kind_check check (source_kind in ('schedule', 'webhook', 'manual')),
  constraint jobs_attempts_nonneg check (attempts >= 0 and max_attempts between 1 and 10),
  constraint jobs_locked_by_len check (locked_by is null or char_length(locked_by) between 1 and 80),
  constraint jobs_last_error_len check (last_error is null or char_length(last_error) <= 2000),
  constraint jobs_idempotency_len
    check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  constraint jobs_payload_is_object check (jsonb_typeof(payload) = 'object'),
  constraint jobs_payload_len check (char_length(payload::text) <= 262144)
);

comment on table public.jobs is
  'A fila de trabalhos da automação. Quem está logado só LÊ: entrar e sair da fila é por função.';
comment on column public.jobs.run_as is
  'Quem o agente representa quando roda sozinho. É o auth.uid() da execução agendada — é isso que faz a RLS continuar valendo.';
comment on column public.jobs.started_at is
  'Marcado uma vez só, por mark_job_started. Trabalho que já começou nunca é refeito (não cobrar duas vezes).';

-- O índice que o trabalhador usa a cada volta do laço: só o que está esperando.
create index if not exists jobs_pendentes_idx
  on public.jobs (run_after asc, created_at asc)
  where status = 'pending';

-- A faxina procura trabalho travado há muito tempo.
create index if not exists jobs_presos_idx
  on public.jobs (locked_at asc)
  where status = 'running';

create index if not exists jobs_org_created_idx
  on public.jobs (organization_id, created_at desc);

create index if not exists jobs_org_source_idx
  on public.jobs (organization_id, source_kind, source_id, created_at desc);

-- ⚠️ ÍNDICE PARCIAL. Quem usar `on conflict (idempotency_key)` sem repetir o
-- `where idempotency_key is not null` leva "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" — o Postgres NÃO infere
-- índice parcial sozinho.
create unique index if not exists jobs_idempotency_uidx
  on public.jobs (idempotency_key)
  where idempotency_key is not null;

-- Zera e devolve só o necessário. O `revoke all` não é enfeite: além do
-- select/insert/update/delete da migration 20260820000000_table_grants, o
-- próprio Supabase concede TRUNCATE a `anon` e `authenticated` em toda tabela
-- nova — e TRUNCATE **ignora a RLS**.
--
-- ⚠️ REPARE: só `select`. Enfileirar e fechar trabalho é SÓ por função.
revoke all on public.jobs from anon, authenticated;
grant select on public.jobs to authenticated;
grant select, insert, update, delete on public.jobs to service_role;

-- RLS — só ENABLE (nunca FORCE, ver regra 2 do CLAUDE.md).
alter table public.jobs enable row level security;

drop policy if exists "members read jobs" on public.jobs;
create policy "members read jobs"
  on public.jobs for select
  using (public.is_org_member(organization_id));

-- Sem policy de INSERT, UPDATE ou DELETE, de propósito: as duas camadas
-- (permissão de tabela e RLS) dizem a mesma coisa. Quem escreve é função.

-- `freeze_org_and_creator` NÃO serve aqui: `jobs` não tem coluna `created_by`,
-- e a função reclamaria de um campo que não existe. Como ninguém logado tem
-- permissão de UPDATE, não há o que congelar.
drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 3. schedules — os agendamentos
-- =============================================================================
-- Não usamos sintaxe de cron: leigo não escreve "0 8 * * 1-5" e não confere se
-- escreveu certo. Aqui o agendamento é descrito em campos ("toda semana",
-- "segunda e quarta", "às 8:30"), e quem monta a frase é `descreverAgendamento`
-- em lib/automation/schedules.ts.
--
-- ⚠️ `weekdays` usa o MESMO eixo do `extract(dow)` do Postgres: 0 = domingo,
-- 6 = sábado. Trocar isso por "1 = segunda" quebra `next_schedule_run`.
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  name text not null,
  kind text not null,
  hour smallint,
  minute smallint,
  weekdays smallint[],
  day_of_month smallint,
  every_minutes integer,
  timezone text not null default 'America/Sao_Paulo',
  -- A entrada do agente. Formato igual ao de `agent_runs.input`.
  input jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  -- Calculado pelo gatilho `schedules_set_next_run`. Ninguém escolhe na mão.
  next_run_at timestamptz,
  last_run_at timestamptz,
  -- JÁ em português claro.
  last_error text,
  -- ⚠️ Quem o agendamento representa. A policy obriga a ser QUEM ESTÁ CRIANDO:
  -- ninguém arma automação no nome de outra pessoa.
  run_as uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedules_name_len check (char_length(name) between 2 and 80),
  constraint schedules_kind_check check (kind in ('daily', 'weekly', 'monthly', 'interval')),
  constraint schedules_hour_range check (hour is null or hour between 0 and 23),
  constraint schedules_minute_range check (minute is null or minute between 0 and 59),
  constraint schedules_weekdays_range
    check (weekdays is null or (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
                                and array_length(weekdays, 1) between 1 and 7)),
  constraint schedules_day_of_month_range
    check (day_of_month is null or day_of_month between 1 and 28),
  constraint schedules_every_minutes_range
    check (every_minutes is null or every_minutes between 5 and 1440),
  constraint schedules_timezone_len check (char_length(timezone) between 1 and 64),
  constraint schedules_last_error_len check (last_error is null or char_length(last_error) <= 2000),
  constraint schedules_input_is_object check (jsonb_typeof(input) = 'object'),
  constraint schedules_input_len check (char_length(input::text) <= 65536),
  -- Cada formato exige os campos dele e proíbe os dos outros. Sem isso, um
  -- agendamento "toda semana" sem dia da semana ficaria parado pra sempre, em
  -- silêncio.
  constraint schedules_shape check (
    case kind
      when 'daily' then
        hour is not null and minute is not null
        and weekdays is null and day_of_month is null and every_minutes is null
      when 'weekly' then
        hour is not null and minute is not null and weekdays is not null
        and day_of_month is null and every_minutes is null
      when 'monthly' then
        hour is not null and minute is not null and day_of_month is not null
        and weekdays is null and every_minutes is null
      when 'interval' then
        every_minutes is not null
        and hour is null and minute is null
        and weekdays is null and day_of_month is null
      else false
    end
  )
);

comment on table public.schedules is
  'Agendamentos: "rode esse agente toda segunda às 9h". Quem arma só consegue armar no próprio nome.';
comment on column public.schedules.weekdays is
  'Dias da semana no eixo do Postgres: 0 = domingo, 6 = sábado. Mesmo eixo do extract(dow).';
comment on column public.schedules.next_run_at is
  'Calculado pelo gatilho schedules_set_next_run. Nulo = desligado ou sem próxima data.';
comment on column public.schedules.run_as is
  'Quem o agendamento representa. A policy obriga a ser quem está criando/editando: ninguém arma automação no nome de outro.';

-- FK extra pra tela conseguir puxar o nome de quem o agendamento representa.
-- A FK principal aponta pra auth.users, e o PostgREST não navega até lá.
do $$
begin
  alter table public.schedules
    add constraint schedules_run_as_profile_fkey
    foreign key (run_as) references public.profiles(id) on delete set null;
exception
  when duplicate_object then null;
  when duplicate_table then null;
end
$$;

create index if not exists schedules_org_created_idx
  on public.schedules (organization_id, created_at desc);

create index if not exists schedules_org_agent_idx
  on public.schedules (organization_id, agent_id);

-- O trabalhador varre isto a cada 20 segundos: só o que está ligado e vencido.
create index if not exists schedules_vencidos_idx
  on public.schedules (next_run_at asc)
  where is_active;

revoke all on public.schedules from anon, authenticated;
grant select, insert, update, delete on public.schedules to authenticated;
grant select, insert, update, delete on public.schedules to service_role;

alter table public.schedules enable row level security;

drop policy if exists "members read schedules" on public.schedules;
create policy "members read schedules"
  on public.schedules for select
  using (public.is_org_member(organization_id));

-- ⚠️ AS TRÊS CONDIÇÕES JUNTAS SÃO O QUE IMPEDE ESCALADA DE IDENTIDADE:
-- quem administra, criando em nome próprio, representando a si mesmo.
drop policy if exists "admins create schedules" on public.schedules;
create policy "admins create schedules"
  on public.schedules for insert
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = created_by
    and auth.uid() = run_as
    and exists (
      select 1
        from public.agents a
       where a.id = schedules.agent_id
         and a.organization_id = schedules.organization_id
    )
  );

-- Editar um agendamento alheio é permitido (é o botão "assumir"), mas o
-- `with check` obriga a apontar o `run_as` pra SI MESMO. Ou seja: dá pra assumir
-- o agendamento de outro admin, nunca pra fazer o agente rodar no nome dele.
drop policy if exists "admins update schedules" on public.schedules;
create policy "admins update schedules"
  on public.schedules for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = run_as
  );

drop policy if exists "admins delete schedules" on public.schedules;
create policy "admins delete schedules"
  on public.schedules for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop trigger if exists schedules_set_updated_at on public.schedules;
create trigger schedules_set_updated_at
  before update on public.schedules
  for each row execute function public.set_updated_at();

-- Impede mudar o agendamento de workspace ou trocar quem criou.
drop trigger if exists schedules_freeze_org_and_creator on public.schedules;
create trigger schedules_freeze_org_and_creator
  before update on public.schedules
  for each row execute function public.freeze_org_and_creator();

-- =============================================================================
-- 4. webhook_endpoints — o endereço secreto que dispara o agente
-- =============================================================================
-- ⚠️ O TOKEN APARECE UMA VEZ SÓ, na tela, no momento da criação. O banco guarda
-- só o sha256 dele. Perdeu, cria outro — não existe "mostrar de novo".
create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  label text not null default '',
  -- sha256 do token, em hex. NUNCA o token.
  token_hash text not null,
  -- Os primeiros caracteres, só pra tela conseguir dizer "é esse aqui".
  token_prefix text not null default '',
  is_active boolean not null default true,
  last_called_at timestamptz,
  calls_count integer not null default 0,
  -- Limite de taxa contado NO BANCO (o do proxy.ts é por processo e conta
  -- metade quando existem duas réplicas).
  window_started_at timestamptz,
  window_count integer not null default 0,
  run_as uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_endpoints_label_len check (char_length(label) <= 80),
  constraint webhook_endpoints_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint webhook_endpoints_token_prefix_len check (char_length(token_prefix) <= 16),
  constraint webhook_endpoints_counts_nonneg check (calls_count >= 0 and window_count >= 0)
);

comment on table public.webhook_endpoints is
  'Endereços secretos que disparam um agente de fora. O banco guarda só o sha256 do token.';
comment on column public.webhook_endpoints.token_hash is
  'sha256 do token. Fica FORA do grant de select: select("*") aqui falha com 42501, e isso é a rede de segurança funcionando.';

do $$
begin
  alter table public.webhook_endpoints
    add constraint webhook_endpoints_run_as_profile_fkey
    foreign key (run_as) references public.profiles(id) on delete set null;
exception
  when duplicate_object then null;
  when duplicate_table then null;
end
$$;

create unique index if not exists webhook_endpoints_token_hash_uidx
  on public.webhook_endpoints (token_hash);

create index if not exists webhook_endpoints_org_created_idx
  on public.webhook_endpoints (organization_id, created_at desc);

create index if not exists webhook_endpoints_org_agent_idx
  on public.webhook_endpoints (organization_id, agent_id);

-- ⚠️ O `grant select` É COLUNA A COLUNA, e `token_hash` fica de fora.
-- Consequência declarada: `select("*")` nesta tabela COMPILA e FALHA em
-- execução com 42501 ("permission denied for column token_hash"). É a rede de
-- segurança funcionando, não bug: as consultas da tela pedem colunas na mão.
revoke all on public.webhook_endpoints from anon, authenticated;
grant select (
  id, organization_id, agent_id, label, token_prefix, is_active,
  last_called_at, calls_count, run_as, created_by, created_at, updated_at
) on public.webhook_endpoints to authenticated;
grant insert, update, delete on public.webhook_endpoints to authenticated;
grant select, insert, update, delete on public.webhook_endpoints to service_role;

alter table public.webhook_endpoints enable row level security;

drop policy if exists "members read webhooks" on public.webhook_endpoints;
create policy "members read webhooks"
  on public.webhook_endpoints for select
  using (public.is_org_member(organization_id));

drop policy if exists "admins create webhooks" on public.webhook_endpoints;
create policy "admins create webhooks"
  on public.webhook_endpoints for insert
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = created_by
    and auth.uid() = run_as
    and exists (
      select 1
        from public.agents a
       where a.id = webhook_endpoints.agent_id
         and a.organization_id = webhook_endpoints.organization_id
    )
  );

drop policy if exists "admins update webhooks" on public.webhook_endpoints;
create policy "admins update webhooks"
  on public.webhook_endpoints for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = run_as
  );

drop policy if exists "admins delete webhooks" on public.webhook_endpoints;
create policy "admins delete webhooks"
  on public.webhook_endpoints for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop trigger if exists webhook_endpoints_set_updated_at on public.webhook_endpoints;
create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();

drop trigger if exists webhook_endpoints_freeze_org_and_creator on public.webhook_endpoints;
create trigger webhook_endpoints_freeze_org_and_creator
  before update on public.webhook_endpoints
  for each row execute function public.freeze_org_and_creator();

-- =============================================================================
-- 5. automation_usage — o balde de tokens da automação
-- =============================================================================
create table if not exists public.automation_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day date not null default current_date,
  tokens_used integer not null default 0,
  primary key (organization_id, day)
);

comment on table public.automation_usage is
  'Quantos tokens a AUTOMAÇÃO do workspace já gastou hoje. Separado da cota pessoal (llm_usage) de propósito.';

alter table public.automation_usage drop constraint if exists automation_usage_tokens_nonneg;
alter table public.automation_usage
  add constraint automation_usage_tokens_nonneg check (tokens_used >= 0);

create index if not exists automation_usage_day_idx on public.automation_usage (day);

-- Só leitura: quem escreve é `consume_llm_tokens`, que é security definer.
revoke all on public.automation_usage from anon, authenticated;
grant select on public.automation_usage to authenticated;
grant select, insert, update, delete on public.automation_usage to service_role;

alter table public.automation_usage enable row level security;

drop policy if exists "members read automation usage" on public.automation_usage;
create policy "members read automation usage"
  on public.automation_usage for select
  using (public.is_org_member(organization_id));

-- =============================================================================
-- 6. O teto do balde da automação
-- =============================================================================
create or replace function public.automation_daily_cap()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select 500000;
$$;

comment on function public.automation_daily_cap() is
  'Quantos tokens a automação de um workspace pode gastar por dia. Número no código, não em tabela: muda com release.';

revoke execute on function public.automation_daily_cap() from public, anon;
grant execute on function public.automation_daily_cap() to authenticated;

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

  -- Quando existe sessão, exige pertencer ao workspace. Sem sessão só chega
  -- aqui o processo do container (que conecta como `postgres` pelo
  -- DATABASE_URL), e ele precisa da conta pra decidir se enfileira.
  if auth.uid() is not null and not public.is_org_member(_organization_id) then
    raise exception 'not a member of this organization';
  end if;

  select tokens_used into v_usado
    from public.automation_usage
   where organization_id = _organization_id
     and day = current_date;

  return greatest(public.automation_daily_cap() - coalesce(v_usado, 0), 0);
end;
$$;

revoke execute on function public.automation_budget_left(uuid) from public, anon;
grant execute on function public.automation_budget_left(uuid) to authenticated;

-- =============================================================================
-- 7. Quando é a próxima vez que este agendamento roda
-- =============================================================================
-- A conta é do Postgres de propósito: ele tem o banco de fusos horários
-- completo, então horário de verão sai certo sem biblioteca nenhuma.
--
-- Dois cantos conhecidos:
--  • horário LOCAL QUE NÃO EXISTE (na virada pra frente): o Postgres empurra
--    pro instante seguinte válido. O agendamento roda um pouco depois.
--  • horário QUE ACONTECE DUAS VEZES (na virada pra trás): a chave de
--    idempotência do slot impede a segunda rodada.
create or replace function public.next_schedule_run(
  _kind text,
  _hour smallint,
  _minute smallint,
  _weekdays smallint[],
  _day_of_month smallint,
  _every_minutes integer,
  _timezone text,
  _from timestamptz default null
)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_base timestamptz := coalesce(_from, now());
  v_local timestamp;
  v_dia date;
  v_alvo timestamptz;
  v_i integer;
begin
  if _kind is null or _timezone is null or _timezone = '' then
    return null;
  end if;

  if _kind = 'interval' then
    if _every_minutes is null or _every_minutes < 1 then
      return null;
    end if;
    return v_base + make_interval(mins => _every_minutes);
  end if;

  if _hour is null or _minute is null then
    return null;
  end if;

  -- `at time zone` num timestamptz devolve o relógio de parede daquele fuso.
  v_local := v_base at time zone _timezone;
  v_dia := v_local::date;

  if _kind = 'daily' then
    for v_i in 0..1 loop
      v_alvo := ((v_dia + v_i) + make_time(_hour, _minute, 0)) at time zone _timezone;
      if v_alvo > v_base then
        return v_alvo;
      end if;
    end loop;
    return null;
  end if;

  if _kind = 'weekly' then
    if _weekdays is null or array_length(_weekdays, 1) is null then
      return null;
    end if;
    -- 0 = domingo, igual ao `extract(dow)` do Postgres.
    for v_i in 0..7 loop
      if extract(dow from (v_dia + v_i))::smallint = any(_weekdays) then
        v_alvo := ((v_dia + v_i) + make_time(_hour, _minute, 0)) at time zone _timezone;
        if v_alvo > v_base then
          return v_alvo;
        end if;
      end if;
    end loop;
    return null;
  end if;

  if _kind = 'monthly' then
    if _day_of_month is null then
      return null;
    end if;
    -- Teto de 28 no check da coluna: assim o dia existe em TODO mês, inclusive
    -- fevereiro. Sem isso, "dia 31" pularia meses inteiros calado.
    for v_i in 0..12 loop
      v_dia := (date_trunc('month', v_local) + make_interval(months => v_i))::date
               + (_day_of_month - 1);
      v_alvo := (v_dia + make_time(_hour, _minute, 0)) at time zone _timezone;
      if v_alvo > v_base then
        return v_alvo;
      end if;
    end loop;
    return null;
  end if;

  return null;
end;
$$;

revoke execute on function public.next_schedule_run(
  text, smallint, smallint, smallint[], smallint, integer, text, timestamptz
) from public, anon;
grant execute on function public.next_schedule_run(
  text, smallint, smallint, smallint[], smallint, integer, text, timestamptz
) to authenticated;

-- O gatilho que mantém `next_run_at` honesto. Sem ele, um agendamento gravado
-- sem data ficaria parado pra sempre — em silêncio, que é o pior jeito de
-- falhar. De quebra, ninguém consegue apontar a próxima rodada pra onde quiser.
create or replace function public.schedule_set_next_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_active then
      new.next_run_at := public.next_schedule_run(
        new.kind, new.hour, new.minute, new.weekdays,
        new.day_of_month, new.every_minutes, new.timezone, now()
      );
    else
      new.next_run_at := null;
    end if;
    return new;
  end if;

  if not new.is_active then
    new.next_run_at := null;
  elsif old.is_active is distinct from new.is_active
     or old.kind is distinct from new.kind
     or old.hour is distinct from new.hour
     or old.minute is distinct from new.minute
     or old.weekdays is distinct from new.weekdays
     or old.day_of_month is distinct from new.day_of_month
     or old.every_minutes is distinct from new.every_minutes
     or old.timezone is distinct from new.timezone then
    new.next_run_at := public.next_schedule_run(
      new.kind, new.hour, new.minute, new.weekdays,
      new.day_of_month, new.every_minutes, new.timezone, now()
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.schedule_set_next_run() from public, anon, authenticated;

drop trigger if exists schedules_set_next_run on public.schedules;
create trigger schedules_set_next_run
  before insert or update on public.schedules
  for each row execute function public.schedule_set_next_run();

-- =============================================================================
-- 8. Abrir e fechar execução SEM sessão (o processo do container)
-- =============================================================================
-- ⚠️ ESTAS DUAS FUNÇÕES SÃO INALCANÇÁVEIS POR QUEM ESTÁ LOGADO.
-- `revoke execute … from public, anon, authenticated` embaixo de cada uma. Só
-- quem conecta como `postgres` pelo DATABASE_URL (ou seja: o processo dentro do
-- container) chama. Se `authenticated` alcançasse `finish_agent_run_system`,
-- qualquer pessoa fecharia qualquer execução com qualquer número — que é
-- exatamente o buraco que a migration 20260820030000 fechou.
--
-- ⚠️ O `drop function if exists` abaixo é o que deixa a PILHA INTEIRA reaplicar
-- por cima de um banco cheio. A migration 20260821040000 (teto de gasto) troca
-- o retorno desta função de `void` pra `jsonb`; sem derrubar antes, este
-- `create or replace` erraria com "cannot change return type of existing
-- function" quando as migrations fossem reaplicadas do zero.
drop function if exists public.finish_agent_run_system(uuid, public.agent_run_status, text, text);
create or replace function public.finish_agent_run_system(
  _run_id uuid,
  _status public.agent_run_status,
  _output text default null,
  _error_message text default null
)
returns void
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
begin
  if _status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid terminal status';
  end if;

  select * into v_run from public.agent_runs where id = _run_id;
  if not found then
    return;
  end if;

  -- Execução já fechada não reabre e não muda de número. Sai calado de
  -- propósito: fechar duas vezes é corrida normal entre o tempo estourando e o
  -- modelo respondendo.
  if v_run.status in ('succeeded', 'failed', 'cancelled') then
    return;
  end if;

  -- A conta SAI DO RASTRO (`agent_run_steps`, só-de-acréscimo), nunca do
  -- número que chegou por parâmetro.
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
         -- `null` continua querendo dizer "não deu pra calcular" (modelo fora
         -- do catálogo de preços). Zero seria mentira.
         cost_micros = case when v_custo_desconhecido then null else v_cost end,
         finished_at = now()
   where id = _run_id;
end;
$$;

revoke execute on function public.finish_agent_run_system(
  uuid, public.agent_run_status, text, text
) from public, anon, authenticated;

-- Abre uma execução sem sessão. Serve pro caminho da automação conseguir
-- registrar o rastro de um trabalho que nem chegou a virar sessão (por exemplo:
-- "quem essa automação representa saiu do time"), pra tela de Execuções nunca
-- ter um buraco sem explicação.
create or replace function public.open_agent_run_system(
  _organization_id uuid,
  _agent_id uuid,
  _agent_slug text,
  _triggered_by uuid,
  _trigger_kind public.agent_trigger_kind,
  _input jsonb,
  _model text,
  _thread_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_id uuid;
begin
  if _organization_id is null or _agent_slug is null then
    raise exception 'organization and agent slug are required';
  end if;

  insert into public.agent_runs (
    organization_id, agent_id, agent_slug, model,
    triggered_by, trigger_kind, input, status, started_at, thread_id
  )
  values (
    _organization_id, _agent_id, _agent_slug, _model,
    _triggered_by, coalesce(_trigger_kind, 'manual'::public.agent_trigger_kind),
    coalesce(_input, '{}'::jsonb), 'running', now(), _thread_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.open_agent_run_system(
  uuid, uuid, text, uuid, public.agent_trigger_kind, jsonb, text, uuid
) from public, anon, authenticated;

-- A porta de quem ESTÁ LOGADO continua a mesma de antes, com as mesmas
-- conferências — ela só passa a delegar a conta pra função de sistema, pra
-- existir UM lugar só que sabe somar o rastro.
--
-- ⚠️ Mesmo motivo do `drop` de `finish_agent_run_system` acima: a 20260821040000
-- troca o retorno desta função pra `jsonb`, e sem derrubar antes a reaplicação
-- da pilha inteira quebraria aqui.
drop function if exists public.finish_agent_run(uuid, public.agent_run_status, text, text);
create or replace function public.finish_agent_run(
  _run_id uuid,
  _status public.agent_run_status,
  _output text default null,
  _error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_run public.agent_runs%rowtype;
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

  -- Fecha quem disparou, ou quem administra o workspace.
  if v_run.triggered_by is distinct from auth.uid()
     and not public.has_org_role(
       v_run.organization_id,
       array['owner', 'admin']::public.org_role[]
     ) then
    raise exception 'not allowed to finish this run';
  end if;

  perform public.finish_agent_run_system(_run_id, _status, _output, _error_message);
end;
$$;

revoke execute on function public.finish_agent_run(
  uuid, public.agent_run_status, text, text
) from public, anon;
grant execute on function public.finish_agent_run(
  uuid, public.agent_run_status, text, text
) to authenticated;

-- Redundante com a 20260820030000, e de propósito: se um dia alguém reaplicar
-- as migrations fora de ordem, esta linha continua tirando a permissão.
revoke update on public.agent_runs from authenticated;

-- =============================================================================
-- 9. A cota de IA passa a saber diferenciar pessoa de automação
-- =============================================================================
-- `set row_security = off` entra agora porque a função passou a LER
-- `public.jobs`, que tem RLS e policy. Antes ela funcionava por tabela+dono;
-- agora a regra fica escrita (regra 3 do CLAUDE.md raiz).
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
begin
  if auth.uid() is null then
    return false;
  end if;
  if _tokens is null or _tokens <= 0 or _tokens > 100000 then
    raise exception 'invalid token count';
  end if;

  -- A marca `app.automation_job` é colocada pela ponte, dentro da transação de
  -- cada consulta da automação. O PostgREST não deixa cliente definir GUC, mas
  -- mesmo que alguém conseguisse forjar: a marca só vale se apontar pra um
  -- trabalho DE VERDADE, RODANDO, cujo dono é EXATAMENTE quem está pedindo. No
  -- pior caso a pessoa gasta o balde do próprio workspace.
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
      values (v_job.organization_id, current_date, _tokens)
      on conflict (organization_id, day) do update
        set tokens_used = automation_usage.tokens_used + excluded.tokens_used
      returning tokens_used into v_current;
      return v_current <= public.automation_daily_cap();
    end if;
  end if;

  insert into public.llm_usage (user_id, day, tokens_used)
  values (auth.uid(), current_date, _tokens)
  on conflict (user_id, day) do update
    set tokens_used = llm_usage.tokens_used + excluded.tokens_used
  returning tokens_used into v_current;

  return v_current <= v_cap;
end;
$$;

revoke execute on function public.consume_llm_tokens(integer) from public, anon;
grant execute on function public.consume_llm_tokens(integer) to authenticated;

-- =============================================================================
-- 10. A fila, por dentro: pegar, marcar, soltar e fechar trabalho
-- =============================================================================
-- ⚠️ TODAS ESTAS SÃO INALCANÇÁVEIS POR QUEM ESTÁ LOGADO (revoke abaixo de cada
-- uma). Quem chama é o trabalhador, que conecta como `postgres`.

-- Pega UM trabalho da fila. `for update skip locked` é o que faz duas réplicas
-- no EasyPanel nunca pegarem o mesmo trabalho.
create or replace function public.claim_job(_worker_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_id uuid;
begin
  if _worker_id is null or char_length(_worker_id) < 1 or char_length(_worker_id) > 80 then
    raise exception 'invalid worker id';
  end if;

  select j.id into v_id
    from public.jobs j
   where j.status = 'pending'
     and j.run_after <= now()
   order by j.run_after asc, j.created_at asc
   limit 1
   for update skip locked;

  if v_id is null then
    return null;
  end if;

  update public.jobs
     set status = 'running',
         locked_at = now(),
         locked_by = _worker_id,
         attempts = attempts + 1,
         updated_at = now()
   where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.claim_job(text) from public, anon, authenticated;

-- Devolve a linha do trabalho SÓ se ele estiver rodando E travado por ESTE
-- trabalhador. É o que impede uma chamada forjada de rodar trabalho alheio.
-- ⚠️ `drop` antes do `create`: a migration 20260821070000 acrescenta a coluna
-- `kind` no retorno desta função. Sem derrubar antes, reaplicar a pilha inteira
-- morre com "cannot change return type of existing function".
drop function if exists public.job_for_run(uuid, text);
create or replace function public.job_for_run(_job_id uuid, _worker_id text)
returns table (
  id uuid,
  organization_id uuid,
  agent_id uuid,
  payload jsonb,
  run_as uuid,
  source_kind text,
  source_id uuid,
  attempts integer,
  max_attempts integer,
  locked_by text
)
language sql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
  select j.id, j.organization_id, j.agent_id, j.payload, j.run_as,
         j.source_kind, j.source_id, j.attempts, j.max_attempts, j.locked_by
    from public.jobs j
   where j.id = _job_id
     and j.status = 'running'
     and j.locked_by is not distinct from _worker_id;
$$;

revoke execute on function public.job_for_run(uuid, text) from public, anon, authenticated;

-- true SÓ na primeira vez. Entrega repetida do mesmo trabalho é recusada — é o
-- que impede cobrar duas vezes por uma automação que já começou.
create or replace function public.mark_job_started(_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.jobs
     set started_at = now(),
         updated_at = now()
   where id = _job_id
     and status = 'running'
     and started_at is null;

  return found;
end;
$$;

revoke execute on function public.mark_job_started(uuid) from public, anon, authenticated;

-- Fecha o trabalho. Com `_retry_in` preenchido E ainda tendo tentativa, ele
-- volta pra fila; caso contrário fecha de vez.
create or replace function public.finish_job(
  _job_id uuid,
  _status public.job_status,
  _error text default null,
  _run_id uuid default null,
  _retry_in interval default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_job public.jobs%rowtype;
begin
  if _status not in ('done', 'failed', 'cancelled') then
    raise exception 'invalid terminal job status';
  end if;

  select * into v_job from public.jobs where id = _job_id for update;
  if not found then
    return;
  end if;

  if v_job.status in ('done', 'cancelled') then
    return;
  end if;

  if _retry_in is not null
     and _status = 'failed'
     and v_job.attempts < v_job.max_attempts then
    update public.jobs
       set status = 'pending',
           run_after = now() + _retry_in,
           locked_at = null,
           locked_by = null,
           started_at = null,
           last_error = left(_error, 2000),
           updated_at = now()
     where id = _job_id;
    return;
  end if;

  update public.jobs
     set status = _status,
         finished_at = now(),
         last_error = left(_error, 2000),
         run_id = coalesce(_run_id, run_id),
         locked_at = null,
         locked_by = null,
         updated_at = now()
   where id = _job_id;
end;
$$;

revoke execute on function public.finish_job(
  uuid, public.job_status, text, uuid, interval
) from public, anon, authenticated;

-- Devolve o trabalho pra fila sem contar como falha final (o site reiniciou, a
-- chamada interna não respondeu). Só vale pra trabalho que NÃO começou.
create or replace function public.release_job(_job_id uuid, _error text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.jobs
     set status = 'pending',
         run_after = now() + make_interval(secs => 30),
         locked_at = null,
         locked_by = null,
         last_error = left(_error, 2000),
         updated_at = now()
   where id = _job_id
     and status = 'running'
     and started_at is null;
end;
$$;

revoke execute on function public.release_job(uuid, text) from public, anon, authenticated;

-- A faxina da fila. Laço plpgsql simples de propósito: a versão com CTE e
-- `for update` funciona, mas depende de detalhes de snapshot entre os
-- sub-comandos do `with` que quase ninguém sabe de cabeça.
create or replace function public.reclaim_stuck_jobs(_older_than interval default '10 minutes')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_job record;
  v_count integer := 0;
begin
  for v_job in
    select j.id, j.attempts, j.max_attempts, j.started_at
      from public.jobs j
     where j.status = 'running'
       and j.locked_at is not null
       and j.locked_at < now() - _older_than
     order by j.locked_at asc
     limit 50
     for update skip locked
  loop
    -- ⚠️ Trabalho que JÁ COMEÇOU não é refeito: ele pode ter gastado dinheiro
    -- antes de travar. Perder uma rodada é melhor que cobrar duas vezes.
    if v_job.started_at is not null or v_job.attempts >= v_job.max_attempts then
      update public.jobs
         set status = 'failed',
             finished_at = now(),
             locked_at = null,
             locked_by = null,
             last_error = coalesce(
               last_error,
               'Essa automação ficou presa e o site reiniciou no meio dela. Ela não foi refeita pra não cobrar duas vezes.'
             ),
             updated_at = now()
       where id = v_job.id;
    else
      update public.jobs
         set status = 'pending',
             run_after = now() + make_interval(mins => case when v_job.attempts <= 1 then 1 else 5 end),
             locked_at = null,
             locked_by = null,
             updated_at = now()
       where id = v_job.id;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.reclaim_stuck_jobs(interval) from public, anon, authenticated;

-- Execução pendurada em `queued`/`running` vira falha explicada. Sem isso a
-- tela de Execuções acumula linha "rodando" pra sempre, e o teto de gasto da
-- onda 6 nunca fecha a conta.
create or replace function public.reclaim_stuck_agent_runs(_older_than interval default '20 minutes')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_run record;
  v_count integer := 0;
begin
  for v_run in
    select r.id
      from public.agent_runs r
     where r.status in ('queued', 'running')
       and r.created_at < now() - _older_than
     order by r.created_at asc
     limit 200
     for update skip locked
  loop
    perform public.finish_agent_run_system(
      v_run.id,
      'failed'::public.agent_run_status,
      null,
      'Essa execução ficou parada e foi encerrada. Provavelmente o site reiniciou no meio dela.'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.reclaim_stuck_agent_runs(interval) from public, anon, authenticated;

-- =============================================================================
-- 11. Entrar na fila
-- =============================================================================
-- "Rodar agora", pela tela. É a ÚNICA função de enfileirar que quem está logado
-- alcança — e ela grava `run_as = auth.uid()`, ou seja: a pessoa sempre roda no
-- próprio nome, nunca no de outra.
create or replace function public.enqueue_agent_job(
  _agent_id uuid,
  _input jsonb default '{}'::jsonb,
  _source_kind text default 'manual',
  _source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_agent public.agents%rowtype;
  v_pendentes integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if _source_kind is null or _source_kind not in ('manual', 'schedule') then
    raise exception 'invalid source kind';
  end if;

  select * into v_agent from public.agents where id = _agent_id;
  if not found then
    raise exception 'agent not found';
  end if;
  if not public.is_org_member(v_agent.organization_id) then
    raise exception 'not a member of this organization';
  end if;
  if v_agent.status = 'archived' then
    raise exception 'agent is archived';
  end if;

  -- Quando o pedido veio de um agendamento, ele tem que ser do MESMO workspace
  -- e apontar pro MESMO agente. Sem isso dava pra carimbar um trabalho com o
  -- número de um agendamento alheio e sujar o histórico dele.
  if _source_kind = 'schedule' then
    if _source_id is null then
      raise exception 'schedule id is required';
    end if;
    if not exists (
      select 1 from public.schedules s
       where s.id = _source_id
         and s.organization_id = v_agent.organization_id
         and s.agent_id = v_agent.id
    ) then
      raise exception 'schedule not found';
    end if;
  end if;

  -- Freio de mão contra alguém segurando o botão "Rodar agora".
  select count(*) into v_pendentes
    from public.jobs j
   where j.organization_id = v_agent.organization_id
     and j.status in ('pending', 'running');
  if v_pendentes >= 25 then
    raise exception 'too many jobs waiting';
  end if;

  insert into public.jobs (
    organization_id, kind, agent_id, run_as, payload, source_kind, source_id
  )
  values (
    v_agent.organization_id, 'run_agent', v_agent.id, auth.uid(),
    coalesce(_input, '{}'::jsonb), _source_kind, _source_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.enqueue_agent_job(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.enqueue_agent_job(uuid, jsonb, text, uuid) to authenticated;

-- O trabalhador chama isto a cada 20 segundos: pega os agendamentos vencidos e
-- coloca um trabalho na fila pra cada um.
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
    -- Quem esta automação representa ainda está no time? Se saiu, o agendamento
    -- é DESLIGADO com uma frase que a tela mostra — em vez de falhar todo dia
    -- calado.
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

    -- O slot: um trabalho por agendamento por horário. Se duas réplicas
    -- rodarem juntas, ou se o mesmo horário acontecer duas vezes na virada do
    -- horário de verão, o segundo insert simplesmente não acontece.
    v_key := 'schedule:' || v_s.id::text || ':'
             || to_char(v_s.next_run_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI');

    insert into public.jobs (
      organization_id, kind, agent_id, run_as, payload, source_kind, source_id, idempotency_key
    )
    values (
      v_s.organization_id, 'run_agent', v_s.agent_id, v_s.run_as,
      coalesce(v_s.input, '{}'::jsonb), 'schedule', v_s.id, v_key
    )
    -- ⚠️ O `where` REPETIDO é obrigatório: `jobs_idempotency_uidx` é um índice
    -- PARCIAL, e sem ele o Postgres não acha o índice e estoura.
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

-- O webhook chegou: enfileira e responde 202. O agente NUNCA roda dentro do
-- pedido HTTP.
--
-- ⚠️ O CORPO ENTRA SEMPRE COMO `input.data`, NUNCA COMO `input.prompt`.
-- Isso é o par do rodapé anti-injeção de lib/agents/prompt.ts: o motor marca o
-- que está em `data` como DADO, não instrução. Não embrulhe de novo do lado do
-- TypeScript — o embrulho é feito AQUI, de propósito, porque o banco é a última
-- camada que ninguém contorna.
--
-- ⚠️ Mesmo motivo dos `drop` das funções de fechar execução: a 20260821040000
-- troca o retorno desta função de `uuid` pra `jsonb` (pra recusa ter NOME), e
-- sem derrubar antes a reaplicação da pilha inteira quebraria aqui.
drop function if exists public.enqueue_webhook_job(uuid, jsonb, text);
create or replace function public.enqueue_webhook_job(
  _endpoint_id uuid,
  _payload jsonb default '{}'::jsonb,
  _idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_ep public.webhook_endpoints%rowtype;
  v_pendentes integer;
  v_id uuid;
begin
  select * into v_ep from public.webhook_endpoints where id = _endpoint_id;
  if not found or not v_ep.is_active then
    return null;
  end if;

  if v_ep.run_as is null or not exists (
    select 1 from public.memberships m
     where m.organization_id = v_ep.organization_id
       and m.user_id = v_ep.run_as
  ) then
    update public.webhook_endpoints
       set is_active = false, updated_at = now()
     where id = v_ep.id;
    return null;
  end if;

  select count(*) into v_pendentes
    from public.jobs j
   where j.organization_id = v_ep.organization_id
     and j.status in ('pending', 'running');
  if v_pendentes >= 25 then
    return null;
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

  return v_id;
end;
$$;

revoke execute on function public.enqueue_webhook_job(uuid, jsonb, text) from public, anon, authenticated;

-- =============================================================================
-- 12. Contar o resultado de volta pro agendamento e pro webhook
-- =============================================================================
create or replace function public.schedule_report_result(
  _schedule_id uuid,
  _error text default null,
  _pausar boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.schedules
     set last_error = left(_error, 2000),
         is_active = case when coalesce(_pausar, false) then false else is_active end,
         updated_at = now()
   where id = _schedule_id;
end;
$$;

revoke execute on function public.schedule_report_result(uuid, text, boolean)
  from public, anon, authenticated;

-- Devolve o `token_hash` pra comparação em tempo constante do lado do Node.
-- ⚠️ Isto NUNCA pode virar alcançável por `authenticated`: seria entregar o
-- hash de todos os webhooks do banco pra qualquer pessoa logada.
--
-- ⚠️ `drop` ANTES do `create or replace` (correção da rodada 2 da task 4,
-- achada rodando o replay da pilha inteira: apagar
-- `supabase_migrations.schema_migrations` num banco cheio e reaplicar). A
-- migration `20260821110000_agente_que_age.sql` muda o `returns table` desta
-- função (acrescenta `modo`/`esperar_resposta`), e Postgres recusa
-- `create or replace` que muda tipo de retorno ("cannot change return type of
-- existing function"). No boot normal (banco já criado do zero com a versão
-- nova) isso nunca aparece, porque a função só existe na forma NOVA. No
-- replay — a mesma pilha de migrations reaplicada do zero — esta linha roda
-- ANTES daquela, criando primeiro a forma ANTIGA, e ela precisa saber se
-- apagar sozinha. Só torna a migration reaplicável; não muda o que ela
-- significa.
drop function if exists public.webhook_endpoint_for_check(uuid);

create or replace function public.webhook_endpoint_for_check(_endpoint_id uuid)
returns table (
  id uuid,
  organization_id uuid,
  agent_id uuid,
  token_hash text,
  is_active boolean,
  run_as uuid
)
language sql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
  select w.id, w.organization_id, w.agent_id, w.token_hash, w.is_active, w.run_as
    from public.webhook_endpoints w
   where w.id = _endpoint_id;
$$;

revoke execute on function public.webhook_endpoint_for_check(uuid)
  from public, anon, authenticated;

-- Conta a chamada E responde se ela cabe no limite do minuto. O limite é
-- contado NO BANCO porque o limitador do proxy.ts vive na memória de cada
-- processo — com duas réplicas, cada uma contaria metade.
create or replace function public.webhook_touch(
  _endpoint_id uuid,
  _limite_por_minuto integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_agora timestamptz := now();
  v_ok boolean;
begin
  update public.webhook_endpoints
     set window_started_at = case
           when window_started_at is null or window_started_at < v_agora - interval '1 minute'
             then v_agora
           else window_started_at
         end,
         window_count = case
           when window_started_at is null or window_started_at < v_agora - interval '1 minute'
             then 1
           else window_count + 1
         end,
         calls_count = calls_count + 1,
         last_called_at = v_agora,
         updated_at = v_agora
   where id = _endpoint_id
   returning window_count <= greatest(coalesce(_limite_por_minuto, 60), 1) into v_ok;

  return coalesce(v_ok, false);
end;
$$;

revoke execute on function public.webhook_touch(uuid, integer) from public, anon, authenticated;

-- Avisa o PostgREST (a API do Supabase) que o desenho do banco mudou.
notify pgrst, 'reload schema';
