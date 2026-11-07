-- =============================================================================
-- Agentes de IA: o cadastro, as execuções e o rastro de cada passo
-- =============================================================================
-- O QUE ISSO RESOLVE
-- Um "agente" aqui é um registro no banco: nome, instruções, modelo escolhido e
-- quais ferramentas ele pode usar. Isso deixa você ajustar o comportamento do
-- agente pela tela, sem subir o app de novo. As FERRAMENTAS continuam sendo
-- código (é o Claude Code que escreve), mas ligar/desligar cada uma é clique.
--
-- São três tabelas:
--
--   agents           → o agente em si (o "molde")
--   agent_runs       → cada vez que ele rodou (quem mandou, quanto custou,
--                      deu certo ou não)
--   agent_run_steps  → o passo a passo daquela execução (o modelo pensou,
--                      chamou a ferramenta X, deu erro no Y)
--
-- POR QUE GUARDAR O PASSO A PASSO
-- Agente sem rastro é caixa-preta, e ninguém depura caixa-preta. Com o rastro,
-- dá pra abrir uma execução que falhou e ver EXATAMENTE em que passo quebrou,
-- com que entrada e quanto tinha custado até ali.
--
-- 💵 DINHEIRO É NÚMERO INTEIRO
-- Custo fica em MICRO-DÓLARES (`cost_micros`, bigint): 1 dólar = 1.000.000.
-- Número quebrado (float) erra centavo por arredondamento e a conta não fecha.
--
-- ⚠️ `cost_micros` PODE SER NULO — e nulo NÃO é zero.
--   • null = não deu pra calcular (modelo fora da tabela de preços do código)
--   • 0    = rodou e custou zero mesmo
-- Se fosse `not null default 0`, uma execução de modelo desconhecido apareceria
-- na tela como "US$ 0,0000", que é mentira. A tela mostra "preço desconhecido".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Listas fixas de valores
-- -----------------------------------------------------------------------------
-- Bloco condicional porque Postgres não tem "create type if not exists".
do $$
begin
  create type public.agent_status as enum ('draft', 'active', 'archived');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.agent_trigger_kind as enum ('chat', 'manual', 'schedule', 'webhook');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.agent_run_status as enum (
    'queued', 'running', 'succeeded', 'failed', 'cancelled'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.agent_step_kind as enum ('model', 'tool');
exception
  when duplicate_object then null;
end
$$;

-- =============================================================================
-- 2. agents — o molde do agente
-- =============================================================================
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Vira endereço na barra do navegador (/agentes/atendimento) e fica
  -- congelado em cada execução. Por isso não muda depois de criado.
  slug text not null,
  name text not null,
  description text,
  -- As instruções do agente ("você é um assistente que...").
  system_prompt text not null default '',
  -- Formato "provedor:modelo". Ex.: "openrouter:anthropic/claude-sonnet-5".
  model text not null,
  -- 0 = sempre a resposta mais previsível; 2 = mais criativo (e mais solto).
  temperature real not null default 0.7,
  -- Quantas vezes o agente pode "pensar de novo" depois de usar ferramenta.
  -- Teto de segurança contra laço infinito.
  max_steps integer not null default 5,
  max_output_tokens integer not null default 2048,
  -- Ids das ferramentas ligadas. Os ids vivem no código (lib/agents/tools).
  tools text[] not null default '{}'::text[],
  status public.agent_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agents_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  constraint agents_name_len check (char_length(name) between 2 and 80),
  constraint agents_description_len check (description is null or char_length(description) <= 300),
  constraint agents_system_prompt_len check (char_length(system_prompt) <= 20000),
  constraint agents_model_len check (char_length(model) between 3 and 120),
  constraint agents_temperature_range check (temperature >= 0 and temperature <= 2),
  constraint agents_max_steps_range check (max_steps between 1 and 20),
  constraint agents_max_output_tokens_range check (max_output_tokens between 64 and 32000),
  constraint agents_tools_len
    check (array_length(tools, 1) is null or array_length(tools, 1) <= 20)
);

