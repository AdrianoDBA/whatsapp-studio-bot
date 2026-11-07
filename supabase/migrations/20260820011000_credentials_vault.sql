-- =============================================================================
-- Cofre de chaves de API (OpenRouter, Anthropic, OpenAI, Google, Resend)
-- =============================================================================
-- O QUE ISSO RESOLVE
-- Hoje a chave da IA mora numa variável de ambiente, e trocar de chave exige
-- mexer no painel do EasyPanel e subir o app de novo. A partir daqui a chave
-- passa a morar no banco, cadastrada por uma tela, em dois níveis:
--
--   • chave da PLATAFORMA  → organization_id NULO  → vale pra todo mundo
--   • chave do WORKSPACE   → organization_id certo → vale só pra aquele time
--
-- A ordem de uso é sempre: workspace → plataforma → variável de ambiente.
--
-- ⚠️ EXCEÇÃO APROVADA À REGRA "toda tabela tem organization_id NOT NULL"
-- Aqui `organization_id` pode ser nulo, e nulo QUER DIZER "é da plataforma".
-- Esta tabela e `platform_admins` são as ÚNICAS duas exceções do projeto. A
-- lista é FECHADA: se você está criando uma tabela de domínio, ela tem
-- `organization_id not null`.
--
-- =============================================================================
-- 🔒 COMO O SEGREDO FICA GUARDADO
-- =============================================================================
-- A chave NUNCA é gravada em texto puro. O app cifra (AES-256-GCM) usando a
-- ENCRYPTION_KEY, que mora FORA do banco (é variável de ambiente). O que fica
-- na coluna `ciphertext` é um embrulho fechado — sem a ENCRYPTION_KEY ele não
-- abre. Por isso:
--
--   • perder a ENCRYPTION_KEY = perder todas as chaves cadastradas (é só
--     recadastrar, mas ninguém "recupera" as antigas);
--   • `key_version` já existe desde o dia 1 pra permitir trocar a receita de
--     criptografia no futuro sem precisar de outra migration.
--
-- =============================================================================
-- ⚠️ ARMADILHA DAS PERMISSÕES POR COLUNA — LEIA ANTES DE MEXER
-- =============================================================================
-- A coluna `ciphertext` é INVISÍVEL pro app: a permissão de leitura é dada
-- coluna a coluna, e ela ficou de fora de propósito. Consequências práticas:
--
--   1. `select("*")` nesta tabela SEMPRE falha com
--      "permission denied for column ciphertext" (código 42501). É proposital.
--      Em `lib/secrets/queries.ts` a lista de colunas é sempre explícita.
--   2. Toda COLUNA NOVA que você adicionar aqui nasce invisível até você
--      acrescentar o nome dela no `grant select (...)` lá embaixo.
--
-- Quem lê o `ciphertext` é a função `resolve_credential`, que roda com os
-- poderes do dono do banco e confere quem está pedindo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Lista de provedores aceitos
-- -----------------------------------------------------------------------------
-- Bloco condicional porque Postgres não tem "create type if not exists".
do $$
begin
  create type public.credential_provider as enum (
    'openrouter',
    'anthropic',
    'openai',
    'google',
    'resend'
  );
exception
  when duplicate_object then null;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Tabela
-- -----------------------------------------------------------------------------
create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  -- NULO = chave da plataforma (vale pro app inteiro).
  organization_id uuid references public.organizations(id) on delete cascade,
  provider public.credential_provider not null,
  -- Rótulo humano ("Chave do time de vendas"). NÃO guarda configuração.
  label text not null default '',
  -- A chave cifrada. Ninguém no app enxerga esta coluna (ver aviso no topo).
  ciphertext text not null,
  key_version integer not null default 1,
  -- Pedaços NÃO secretos guardados só pra tela poder mostrar "sk-ant-…4f2a"
  -- sem precisar abrir o embrulho.
  key_prefix text not null default '',
  last4 text not null default '',
  -- Configuração NÃO secreta do provedor. Hoje só o Resend usa: {"from": "..."}.
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credentials_key_version_positive check (key_version >= 1),
  constraint credentials_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  constraint credentials_label_len check (char_length(label) <= 120),
  constraint credentials_key_prefix_len check (char_length(key_prefix) <= 16),
  constraint credentials_last4_len check (char_length(last4) <= 8),
  constraint credentials_ciphertext_len check (char_length(ciphertext) between 1 and 8000)
);

