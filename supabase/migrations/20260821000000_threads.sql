-- =============================================================================
-- Conversas com o agente (onda 3): threads + thread_messages
-- =============================================================================
-- O QUE ISSO RESOLVE
-- Hoje o chat com IA some quando você recarrega a página. Aqui a conversa passa
-- a morar no banco: cada conversa é uma linha em `threads`, e cada balão de
-- mensagem é uma linha em `thread_messages`.
--
--   threads          → a conversa em si (com qual agente, quem começou, título)
--   thread_messages  → os balões, na ordem, no formato que a tela entende
--
-- ⚠️ A CONVERSA É DO WORKSPACE, NÃO DA PESSOA
-- Qualquer membro do workspace LÊ as conversas. Só quem começou ESCREVE nela.
-- Quem administra também APAGA. Isso é de propósito e a tela avisa com essas
-- palavras: `agent_runs` + `agent_run_steps` já guardam a pergunta, a resposta
-- e o que a ferramenta devolveu, e são legíveis por qualquer membro desde a
-- onda 2. Trancar a conversa deixando o rastro aberto prometeria uma
-- privacidade que o banco não entrega. Se um dia for pra fechar, fecha nos
-- DOIS lugares, na mesma migration.
--
-- ⚠️ APAGAR O AGENTE APAGA AS CONVERSAS DELE (cascade). O histórico de gasto
-- NÃO some: `agent_runs` sobrevive com o apelido do agente congelado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. De quem é cada balão da conversa
-- -----------------------------------------------------------------------------
-- Bloco condicional porque o Postgres não tem "create type if not exists".
do $$
begin
  create type public.thread_message_role as enum ('user', 'assistant', 'tool');
exception
  when duplicate_object then null;
end
$$;

-- =============================================================================
-- 2. threads — uma conversa
-- =============================================================================
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Apagou o agente, apagou as conversas dele. O gasto continua em agent_runs.
  agent_id uuid not null references public.agents(id) on delete cascade,
  -- Quem COMEÇOU a conversa. É a única pessoa que pode escrever nela.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Sai da primeira mensagem, e dá pra renomear depois. Nulo = "sem título".
  title text,
  -- Contadores mantidos pelo gatilho `touch_thread_on_message`. NINGUÉM
  -- escreve neles na mão: a permissão de UPDATE é só da coluna `title`.
  message_count integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint threads_title_len check (title is null or char_length(title) between 1 and 120),
  constraint threads_message_count_nonneg check (message_count >= 0)
);

comment on table public.threads is
  'Uma conversa entre uma pessoa e um agente. É DO WORKSPACE: todo membro lê, só quem começou escreve, quem administra apaga.';
comment on column public.threads.message_count is
  'Mantido pelo gatilho touch_thread_on_message. Pessoa logada não tem permissão de escrever aqui.';

-- FK extra pra tela conseguir puxar o nome de quem começou a conversa.
-- A FK principal aponta pra auth.users, e o PostgREST não navega até lá.
do $$
begin
  alter table public.threads
    add constraint threads_user_profile_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;
exception
  when duplicate_object then null;
  when duplicate_table then null;
end
$$;

create index if not exists threads_org_agent_updated_idx
  on public.threads (organization_id, agent_id, updated_at desc);

create index if not exists threads_org_user_updated_idx
  on public.threads (organization_id, user_id, updated_at desc);

-- Zera e devolve só o necessário. O `revoke all` não é enfeite: além do
-- select/insert/update/delete da migration 20260820000000_table_grants, o
-- próprio Supabase concede TRUNCATE a `anon` e `authenticated` em toda tabela
-- nova — e TRUNCATE **ignora a RLS**.
--
-- ⚠️ REPARE: o UPDATE é SÓ DA COLUNA `title`. Renomear a conversa é a única
-- escrita direta que existe. Se fosse `grant update` da tabela inteira, quem
-- começou a conversa poderia reescrever `message_count` e `last_message_at`
-- na mão e a listagem passaria a mentir.
revoke all on public.threads from anon, authenticated;
grant select, insert, delete on public.threads to authenticated;
grant update (title) on public.threads to authenticated;
grant select, insert, update, delete on public.threads to service_role;

-- RLS — só ENABLE (nunca FORCE, ver regra 2 do CLAUDE.md).
alter table public.threads enable row level security;

drop policy if exists "members read threads" on public.threads;
create policy "members read threads"
  on public.threads for select
  using (public.is_org_member(organization_id));

drop policy if exists "members start threads" on public.threads;
create policy "members start threads"
  on public.threads for insert
  with check (
    public.is_org_member(organization_id)
    and auth.uid() = user_id
    and exists (
      select 1
        from public.agents a
       where a.id = threads.agent_id
         and a.organization_id = threads.organization_id
    )
  );

drop policy if exists "author renames thread" on public.threads;
create policy "author renames thread"
  on public.threads for update
  using (public.is_org_member(organization_id) and auth.uid() = user_id)
  with check (public.is_org_member(organization_id) and auth.uid() = user_id);

drop policy if exists "author or admin deletes thread" on public.threads;
create policy "author or admin deletes thread"
  on public.threads for delete
  using (
    public.is_org_member(organization_id)
    and (
      auth.uid() = user_id
      or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    )
  );

-- Congela o que identifica a conversa. Sem isso, dava pra mudar a conversa de
-- workspace, de agente ou de autor depois do fato — e o histórico passaria a
-- mentir sobre quem falou com quem.
create or replace function public.freeze_thread_keys()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.agent_id is distinct from old.agent_id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'threads: id, organization_id, agent_id, user_id and created_at are immutable (security)';
  end if;
  return new;