comment on table public.agents is
  'Cadastro dos agentes de IA de cada workspace. Prompt, modelo e ferramentas são editáveis pela tela.';
comment on column public.agents.slug is
  'Apelido do agente na URL. Fica congelado em agent_runs.agent_slug, então não muda depois de criado.';
comment on column public.agents.tools is
  'Ids das ferramentas ligadas. Quem define as ferramentas é o código, em lib/agents/tools.';

create unique index if not exists agents_org_slug_key
  on public.agents (organization_id, slug);

create index if not exists agents_org_updated_idx
  on public.agents (organization_id, updated_at desc);

create index if not exists agents_org_status_idx
  on public.agents (organization_id, status);

-- Zera e devolve só o necessário. O `revoke all` aqui não é enfeite: além do
-- select/insert/update/delete da migration 20260820000000_table_grants, o
-- próprio Supabase concede TRUNCATE a `anon` e `authenticated` em toda tabela
-- nova — e TRUNCATE **ignora a RLS**, ou seja, uma pessoa logada conseguiria
-- limpar a tabela de TODOS os workspaces de uma vez.
revoke all on public.agents from anon, authenticated;
grant select, insert, update, delete on public.agents to authenticated;
grant select, insert, update, delete on public.agents to service_role;

-- RLS — só ENABLE (nunca FORCE, ver regra 2 do CLAUDE.md).
alter table public.agents enable row level security;

drop policy if exists "members read agents" on public.agents;
create policy "members read agents"
  on public.agents for select
  using (public.is_org_member(organization_id));

drop policy if exists "admins insert agents" on public.agents;
create policy "admins insert agents"
  on public.agents for insert
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = created_by
  );

drop policy if exists "admins update agents" on public.agents;
create policy "admins update agents"
  on public.agents for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists "admins delete agents" on public.agents;
create policy "admins delete agents"
  on public.agents for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop trigger if exists agents_set_updated_at on public.agents;
create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

-- Impede que alguém mude a organização ou o criador da própria linha e vaze
-- dado pra outro workspace.
drop trigger if exists agents_freeze_org_and_creator on public.agents;
create trigger agents_freeze_org_and_creator
  before update on public.agents
  for each row execute function public.freeze_org_and_creator();

-- =============================================================================
-- 3. agent_runs — cada vez que um agente rodou
-- =============================================================================
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Fica nulo se o agente for apagado depois: a execução antiga sobrevive.
  agent_id uuid references public.agents(id) on delete set null,
  -- Cópia congelada do apelido, pra listagem continuar legível mesmo depois
  -- que o agente sumir.
  agent_slug text not null,
  -- "provedor:modelo" usado nessa execução. Nulo quando nem chegou a escolher.
  model text,
  triggered_by uuid references auth.users(id) on delete set null,
  trigger_kind public.agent_trigger_kind not null default 'manual',
  input jsonb not null default '{}'::jsonb,
  output text,
  status public.agent_run_status not null default 'queued',
  -- JÁ em português claro. Quem traduz é o motor; a tela mostra cru.
  error_message text,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  -- Micro-dólares. NULO = não deu pra calcular o preço (não é zero!).
  cost_micros bigint,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agent_runs_agent_slug_len check (char_length(agent_slug) between 1 and 60),
  constraint agent_runs_model_len check (model is null or char_length(model) <= 120),
  constraint agent_runs_tokens_nonneg check (tokens_input >= 0 and tokens_output >= 0),
  constraint agent_runs_cost_nonneg check (cost_micros is null or cost_micros >= 0)
);

comment on table public.agent_runs is
  'Uma linha por execução de agente: quem mandou rodar, o que entrou, o que saiu, quanto custou.';
comment on column public.agent_runs.agent_slug is
  'Cópia congelada do apelido do agente, pra execução antiga continuar legível se o agente for apagado.';