comment on table public.credentials is
  'Cofre de chaves de API. organization_id nulo = chave da plataforma (exceção aprovada, ver cabeçalho da migration).';
comment on column public.credentials.ciphertext is
  'Chave cifrada com AES-256-GCM. Invisível pro app: fora do grant de leitura por coluna, de propósito.';
comment on column public.credentials.key_prefix is
  'Começo da chave ("sk-ant-"), só pra tela mostrar a versão mascarada. Não é segredo.';
comment on column public.credentials.last4 is
  'Últimos 4 caracteres da chave, só pra tela mostrar a versão mascarada. Não é segredo.';
comment on column public.credentials.metadata is
  'Configuração não secreta do provedor. Hoje só o Resend usa: {"from": "Meu App <noreply@..>"}.';

-- Uma chave por provedor em cada escopo. Dois índices PARCIAIS porque, em
-- Postgres, `unique (organization_id, provider)` não impediria duas linhas de
-- plataforma (nulo nunca é igual a nulo num índice único comum).
create unique index if not exists credentials_platform_provider_key
  on public.credentials (provider)
  where organization_id is null;

create unique index if not exists credentials_org_provider_key
  on public.credentials (organization_id, provider)
  where organization_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Permissões de mesa (e a permissão POR COLUNA)
-- -----------------------------------------------------------------------------
-- A migration 20260820000000_table_grants dá select/insert/update/delete pra
-- `authenticated` em toda tabela nova. Aqui a gente tira tudo e devolve só o
-- que pode: leitura das colunas não secretas + delete (apagar a chave do
-- workspace É "voltar a usar a da plataforma"). Gravar passa OBRIGATORIAMENTE
-- pela função save_credential.
revoke all on public.credentials from anon, authenticated;

grant select (
  id,
  organization_id,
  provider,
  label,
  key_version,
  key_prefix,
  last4,
  metadata,
  created_by,
  created_at,
  updated_at
) on public.credentials to authenticated;

grant delete on public.credentials to authenticated;
grant select, insert, update, delete on public.credentials to service_role;

