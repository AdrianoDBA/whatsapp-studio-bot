-- =============================================================================
-- WhatsApp & Conexão de Celular por Organização (Multi-Tenant)
-- =============================================================================
-- Permite que cada usuário/workspace associe o número de telefone da sua empresa
-- ao agente de atendimento, com suporte a conexão por QR Code (Baileys) ou
-- Meta Cloud API oficial.
-- =============================================================================

create table if not exists public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_number text,
  instance_name text default 'Principal',
  provider text not null default 'baileys',
  status text not null default 'disconnected',
  qr_code text,
  cloud_phone_number_id text,
  cloud_waba_id text,
  cloud_access_token text,
  connected_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_instances_org_uniq unique (organization_id),
  constraint whatsapp_instances_provider_check check (provider in ('baileys', 'cloud_api')),
  constraint whatsapp_instances_status_check check (status in ('disconnected', 'connecting', 'connected', 'qr_ready'))
);

comment on table public.whatsapp_instances is
  'Instância de conexão WhatsApp/Celular associada a uma organização específica.';

create index if not exists whatsapp_instances_org_idx
  on public.whatsapp_instances (organization_id);

create index if not exists whatsapp_instances_phone_idx
  on public.whatsapp_instances (phone_number);

revoke all on public.whatsapp_instances from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_instances to authenticated;
grant select, insert, update, delete on public.whatsapp_instances to service_role;

alter table public.whatsapp_instances enable row level security;

drop policy if exists "members read whatsapp instances" on public.whatsapp_instances;
create policy "members read whatsapp instances"
  on public.whatsapp_instances for select
  using (public.is_org_member(organization_id));

drop policy if exists "admins manage whatsapp instances" on public.whatsapp_instances;
create policy "admins manage whatsapp instances"
  on public.whatsapp_instances for all
  using (public.has_org_role(organization_id, 'admin') or public.has_org_role(organization_id, 'owner'))
  with check (public.has_org_role(organization_id, 'admin') or public.has_org_role(organization_id, 'owner'));