comment on column public.agent_runs.cost_micros is
  'Custo em micro-dólares (1 dólar = 1.000.000). NULO = preço desconhecido; 0 = custou zero mesmo.';

-- FK extra pra tela conseguir puxar o nome de quem mandou rodar.
-- A FK principal aponta pra auth.users, e o PostgREST não navega até lá.
do $$
begin
  alter table public.agent_runs
    add constraint agent_runs_triggered_by_profile_fkey
    foreign key (triggered_by) references public.profiles(id) on delete set null;
exception
  when duplicate_object then null;
  when duplicate_table then null;
end
$$;

create index if not exists agent_runs_org_created_idx
  on public.agent_runs (organization_id, created_at desc);

-- A tela de execuções filtra por situação.
create index if not exists agent_runs_org_status_created_idx
  on public.agent_runs (organization_id, status, created_at desc);

create index if not exists agent_runs_org_agent_created_idx
  on public.agent_runs (organization_id, agent_id, created_at desc);

create index if not exists agent_runs_org_slug_created_idx
  on public.agent_runs (organization_id, agent_slug, created_at desc);

-- Mesmo motivo do `revoke all` em agents: fecha o TRUNCATE que ignora a RLS.
revoke all on public.agent_runs from anon, authenticated;
grant select, insert, update, delete on public.agent_runs to authenticated;
grant select, insert, update, delete on public.agent_runs to service_role;

alter table public.agent_runs enable row level security;

drop policy if exists "members read runs" on public.agent_runs;
create policy "members read runs"
  on public.agent_runs for select
  using (public.is_org_member(organization_id));

drop policy if exists "members insert runs" on public.agent_runs;
create policy "members insert runs"
  on public.agent_runs for insert
  with check (public.is_org_member(organization_id) and auth.uid() = triggered_by);

-- Quem mandou rodar atualiza a própria execução (é assim que o motor grava o
-- resultado no fim). Owner/admin também, pra poder cancelar execução alheia.
drop policy if exists "owner of run updates it" on public.agent_runs;
create policy "owner of run updates it"
  on public.agent_runs for update
  using (
    public.is_org_member(organization_id)
    and (
      triggered_by = auth.uid()
      or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    )
  )
  with check (
    public.is_org_member(organization_id)
    and (
      triggered_by = auth.uid()
      or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    )
  );

drop policy if exists "admins delete runs" on public.agent_runs;
create policy "admins delete runs"
  on public.agent_runs for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Congela o que identifica a execução. Sem isso, alguém poderia reescrever o
-- histórico (trocar de agente, de organização ou de autor) depois do fato.
create or replace function public.freeze_agent_run_keys()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.agent_slug is distinct from old.agent_slug
     or new.trigger_kind is distinct from old.trigger_kind
     or new.input is distinct from old.input
     or new.created_at is distinct from old.created_at then
    raise exception 'agent_runs: id, organization_id, agent_slug, trigger_kind, input and created_at are immutable (security)';
  end if;

  -- agent_id só pode ir pra nulo, e só quando o agente realmente sumiu
  -- (on delete set null). Nunca pode apontar pra outro agente.
  if new.agent_id is distinct from old.agent_id then
    if new.agent_id is null
       and old.agent_id is not null
       and not exists (select 1 from public.agents where id = old.agent_id) then
      return new;
    end if;
    raise exception 'agent_runs.agent_id is immutable (security)';
  end if;

  -- Mesma regra pra quem disparou: só vira nulo se a conta foi apagada.
  if new.triggered_by is distinct from old.triggered_by then
    if new.triggered_by is null
       and old.triggered_by is not null
       and not exists (select 1 from auth.users where id = old.triggered_by) then
      return new;
    end if;
    raise exception 'agent_runs.triggered_by is immutable (security)';
  end if;

  return new;
end;
$$;

revoke execute on function public.freeze_agent_run_keys() from public, anon, authenticated;