-- -----------------------------------------------------------------------------
-- 4. Quem pode mexer numa credencial
-- -----------------------------------------------------------------------------
-- Chave da plataforma → dono da plataforma.
-- Chave do workspace  → owner/admin daquele workspace.
create or replace function public.can_manage_credential(_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
  select case
    when _org_id is null then public.is_platform_admin()
    else public.has_org_role(_org_id, array['owner', 'admin']::public.org_role[])
  end;
$$;

comment on function public.can_manage_credential(uuid) is
  'Diz se quem está logado pode cadastrar/apagar a chave desse escopo (nulo = plataforma).';

revoke execute on function public.can_manage_credential(uuid) from public, anon;
grant execute on function public.can_manage_credential(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. RLS — só ENABLE (nunca FORCE, ver regra 2 do CLAUDE.md)
-- -----------------------------------------------------------------------------
alter table public.credentials enable row level security;

-- Nunca apague a policy de SELECT sem substituir: sem leitura, gravar e pedir
-- o dado de volta na mesma operação passa a falhar (regra 10 do CLAUDE.md).
drop policy if exists "managers read credentials" on public.credentials;
create policy "managers read credentials"
  on public.credentials for select
  using (public.can_manage_credential(organization_id));

drop policy if exists "managers insert credentials" on public.credentials;
create policy "managers insert credentials"
  on public.credentials for insert
  with check (public.can_manage_credential(organization_id) and auth.uid() = created_by);

drop policy if exists "managers update credentials" on public.credentials;
create policy "managers update credentials"
  on public.credentials for update
  using (public.can_manage_credential(organization_id))
  with check (public.can_manage_credential(organization_id));

drop policy if exists "managers delete credentials" on public.credentials;
create policy "managers delete credentials"
  on public.credentials for delete
  using (public.can_manage_credential(organization_id));

-- -----------------------------------------------------------------------------
-- 6. Triggers
-- -----------------------------------------------------------------------------
drop trigger if exists credentials_set_updated_at on public.credentials;
create trigger credentials_set_updated_at
  before update on public.credentials
  for each row execute function public.set_updated_at();

-- Congela o que identifica a linha. Sem isso, quem pode editar a chave do
-- próprio workspace poderia mudar `organization_id` e sequestrar a linha da
-- plataforma (ou de outro time).
create or replace function public.freeze_credential_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.provider is distinct from old.provider
     or new.created_at is distinct from old.created_at then
    raise exception 'credentials: id, organization_id, provider and created_at are immutable (security)';
  end if;

  if new.created_by is distinct from old.created_by then
    -- Único caso aceito: a conta que criou foi apagada e o banco zerou a
    -- coluna sozinho (on delete set null).
    if new.created_by is null
       and old.created_by is not null
       and not exists (select 1 from auth.users where id = old.created_by) then
      return new;
    end if;
    raise exception 'credentials.created_by is immutable (security)';
  end if;

  return new;
end;
$$;

revoke execute on function public.freeze_credential_fields() from public, anon, authenticated;

drop trigger if exists credentials_freeze_fields on public.credentials;
create trigger credentials_freeze_fields
  before update on public.credentials
  for each row execute function public.freeze_credential_fields();

-- -----------------------------------------------------------------------------
-- 7. Gravar uma chave (única porta de escrita)
-- -----------------------------------------------------------------------------
-- Já existe chave desse provedor nesse escopo? Substitui. Não existe? Cria.
-- O app manda o texto JÁ CIFRADO — esta função nunca vê a chave em texto puro.
--
-- ⚠️ POR QUE `_organization_id` É O ÚLTIMO E TEM VALOR PADRÃO
-- Nulo aqui quer dizer "chave da plataforma". Só que o gerador de tipos do
-- Supabase (`npm run types`) não sabe quais argumentos aceitam nulo: ele
-- escreve TODOS como obrigatórios. Com valor padrão, ele escreve o argumento
-- como OPCIONAL — e aí o TypeScript aceita o escopo da plataforma sem
-- ninguém precisar mentir pro compilador. Em Postgres, todo argumento depois
-- de um com padrão também precisa ter padrão, por isso ele foi pro fim.
-- Quem chama usa argumentos por nome, então a ordem não muda nada no app.
create or replace function public.save_credential(
  _provider public.credential_provider,
  _ciphertext text,
  _key_version integer,
  _key_prefix text,
  _last4 text,
  _label text default '',
  _metadata jsonb default '{}'::jsonb,
  _organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.can_manage_credential(_organization_id) then
    raise exception 'not allowed to manage credentials for this scope';
  end if;

  if _ciphertext is null or char_length(_ciphertext) = 0 then
    raise exception 'ciphertext is required';
  end if;

  update public.credentials
     set ciphertext = _ciphertext,
         key_version = coalesce(_key_version, 1),
         key_prefix = coalesce(_key_prefix, ''),
         last4 = coalesce(_last4, ''),
         label = coalesce(_label, ''),
         metadata = coalesce(_metadata, '{}'::jsonb)
   where provider = _provider
     and organization_id is not distinct from _organization_id
  returning id into v_id;

  if v_id is null then
    begin
      insert into public.credentials (
        organization_id, provider, ciphertext, key_version,
        key_prefix, last4, label, metadata, created_by
      )
      values (
        _organization_id, _provider, _ciphertext, coalesce(_key_version, 1),
        coalesce(_key_prefix, ''), coalesce(_last4, ''), coalesce(_label, ''),
        coalesce(_metadata, '{}'::jsonb), auth.uid()
      )
      returning id into v_id;
    exception when unique_violation then
      -- Duas telas salvando ao mesmo tempo: a outra ganhou a corrida, então
      -- esta vira uma atualização.
      update public.credentials
         set ciphertext = _ciphertext,
             key_version = coalesce(_key_version, 1),
             key_prefix = coalesce(_key_prefix, ''),
             last4 = coalesce(_last4, ''),
             label = coalesce(_label, ''),
             metadata = coalesce(_metadata, '{}'::jsonb)
       where provider = _provider
         and organization_id is not distinct from _organization_id
      returning id into v_id;
    end;
  end if;

  return v_id;
end;
$$;

comment on function public.save_credential(public.credential_provider, text, integer, text, text, text, jsonb, uuid) is
  'Grava (ou substitui) a chave cifrada de um provedor. Confere quem está pedindo antes.';

revoke execute on function public.save_credential(public.credential_provider, text, integer, text, text, text, jsonb, uuid)
  from public, anon;
grant execute on function public.save_credential(public.credential_provider, text, integer, text, text, text, jsonb, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Buscar a chave pra USAR (workspace → plataforma)
-- -----------------------------------------------------------------------------
-- Devolve o embrulho cifrado; quem abre é o servidor do app, com a
-- ENCRYPTION_KEY. Sem linha nenhuma, devolve zero linhas (aí o app cai pra
-- variável de ambiente).
--
-- ⚠️ DÍVIDA CONHECIDA (RESÍDUO-1 do contrato do bloco 1): o app se conecta ao
-- banco como `authenticated`, então tudo que o servidor chama, a pessoa logada
-- também consegue chamar — inclusive esta função, que devolve o embrulho
-- cifrado da plataforma. O embrulho sozinho não abre sem a ENCRYPTION_KEY (e o
-- AAD amarra a cifra ao escopo + provedor), mas isso é mitigação, não muro. Na
-- onda 4, quando o trabalhador abrir conexão direta com o banco, o certo é
-- `revoke execute on function public.resolve_credential(uuid, public.credential_provider)
--  from authenticated`.
--
-- Os dois argumentos têm valor padrão pelo mesmo motivo explicado em
-- save_credential (nulo em `_organization_id` significa "a chave da
-- plataforma", e o gerador de tipos precisa do padrão pra escrever o
-- argumento como opcional). A ORDEM aqui é fixa de propósito: a assinatura
-- `(uuid, credential_provider)` é a que o contrato do bloco 1 cita no plano
-- de fechar esta porta na onda 4.
create or replace function public.resolve_credential(
  _organization_id uuid default null,
  _provider public.credential_provider default null
)
returns table (
  credential_id uuid,
  organization_id uuid,
  ciphertext text,
  key_version integer,
  metadata jsonb,
  source text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if _provider is null then
    raise exception 'provider is required';
  end if;

  -- Pedir a chave de um workspace exige ser membro dele.
  if _organization_id is not null and not public.is_org_member(_organization_id) then
    raise exception 'not a member of this organization';
  end if;

  return query
  select c.id, c.organization_id, c.ciphertext, c.key_version, c.metadata,
         (case when c.organization_id is null then 'platform' else 'workspace' end)::text
    from public.credentials c
   where c.provider = _provider
     and (c.organization_id is null
          or (_organization_id is not null and c.organization_id = _organization_id))
   -- Workspace ganha da plataforma.
   order by (c.organization_id is null)
   limit 1;
end;
$$;

comment on function public.resolve_credential(uuid, public.credential_provider) is
  'Devolve a chave cifrada que vale pra esse workspace (a dele, senão a da plataforma). Nunca devolve texto puro.';

revoke execute on function public.resolve_credential(uuid, public.credential_provider) from public, anon;
grant execute on function public.resolve_credential(uuid, public.credential_provider) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. "Tem chave? De onde ela viria?" — sem devolver segredo nenhum
-- -----------------------------------------------------------------------------
-- Uma chamada só responde pelos 5 provedores. É o que a tela usa pra escrever
-- "usando a chave da plataforma" ou "usando a chave deste workspace".
-- `_organization_id` tem valor padrão pelo mesmo motivo de save_credential:
-- nulo = ponto de vista da plataforma, e o gerador de tipos só escreve o
-- argumento como opcional quando ele tem padrão.
create or replace function public.credential_status(_organization_id uuid default null)
returns table (
  provider public.credential_provider,
  source text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if _organization_id is not null and not public.is_org_member(_organization_id) then
    raise exception 'not a member of this organization';
  end if;

  return query
  select c.provider,
         (case
           when bool_or(c.organization_id is not null) then 'workspace'
           else 'platform'
         end)::text
    from public.credentials c
   where c.organization_id is null
      or (_organization_id is not null and c.organization_id = _organization_id)
   group by c.provider;
end;
$$;

comment on function public.credential_status(uuid) is
  'Diz, por provedor, de onde a chave sairia hoje (workspace ou plataforma). Não devolve segredo.';

revoke execute on function public.credential_status(uuid) from public, anon;
grant execute on function public.credential_status(uuid) to authenticated;

-- Avisa o PostgREST (a API do Supabase) que o desenho do banco mudou.
notify pgrst, 'reload schema';