end;
$$;

revoke execute on function public.freeze_thread_keys() from public, anon, authenticated;

drop trigger if exists threads_freeze_keys on public.threads;
create trigger threads_freeze_keys
  before update on public.threads
  for each row execute function public.freeze_thread_keys();

drop trigger if exists threads_set_updated_at on public.threads;
create trigger threads_set_updated_at
  before update on public.threads
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 3. thread_messages — os balões da conversa
-- =============================================================================
-- Esta tabela é SÓ DE ACRÉSCIMO, igual `agent_run_steps`: grava e nunca mais
-- muda. Por isso não tem policy de UPDATE **e** a permissão de UPDATE é tirada
-- logo abaixo — as duas coisas, porque uma sozinha não fecha a porta.
--
-- `parts` guarda a mensagem no formato UIMessage do AI SDK (a lista de pedaços:
-- texto, chamada de ferramenta, resultado). É o mesmo formato que a tela
-- consome, então não existe tradução no meio do caminho.
create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  -- A ORDEM DA CONVERSA SAI DAQUI, não do relógio: duas mensagens gravadas na
  -- mesma transação teriam o mesmo `created_at`, e aí a conversa embaralha.
  -- `generated always` = ninguém consegue escolher o número na mão.
  seq bigint generated always as identity,
  thread_id uuid not null references public.threads(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.thread_message_role not null,
  parts jsonb not null,
  -- A execução do agente que produziu esta resposta (nulo na fala da pessoa).
  run_id uuid references public.agent_runs(id) on delete set null,
  -- Modelo, tokens, custo e situação daquela resposta. Formato:
  -- ChatMessageMetadata, em lib/threads/types.ts.
  metadata jsonb,
  created_at timestamptz not null default now(),
  -- Rede de segurança: o teto de verdade (60 mil caracteres) é conferido em
  -- TypeScript antes de chegar aqui. Isto aqui só impede mensagem absurda.
  constraint thread_messages_parts_len check (char_length(parts::text) <= 200000),
  constraint thread_messages_parts_is_array check (jsonb_typeof(parts) = 'array')
);

comment on table public.thread_messages is
  'Os balões de uma conversa, no formato UIMessage do AI SDK. Só de acréscimo: grava e nunca mais muda.';
comment on column public.thread_messages.seq is
  'A ordem da conversa. Use SEMPRE isto pra ordenar, nunca created_at (duas mensagens da mesma transação empatam no relógio).';

create index if not exists thread_messages_thread_seq_idx
  on public.thread_messages (thread_id, seq asc);

create index if not exists thread_messages_org_created_idx
  on public.thread_messages (organization_id, created_at desc);

-- Repare no que NÃO tem aqui: UPDATE. Balão de conversa não se reescreve.
revoke all on public.thread_messages from anon, authenticated;
grant select, insert, delete on public.thread_messages to authenticated;
grant select, insert, update, delete on public.thread_messages to service_role;

alter table public.thread_messages enable row level security;

drop policy if exists "members read thread messages" on public.thread_messages;
create policy "members read thread messages"
  on public.thread_messages for select
  using (public.is_org_member(organization_id));

-- Só quem COMEÇOU a conversa escreve nela (tanto a pergunta quanto a resposta
-- do agente, que é gravada pela mesma sessão).
drop policy if exists "thread author appends messages" on public.thread_messages;
create policy "thread author appends messages"
  on public.thread_messages for insert
  with check (
    public.is_org_member(organization_id)
    and exists (
      select 1
        from public.threads t
       where t.id = thread_messages.thread_id
         and t.organization_id = thread_messages.organization_id
         and t.user_id = auth.uid()
    )
  );

-- Sem policy de UPDATE, de propósito (ver comentário no topo da tabela).

drop policy if exists "author or admin deletes thread messages" on public.thread_messages;
create policy "author or admin deletes thread messages"
  on public.thread_messages for delete
  using (
    public.is_org_member(organization_id)
    and (
      exists (
        select 1
          from public.threads t
         where t.id = thread_messages.thread_id
           and t.user_id = auth.uid()
      )
      or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    )
  );

-- Mantém o resumo da conversa em dia (quantos balões, quando foi o último).
--
-- `security definer` + `row_security = off` porque quem está logado NÃO tem
-- permissão de escrever nessas colunas — e é justamente esse o ponto: o número
-- vem do gatilho, não da boa vontade de quem chamou.
create or replace function public.touch_thread_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  update public.threads
     set message_count = message_count + 1,
         last_message_at = new.created_at,
         updated_at = now()
   where id = new.thread_id;
  return new;
end;
$$;

revoke execute on function public.touch_thread_on_message() from public, anon, authenticated;

drop trigger if exists thread_messages_touch_thread on public.thread_messages;
create trigger thread_messages_touch_thread
  after insert on public.thread_messages
  for each row execute function public.touch_thread_on_message();

-- =============================================================================
-- 4. agent_runs ganha a conversa dona da execução
-- =============================================================================
-- Assim a bolha da resposta consegue linkar direto pro rastro completo, e a
-- tela de execuções consegue mostrar "veio da conversa X".
alter table public.agent_runs
  add column if not exists thread_id uuid references public.threads(id) on delete set null;

comment on column public.agent_runs.thread_id is
  'A conversa dona desta execução. Nulo quando o gatilho não foi o chat (botão, agendamento, webhook).';

create index if not exists agent_runs_thread_created_idx
  on public.agent_runs (thread_id, created_at desc);

-- Avisa o PostgREST (a API do Supabase) que o desenho do banco mudou.
notify pgrst, 'reload schema';
