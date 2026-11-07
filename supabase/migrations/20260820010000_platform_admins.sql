-- =============================================================================
-- Dono da plataforma (quem cadastra as chaves que valem pro app inteiro)
-- =============================================================================
-- O QUE ISSO RESOLVE
-- O app passa a guardar chaves de API (OpenRouter, Anthropic, OpenAI, Google,
-- Resend) dentro do banco, em dois níveis: a chave da PLATAFORMA (vale pra
-- todos os workspaces) e a chave do WORKSPACE (vale só pra ele). Quem mexe na
-- chave da plataforma precisa ser um papel novo — "dono da plataforma" — que
-- até hoje não existia neste projeto.
--
-- COMO ALGUÉM VIRA DONO
--  1. Banco novo: a PRIMEIRA pessoa que se cadastrar vira dona automaticamente.
--  2. Banco que já tinha gente antes desta atualização: a conta MAIS ANTIGA
--     vira dona (é o "backfill" logo abaixo).
--  3. Depois disso, ninguém é promovido sozinho. Promover é ato manual.
--
-- ⚠️ EXCEÇÃO APROVADA À REGRA "toda tabela tem organization_id"
-- Esta tabela NÃO tem `organization_id` de propósito: ela fala do app inteiro,
-- não de um workspace. Ela e `credentials` (que tem `organization_id` podendo
-- ser nulo) são as ÚNICAS duas exceções do projeto. A lista é FECHADA — se
-- você está criando uma tabela de domínio, ela TEM `organization_id not null`.
--
-- =============================================================================
-- 🔓 SE VOCÊ SE TRANCOU PRA FORA (apagou a própria conta e ficou sem dono)
-- =============================================================================
-- Não existe tela pra isso no bloco 1, de propósito: promover alguém pela tela
-- seria uma porta de escalada de privilégio. A saída é o SQL Editor do
-- Supabase (supabase.com → seu projeto → SQL Editor), onde você entra como
-- dono do banco:
--
--   select public.add_platform_admin('seu-email@exemplo.com');
--
-- E pra tirar alguém (não deixa remover o último dono):
--
--   select public.remove_platform_admin('00000000-0000-0000-0000-000000000000');
--
-- Ver quem é dono hoje:
--
--   select pa.user_id, p.full_name, pa.created_at
--     from public.platform_admins pa
--     left join public.profiles p on p.id = pa.user_id
--    order by pa.created_at;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela
-- -----------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Donos da plataforma: quem pode cadastrar as chaves de API que valem pro app inteiro. Sem organization_id de propósito (exceção aprovada, ver cabeçalho da migration).';
comment on column public.platform_admins.user_id is
  'Conta que é dona da plataforma. Apagou a conta, sai da lista (cascade).';

-- FK extra pra tela conseguir puxar o nome do perfil junto.
-- A FK principal aponta pra auth.users, e o PostgREST não navega até lá.
-- (Mesmo truque de memberships_user_profile_fkey.)
do $$
begin
  alter table public.platform_admins
    add constraint platform_admins_user_profile_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;
exception
  when duplicate_object then null;
  when duplicate_table then null;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Permissões de mesa
-- -----------------------------------------------------------------------------
-- ⚠️ CRÍTICO: a migration 20260820000000_table_grants dá select/insert/update/
-- delete pra `authenticated` em TODA tabela nova. Numa tabela que define QUEM
-- MANDA, isso seria escalada de privilégio na veia (qualquer pessoa logada se
-- adicionaria na lista). Então aqui a gente tira tudo e devolve só a leitura.
revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;
grant select, insert, update, delete on public.platform_admins to service_role;

-- -----------------------------------------------------------------------------
-- 3. Helper de RLS (vem ANTES da policy: a policy chama esta função)
-- -----------------------------------------------------------------------------
-- `set row_security = off` é OBRIGATÓRIO: a policy de select em
-- platform_admins chama esta função, e a função consulta platform_admins. Sem
-- desligar a RLS por dentro, isso vira recursão infinita (54001).
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

comment on function public.is_platform_admin() is
  'Diz se quem está logado é dono da plataforma. Usada nas policies e pelos guards do app.';

revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. RLS — só ENABLE (nunca FORCE, ver regra 2 do CLAUDE.md)
-- -----------------------------------------------------------------------------
alter table public.platform_admins enable row level security;

-- Postgres não tem "create policy if not exists": derruba antes de criar, pra
-- a migration poder rodar duas vezes.
drop policy if exists "platform admins read the list" on public.platform_admins;
create policy "platform admins read the list"
  on public.platform_admins for select
  using (public.is_platform_admin());

-- Sem policy de insert/update/delete de propósito: entrar e sair da lista é
-- ato manual no SQL Editor, pelas funções add_platform_admin /
-- remove_platform_admin.

-- -----------------------------------------------------------------------------
-- 5. Backfill — banco que já tinha gente antes desta atualização
-- -----------------------------------------------------------------------------
-- Se ninguém é dono ainda e já existem contas, a MAIS ANTIGA vira dona.
-- Roda duas vezes sem efeito: na segunda a lista já não está vazia.
insert into public.platform_admins (user_id)
select u.id
  from auth.users u
 where not exists (select 1 from public.platform_admins)
 order by u.created_at asc, u.id asc
 limit 1
on conflict (user_id) do nothing;

-- -----------------------------------------------------------------------------
-- 6. Trigger — banco novo: o primeiro cadastro vira dono
-- -----------------------------------------------------------------------------
-- pg_advisory_xact_lock serializa dois cadastros que aconteçam no mesmo
-- instante: sem ele, os dois leriam "lista vazia" ao mesmo tempo e os dois
-- virariam donos.
--
-- A segunda trava (`só promove se esta ainda for a única conta do app`) é o
-- que impede escalada de privilégio: se o dono apagar a própria conta depois,
-- o próximo cadastro NÃO herda a plataforma — ele teria virado dono só por ter
-- chegado na hora certa. A saída, nesse caso, é o add_platform_admin lá em cima.
create or replace function public.claim_platform_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.platform_admins:bootstrap'));

  if exists (select 1 from public.platform_admins) then
    return new;
  end if;

  if exists (select 1 from auth.users u where u.id <> new.id) then
    return new;
  end if;

  insert into public.platform_admins (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.claim_platform_ownership() is
  'Trigger de cadastro: em banco novo, a primeira conta criada vira dona da plataforma.';

revoke execute on function public.claim_platform_ownership() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_platform_owner on auth.users;
create trigger on_auth_user_created_platform_owner
  after insert on auth.users
  for each row execute function public.claim_platform_ownership();

-- -----------------------------------------------------------------------------
-- 7. Funções de resgate (só pelo SQL Editor — ver receita no cabeçalho)
-- -----------------------------------------------------------------------------
create or replace function public.add_platform_admin(_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id
    from auth.users u
   where lower(u.email) = lower(trim(_email))
   limit 1;

  if v_user_id is null then
    raise exception 'Não existe conta cadastrada com o email %. Confira se a pessoa já criou a conta no app.', _email;
  end if;

  insert into public.platform_admins (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  return v_user_id;
end;
$$;

comment on function public.add_platform_admin(text) is
  'Resgate manual: transforma a conta desse email em dona da plataforma. Só roda pelo SQL Editor.';

revoke execute on function public.add_platform_admin(text) from public, anon, authenticated;

create or replace function public.remove_platform_admin(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.platform_admins:bootstrap'));

  select count(*) into v_total from public.platform_admins;

  if v_total <= 1 then
    raise exception 'Esse é o último dono da plataforma. Adicione outro antes de remover este, senão ninguém vai conseguir cadastrar chave de novo.';
  end if;

  delete from public.platform_admins where user_id = _user_id;
end;
$$;

comment on function public.remove_platform_admin(uuid) is
  'Resgate manual: tira alguém da lista de donos da plataforma. Recusa remover o último. Só roda pelo SQL Editor.';

revoke execute on function public.remove_platform_admin(uuid) from public, anon, authenticated;

-- Avisa o PostgREST (a API do Supabase) que o desenho do banco mudou.
notify pgrst, 'reload schema';
