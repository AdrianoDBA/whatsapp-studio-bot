-- Bloco condicional porque Postgres não tem "create type if not exists", e
-- toda migration daqui tem que aguentar rodar duas vezes (regra 9).
do $$
begin
  create type public.org_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null;
end $$;

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists memberships_user_id_idx on public.memberships(user_id);
create index if not exists memberships_org_id_idx on public.memberships(organization_id);

alter table public.memberships enable row level security;
-- Policies em 20260525000006
