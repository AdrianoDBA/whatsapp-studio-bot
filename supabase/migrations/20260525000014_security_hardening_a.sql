-- ============================================================================
-- ============================================================================
-- ----------------------------------------------------------------------------
-- RLS de invitations vazava todos os tokens
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated reads invitation by token" on public.invitations;

-- Permite usuário ler apenas convites endereçados ao próprio email.
-- Combinado com check do email no acceptInvitationAction, ninguém vê convites alheios.
drop policy if exists "users read invitations addressed to them" on public.invitations;
create policy "users read invitations addressed to them"
  on public.invitations for select
  to authenticated
  using (lower(email) = lower((auth.jwt() ->> 'email')));

-- ----------------------------------------------------------------------------
-- Faltava UPDATE policy em invitations (accept fica preso)
-- Permite só marcar accepted_at em convite endereçado ao próprio email.
-- ----------------------------------------------------------------------------
drop policy if exists "users mark own invitation accepted" on public.invitations;
create policy "users mark own invitation accepted"
  on public.invitations for update
  to authenticated
  using (lower(email) = lower((auth.jwt() ->> 'email')))
  with check (lower(email) = lower((auth.jwt() ->> 'email')));

-- ----------------------------------------------------------------------------
-- Admin podia se auto-promover a owner
-- ----------------------------------------------------------------------------
drop policy if exists "owners and admins update memberships" on public.memberships;

drop policy if exists "owners update any membership" on public.memberships;
create policy "owners update any membership"
  on public.memberships for update
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

-- Admin só mexe em membership que NÃO é owner, e não pode promover pra owner.
drop policy if exists "admins update non-owner memberships only" on public.memberships;
create policy "admins update non-owner memberships only"
  on public.memberships for update
  using (
    public.has_org_role(organization_id, array['admin']::public.org_role[])
    and role <> 'owner'
  )
  with check (
    public.has_org_role(organization_id, array['admin']::public.org_role[])
    and role <> 'owner'
  );

-- ----------------------------------------------------------------------------
-- Storage buckets sem size/mime limit
-- ----------------------------------------------------------------------------
update storage.buckets
set
  file_size_limit = 2 * 1024 * 1024,  -- 2MB
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'org-logos';

-- ----------------------------------------------------------------------------
-- Storage SELECT permitia listing global
-- org-logos: ler só se for membro da org
-- ----------------------------------------------------------------------------
drop policy if exists "org-logos public read" on storage.objects;
drop policy if exists "org-logos read by members" on storage.objects;
create policy "org-logos read by members"
  on storage.objects for select
  using (
    bucket_id = 'org-logos'
    and (
      public.is_org_member(((storage.foldername(name))[1])::uuid)
      or auth.role() = 'authenticated'
    )
  );

-- ----------------------------------------------------------------------------
-- organization_id e created_by eram mutáveis em tabela de domínio (template
-- propaga bug). Função genérica reutilizável — outras migrations aplicam ela
-- em cada tabela (agents, schedules, webhook_endpoints, knowledge_bases,
-- documents; ver `create trigger ..._freeze_org_and_creator` em cada uma).
--
-- ⚠️ `tasks` foi a PRIMEIRA tabela a usar esta função, mas a demo de tarefas
-- saiu do template (Onda "código é o dono"): a migration que criava
-- `public.tasks` (20260525000013) foi apagada, e o gatilho que esta migration
-- aplicava nela foi removido DAQUI por consequência — sem isso, um Supabase
-- limpo estourava em "relation public.tasks does not exist" bem aqui, e o
-- container ficava em crash-loop. Editar esta migration já aplicada é seguro:
-- `scripts/migrate.mjs` controla por versão gravada em
-- `supabase_migrations.schema_migrations`, então um banco que já rodou esta
-- migration não a re-executa. NÃO recrie o gatilho: a tabela que ele
-- protegia não existe mais em banco novo nenhum.
-- ----------------------------------------------------------------------------
create or replace function public.freeze_org_and_creator()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable (security)';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable (security)';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Org UPDATE permitia admin mudar created_by
-- ----------------------------------------------------------------------------
create or replace function public.freeze_org_creator()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'organizations.created_by is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_freeze_creator on public.organizations;
drop trigger if exists organizations_freeze_creator on public.organizations;
create trigger organizations_freeze_creator
  before update on public.organizations
  for each row execute function public.freeze_org_creator();

-- ----------------------------------------------------------------------------
-- is_org_member/has_org_role tinham EXECUTE pra PUBLIC (least privilege)
-- ----------------------------------------------------------------------------
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.has_org_role(uuid, public.org_role[]) from public, anon;
-- Mantém grant pra authenticated (RLS depende)
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- ----------------------------------------------------------------------------
-- handle_new_user trigger sanitização básica de raw_user_meta_data
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_avatar_url text;
begin
  -- Trim + cap em 100 chars; remove caracteres de controle
  v_full_name := substr(
    regexp_replace(
      coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
      '[[:cntrl:]]', '', 'g'
    ),
    1, 100
  );

  -- avatar_url só aceita https://
  v_avatar_url := new.raw_user_meta_data ->> 'avatar_url';
  if v_avatar_url is not null and v_avatar_url !~* '^https://' then
    v_avatar_url := null;
  end if;

  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, v_full_name, v_avatar_url);

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles SELECT bloqueava co-members; permite ver perfil de quem é da mesma org
-- ----------------------------------------------------------------------------
drop policy if exists "users can read own profile" on public.profiles;

drop policy if exists "users read own and co-members profiles" on public.profiles;
create policy "users read own and co-members profiles"
  on public.profiles for select
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.memberships m1
      join public.memberships m2 on m1.organization_id = m2.organization_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.id
    )
  );

-- ----------------------------------------------------------------------------
-- Row Level Security já está enabled em todas as tabelas (ver create table).
-- NÃO usar FORCE ROW LEVEL SECURITY: ele aplica RLS até pra owner (postgres),
-- o que cria recursão infinita com helpers SECURITY DEFINER tipo is_org_member
-- que consultam a própria tabela protegida.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- LOW — Partial index pra invitations ativas (performance + privacy)
-- ----------------------------------------------------------------------------
create index if not exists invitations_active_token_idx
  on public.invitations(token)
  where accepted_at is null;