drop trigger if exists agent_runs_freeze_keys on public.agent_runs;
create trigger agent_runs_freeze_keys
  before update on public.agent_runs
  for each row execute function public.freeze_agent_run_keys();

-- =============================================================================
-- 4. agent_run_steps — o passo a passo de cada execução
-- =============================================================================
-- Esta tabela é SÓ DE ACRÉSCIMO ("append-only"): grava e nunca mais muda. Um
-- rastro que pode ser editado depois não serve como rastro. Por isso não tem
-- policy de UPDATE **e** a permissão de UPDATE é tirada logo abaixo — as duas
-- coisas, porque uma sozinha não fecha a porta.
create table if not exists public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Ordem do passo dentro da execução (0, 1, 2...).
  seq integer not null,
  kind public.agent_step_kind not null,
  -- Preenchido só quando kind = 'tool'.
  tool_name text,
  input jsonb,
  output jsonb,
  -- JÁ em português claro, igual em agent_runs.
  error_message text,
  duration_ms integer,
  tokens_input integer,
  tokens_output integer,
  -- Micro-dólares. NULO = preço desconhecido (não é zero!).
  cost_micros bigint,
  created_at timestamptz not null default now(),
  constraint agent_run_steps_seq_nonneg check (seq >= 0),
  constraint agent_run_steps_tool_name_len
    check (tool_name is null or char_length(tool_name) between 1 and 64),
  constraint agent_run_steps_duration_nonneg
    check (duration_ms is null or duration_ms >= 0),
  constraint agent_run_steps_tokens_nonneg
    check ((tokens_input is null or tokens_input >= 0)
       and (tokens_output is null or tokens_output >= 0)),
  constraint agent_run_steps_cost_nonneg
    check (cost_micros is null or cost_micros >= 0)
);

comment on table public.agent_run_steps is
  'Rastro passo a passo de uma execução. Só de acréscimo: grava e nunca mais muda.';
comment on column public.agent_run_steps.seq is
  'Ordem do passo. Com ferramentas em paralelo, o número continua único, mas não representa ordem no relógio.';
comment on column public.agent_run_steps.cost_micros is
  'Custo do passo em micro-dólares, congelado na hora. NULO = preço desconhecido; 0 = custou zero mesmo.';

create unique index if not exists agent_run_steps_run_seq_key
  on public.agent_run_steps (run_id, seq);

create index if not exists agent_run_steps_run_seq_idx
  on public.agent_run_steps (run_id, seq asc);

create index if not exists agent_run_steps_org_created_idx
  on public.agent_run_steps (organization_id, created_at desc);

-- Repare no que NÃO tem aqui: UPDATE. A migration
-- 20260820000000_table_grants concede UPDATE por padrão a toda tabela nova, e
-- o `revoke all` abaixo tira isso de volta (junto com o TRUNCATE que ignora a
-- RLS). Rastro não se reescreve — nem por policy, nem por permissão.
revoke all on public.agent_run_steps from anon, authenticated;
grant select, insert, delete on public.agent_run_steps to authenticated;
grant select, insert, delete on public.agent_run_steps to service_role;

alter table public.agent_run_steps enable row level security;

drop policy if exists "members read run steps" on public.agent_run_steps;
create policy "members read run steps"
  on public.agent_run_steps for select
  using (public.is_org_member(organization_id));

drop policy if exists "members insert run steps" on public.agent_run_steps;
create policy "members insert run steps"
  on public.agent_run_steps for insert
  with check (
    public.is_org_member(organization_id)
    and exists (
      select 1
        from public.agent_runs r
       where r.id = agent_run_steps.run_id
         and r.organization_id = agent_run_steps.organization_id
    )
  );

-- Sem policy de UPDATE, de propósito (ver comentário no topo da tabela).

drop policy if exists "admins delete run steps" on public.agent_run_steps;
create policy "admins delete run steps"
  on public.agent_run_steps for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Avisa o PostgREST (a API do Supabase) que o desenho do banco mudou.
notify pgrst, 'reload schema';
