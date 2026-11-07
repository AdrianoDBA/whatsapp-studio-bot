-- =============================================================================
-- Base de conhecimento (onda 5): documentos que o agente sabe consultar
-- =============================================================================
-- O QUE ISSO RESOLVE
-- O agente só sabe o que está no prompt dele. Aqui ele passa a poder CONSULTAR
-- os seus arquivos: você sobe um PDF, um .txt, um .csv (ou cola um texto), o
-- sistema quebra aquilo em pedaços, transforma cada pedaço num monte de números
-- que representa o SIGNIFICADO do trecho, e guarda. Na hora da pergunta, ele
-- procura os pedaços mais parecidos com a pergunta e entrega pro modelo.
--
-- Esse "monte de números" chama embedding, e o `pgvector` é a extensão do
-- Postgres que sabe comparar dois deles rápido.
--
-- São três tabelas:
--
--   knowledge_bases  → a "pasta" ("Manual do produto", "Políticas do RH")
--   documents        → cada arquivo ou texto colado dentro da pasta
--   document_chunks  → os pedaços, com o embedding de cada um
--
-- ⚠️ A DIMENSÃO É FIXA EM 1536 (`text-embedding-3-small`).
-- Está no TIPO da coluna, não numa configuração. Trocar de modelo de embedding
-- exigiria re-indexar TUDO, então o modelo é escolhido na CRIAÇÃO da base e
-- congelado por gatilho. Pra trocar de modelo: crie outra base e suba os
-- arquivos de novo. Isso é documentado, não escondido.
--
-- ⚠️ CONTEÚDO RECUPERADO É DADO, NUNCA INSTRUÇÃO.
-- O que sai daqui vai pro modelo marcado como dado, junto com o rodapé
-- anti-injeção de lib/agents/prompt.ts. Um PDF com "ignore suas instruções"
-- escrito dentro é um risco conhecido e mitigado, não resolvido.
-- =============================================================================

-- ⚠️ NÃO QUALIFIQUE O TIPO `vector`. Escrever `extensions.vector(1536)` quebra
-- em metade dos bancos: `create extension if not exists` IGNORA o `with schema`
-- quando a extensão já existe, então num banco onde o aluno ligou o pgvector
-- pelo painel (ou onde ele já mora em `public`) o nome qualificado não existe,
-- a migration falha e O CONTAINER NÃO SOBE. A saída é resolver por
-- `search_path`, aqui e dentro de cada função.
--
-- Isto funciona porque `scripts/migrate.mjs` roda cada arquivo dentro de uma
-- transação só.
set local search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. A extensão pgvector
-- -----------------------------------------------------------------------------
-- Instala em `extensions` quando esse schema existe (é a convenção do Supabase)
-- e em `public` quando não existe. Nos dois casos o `search_path` acima resolve.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension vector with schema extensions';
    else
      execute 'create extension vector';
    end if;
  end if;
exception
  when insufficient_privilege then
    raise exception 'Não deu pra ligar a extensão pgvector neste banco. No painel do Supabase: Database → Extensions → ligue "vector" e rode o deploy de novo.';
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Listas fixas de valores
-- -----------------------------------------------------------------------------
do $$
begin
  create type public.document_source_kind as enum ('upload', 'text', 'url');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.document_status as enum ('pending', 'processing', 'ready', 'failed');
exception
  when duplicate_object then null;
end
$$;

-- =============================================================================
-- 3. knowledge_bases — a pasta
-- =============================================================================
create table if not exists public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Vira endereço na barra do navegador (/conhecimento/manual-do-produto).
  -- Congelado por gatilho, igual ao apelido do agente.
  slug text not null,
  name text not null,
  description text,
  -- "provedor:modelo". Escolhido na CRIAÇÃO e congelado: misturar vetores de
  -- dois modelos na mesma base devolve resultado sem sentido.
  embedding_model text not null default 'openai:text-embedding-3-small',
  embedding_dimensions integer not null default 1536,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_bases_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  constraint knowledge_bases_name_len check (char_length(name) between 2 and 80),
  constraint knowledge_bases_description_len
    check (description is null or char_length(description) <= 300),
  constraint knowledge_bases_model_len check (char_length(embedding_model) between 3 and 120),
  -- 1536 é o tipo da coluna `document_chunks.embedding`. Não é configuração.
  constraint knowledge_bases_dimensions_check check (embedding_dimensions = 1536)
);

comment on table public.knowledge_bases is
  'Uma "pasta" de conhecimento do workspace. O modelo de embedding é escolhido na criação e congelado.';
comment on column public.knowledge_bases.embedding_model is
  'Congelado pelo gatilho freeze_knowledge_base_slug. Pra trocar de modelo, crie outra base e suba os arquivos de novo.';

create unique index if not exists knowledge_bases_org_slug_key
  on public.knowledge_bases (organization_id, slug);

create index if not exists knowledge_bases_org_updated_idx
  on public.knowledge_bases (organization_id, updated_at desc);

-- Zera e devolve só o necessário. O `revoke all` fecha também o TRUNCATE que o
-- Supabase concede sozinho — e TRUNCATE ignora a RLS.
revoke all on public.knowledge_bases from anon, authenticated;
grant select, insert, update, delete on public.knowledge_bases to authenticated;
grant select, insert, update, delete on public.knowledge_bases to service_role;

-- RLS — só ENABLE (nunca FORCE, ver regra 2 do CLAUDE.md).
alter table public.knowledge_bases enable row level security;

drop policy if exists "members read knowledge bases" on public.knowledge_bases;
create policy "members read knowledge bases"
  on public.knowledge_bases for select
  using (public.is_org_member(organization_id));

drop policy if exists "admins create knowledge bases" on public.knowledge_bases;
create policy "admins create knowledge bases"
  on public.knowledge_bases for insert
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = created_by
  );

drop policy if exists "admins update knowledge bases" on public.knowledge_bases;
create policy "admins update knowledge bases"
  on public.knowledge_bases for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists "admins delete knowledge bases" on public.knowledge_bases;
create policy "admins delete knowledge bases"
  on public.knowledge_bases for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Congela o que não pode mudar depois que existe arquivo indexado.
create or replace function public.freeze_knowledge_base_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'knowledge base slug cannot be changed';
  end if;
  -- Trocar o modelo misturaria vetores de dois modelos na mesma base, e a busca
  -- passaria a devolver trecho aleatório — sem erro nenhum aparecendo.
  if new.embedding_model is distinct from old.embedding_model then
    raise exception 'knowledge base embedding model cannot be changed (create another base)';
  end if;
  if new.embedding_dimensions is distinct from old.embedding_dimensions then
    raise exception 'knowledge base embedding dimensions cannot be changed';
  end if;
  return new;
end;
$$;

revoke execute on function public.freeze_knowledge_base_slug() from public, anon, authenticated;

drop trigger if exists knowledge_bases_freeze_slug on public.knowledge_bases;
create trigger knowledge_bases_freeze_slug
  before update on public.knowledge_bases
  for each row execute function public.freeze_knowledge_base_slug();

drop trigger if exists knowledge_bases_set_updated_at on public.knowledge_bases;
create trigger knowledge_bases_set_updated_at
  before update on public.knowledge_bases
  for each row execute function public.set_updated_at();

drop trigger if exists knowledge_bases_freeze_org_and_creator on public.knowledge_bases;
create trigger knowledge_bases_freeze_org_and_creator
  before update on public.knowledge_bases
  for each row execute function public.freeze_org_and_creator();

-- =============================================================================
-- 4. documents — cada arquivo (ou texto colado) da pasta
-- =============================================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  title text not null,
  source_kind public.document_source_kind not null,
  -- Caminho no bucket `knowledge-docs`: `{org}/{base}/{documento}.{ext}`.
  -- Nulo quando o texto foi colado na tela em vez de enviado como arquivo.
  storage_path text,
  mime_type text,
  byte_size bigint,
  -- ⚠️ Situação e custo NÃO são escritos por quem está logado: não existe
  -- `grant update` nesta tabela pra `authenticated`. Quem muda são as funções
  -- `queue_document` / `start_document_processing` / `finish_document_indexing`
  -- / `fail_document`.
  status public.document_status not null default 'pending',
  -- JÁ em português claro. A tela mostra cru.
  error_message text,
  chunk_count integer not null default 0,
  char_count integer not null default 0,
  embed_tokens integer not null default 0,
  -- Micro-dólares. NULO = preço desconhecido; 0 = custou zero mesmo.
  embed_cost_micros bigint,
  -- Qual modelo indexou de fato (cópia congelada do da base).
  embedding_model text,
  -- O texto colado, quando `source_kind = 'text'`. Guardado pra "Tentar de
  -- novo" conseguir re-indexar sem pedir pra pessoa colar tudo outra vez.
  content text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint documents_title_len check (char_length(title) between 1 and 200),
  constraint documents_storage_path_len
    check (storage_path is null or char_length(storage_path) between 3 and 400),
  constraint documents_mime_len check (mime_type is null or char_length(mime_type) <= 120),
  constraint documents_byte_size_nonneg check (byte_size is null or byte_size >= 0),
  constraint documents_error_len check (error_message is null or char_length(error_message) <= 500),
  constraint documents_counts_nonneg
    check (chunk_count >= 0 and char_count >= 0 and embed_tokens >= 0),
  constraint documents_cost_nonneg check (embed_cost_micros is null or embed_cost_micros >= 0),
  -- Teto de MAX_CHARS_POR_DOCUMENTO (lib/knowledge/chunk.ts). Rede de
  -- segurança: o teto de verdade é conferido antes de chegar aqui.
  constraint documents_content_len check (content is null or char_length(content) <= 300000),
  -- Arquivo enviado tem que ter caminho no bucket; texto colado tem que ter
  -- texto. Sem isso, "Tentar de novo" ficaria sem de onde ler.
  --
  -- ⚠️ CONSEQUÊNCIA PRA QUEM ESCREVE A FUNÇÃO DE ENVIO: como o caminho no
  -- bucket é `{org}/{base}/{documento}.{ext}` e esta tabela NÃO tem `grant
  -- update` pra quem está logado, o `id` do documento tem que ser sorteado no
  -- TypeScript (`crypto.randomUUID()`) e gravado JUNTO com o `storage_path`, no
  -- mesmo insert. Não existe caminho "insere agora, preenche o caminho depois".
  constraint documents_source_shape check (
    case source_kind
      when 'upload' then storage_path is not null
      when 'text' then content is not null
      else true
    end
  )
);

comment on table public.documents is
  'Cada arquivo ou texto de uma base de conhecimento. Situação e custo só mudam por função (não existe grant de update).';
comment on column public.documents.embed_cost_micros is
  'Custo de indexar, em micro-dólares. NULO = preço desconhecido; 0 = custou zero mesmo.';
comment on column public.documents.chunk_count is
  'Contado pela própria tabela em finish_document_indexing. Token e custo vêm de fora: só o provedor sabe quanto cobrou.';

create index if not exists documents_org_kb_created_idx
  on public.documents (organization_id, knowledge_base_id, created_at desc);

create index if not exists documents_org_status_idx
  on public.documents (organization_id, status);

-- ⚠️ REPARE no que NÃO tem aqui: UPDATE. Situação, contagem e custo são
-- escritos só pelas funções `security definer` desta migration. O gatilho
-- `documents_set_updated_at` continua funcionando porque quem faz o UPDATE é a
-- função (que roda como dono), não a pessoa. NÃO "conserte" isso acrescentando
-- `grant update` — seria devolver a chance de declarar que indexar custou zero.
revoke all on public.documents from anon, authenticated;
grant select, insert, delete on public.documents to authenticated;
grant select, insert, update, delete on public.documents to service_role;

alter table public.documents enable row level security;

drop policy if exists "members read documents" on public.documents;
create policy "members read documents"
  on public.documents for select
  using (public.is_org_member(organization_id));

drop policy if exists "admins create documents" on public.documents;
create policy "admins create documents"
  on public.documents for insert
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = created_by
    and exists (
      select 1
        from public.knowledge_bases b
       where b.id = documents.knowledge_base_id
         and b.organization_id = documents.organization_id
    )
  );

-- Sem policy de UPDATE, de propósito (ver comentário do grant acima).

drop policy if exists "admins delete documents" on public.documents;
create policy "admins delete documents"
  on public.documents for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

drop trigger if exists documents_freeze_org_and_creator on public.documents;
create trigger documents_freeze_org_and_creator
  before update on public.documents
  for each row execute function public.freeze_org_and_creator();

-- =============================================================================
-- 5. document_chunks — os pedaços, com o embedding de cada um
-- =============================================================================
-- ⚠️ ESTA TABELA É SÓ DE LEITURA PRA QUEM ESTÁ LOGADO. Gravar pedaço é por
-- `append_document_chunks`, e apagar acontece em cascata quando o documento
-- some. Assim ninguém consegue plantar um trecho falso na base de conhecimento
-- de um agente.
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  seq integer not null,
  content text not null,
  -- 1536 números que representam o SIGNIFICADO do trecho. O tipo não é
  -- qualificado de propósito (ver o aviso no topo do arquivo).
  embedding vector(1536) not null,
  tokens integer,
  created_at timestamptz not null default now(),
  constraint document_chunks_seq_nonneg check (seq >= 0),
  -- Mesmo teto de CHUNK_MAX_CHARS em lib/knowledge/chunk.ts.
  constraint document_chunks_content_len check (char_length(content) between 1 and 8000),
  constraint document_chunks_tokens_nonneg check (tokens is null or tokens >= 0)
);

comment on table public.document_chunks is
  'Os pedaços indexados de um documento. Só de leitura pra quem está logado: gravar é por append_document_chunks.';
comment on column public.document_chunks.embedding is
  'Vetor de 1536 números (text-embedding-3-small). Ocupa ~20 KB por linha: NUNCA selecione esta coluna numa listagem.';

create unique index if not exists document_chunks_doc_seq_key
  on public.document_chunks (document_id, seq);

create index if not exists document_chunks_org_kb_idx
  on public.document_chunks (organization_id, knowledge_base_id);

create index if not exists document_chunks_doc_seq_idx
  on public.document_chunks (document_id, seq asc);

-- O índice que faz a busca por significado ser rápida. `vector_cosine_ops`
-- resolve pelo `search_path` do topo do arquivo.
create index if not exists document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- ⚠️ Só `select`. E mesmo o select tem uma pegadinha: `select("*")` traz a
-- coluna `embedding` inteira (~20 KB por linha). Pra procurar trecho use
-- `ctx.knowledge.search()`; o acesso direto existe só pra CONTAR.
revoke all on public.document_chunks from anon, authenticated;
grant select on public.document_chunks to authenticated;
grant select, insert, update, delete on public.document_chunks to service_role;

alter table public.document_chunks enable row level security;

drop policy if exists "members read document chunks" on public.document_chunks;
create policy "members read document chunks"
  on public.document_chunks for select
  using (public.is_org_member(organization_id));

-- Sem policy de INSERT, UPDATE ou DELETE, de propósito.
-- Apagar o documento leva os pedaços junto (`on delete cascade`), e cascata de
-- chave estrangeira não passa por policy.

-- =============================================================================
-- 6. As funções que mexem no documento
-- =============================================================================
-- Todas conferem que quem chama administra o workspace DONO do documento. Nada
-- aqui confia no `organization_id` que veio de fora: ele é lido da linha.
create or replace function public.assert_document_admin(_document_id uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select d.organization_id into v_org from public.documents d where d.id = _document_id;
  if not found then
    raise exception 'document not found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not allowed to manage this document';
  end if;

  return v_org;
end;
$$;

revoke execute on function public.assert_document_admin(uuid) from public, anon;
grant execute on function public.assert_document_admin(uuid) to authenticated;

-- "Tentar de novo": volta pro começo e APAGA os pedaços antigos. Sem apagar,
-- re-indexar deixaria pedaço velho misturado com pedaço novo.
create or replace function public.queue_document(_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  perform public.assert_document_admin(_document_id);

  delete from public.document_chunks where document_id = _document_id;

  update public.documents
     set status = 'pending',
         error_message = null,
         chunk_count = 0,
         char_count = 0,
         embed_tokens = 0,
         embed_cost_micros = null,
         processed_at = null,
         updated_at = now()
   where id = _document_id;
end;
$$;

revoke execute on function public.queue_document(uuid) from public, anon;
grant execute on function public.queue_document(uuid) to authenticated;

-- Sai de "esperando" pra "processando". Devolve `false` quando o documento já
-- estava sendo processado — é assim que dois cliques no botão não indexam (e
-- não cobram) duas vezes.
create or replace function public.start_document_processing(_document_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  perform public.assert_document_admin(_document_id);

  update public.documents
     set status = 'processing',
         error_message = null,
         updated_at = now()
   where id = _document_id
     and status in ('pending', 'failed');

  return found;
end;
$$;

revoke execute on function public.start_document_processing(uuid) from public, anon;
grant execute on function public.start_document_processing(uuid) to authenticated;

-- Grava um lote de pedaços. O embedding chega como TEXTO (`"[0.1,0.2,...]"`)
-- porque JSON não tem tipo de vetor; o Postgres converte na entrada e a
-- conferência de dimensão é do tipo da coluna.
create or replace function public.append_document_chunks(_document_id uuid, _chunks jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set row_security = off
as $$
declare
  v_org uuid;
  v_kb uuid;
  v_n integer;
begin
  v_org := public.assert_document_admin(_document_id);

  if _chunks is null or jsonb_typeof(_chunks) <> 'array' then
    raise exception 'chunks must be a json array';
  end if;
  -- O lote de embedding é de 32 (LOTE_EMBEDDING). Este teto é folga, não regra.
  if jsonb_array_length(_chunks) > 300 then
    raise exception 'too many chunks in one batch';
  end if;

  select d.knowledge_base_id into v_kb from public.documents d where d.id = _document_id;

  insert into public.document_chunks (
    organization_id, knowledge_base_id, document_id, seq, content, embedding, tokens
  )
  select
    v_org,
    v_kb,
    _document_id,
    (c->>'seq')::integer,
    c->>'content',
    (c->>'embedding')::vector,
    nullif(c->>'tokens', '')::integer
  from jsonb_array_elements(_chunks) as c
  on conflict (document_id, seq) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.append_document_chunks(uuid, jsonb) from public, anon;
grant execute on function public.append_document_chunks(uuid, jsonb) to authenticated;

-- Fecha a indexação.
--
-- ⚠️ O QUE VEM DE ONDE, sem enfeite:
--  • quantidade de pedaços e de caracteres SAI DA PRÓPRIA TABELA — ninguém
--    consegue declarar um número diferente do que está gravado;
--  • token e custo CHEGAM POR PARÂMETRO, porque só o provedor sabe quanto
--    cobrou. É a mesma disciplina de `agent_run_steps`.
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
begin
  perform public.assert_document_admin(_document_id);

  select count(*), coalesce(sum(char_length(c.content)), 0)
    into v_pedacos, v_chars
    from public.document_chunks c
   where c.document_id = _document_id;

  if v_pedacos = 0 then
    raise exception 'no chunks were indexed for this document';
  end if;

  update public.documents
     set status = 'ready',
         error_message = null,
         chunk_count = v_pedacos,
         char_count = least(v_chars, 2147483647)::integer,
         embedding_model = left(_embedding_model, 120),
         embed_tokens = greatest(coalesce(_embed_tokens, 0), 0),
         embed_cost_micros = case
           when _embed_cost_micros is null then null
           else greatest(_embed_cost_micros, 0)
         end,
         processed_at = now(),
         updated_at = now()
   where id = _document_id;
end;
$$;

revoke execute on function public.finish_document_indexing(uuid, text, integer, bigint)
  from public, anon;
grant execute on function public.finish_document_indexing(uuid, text, integer, bigint)
  to authenticated;

-- Deu errado. A frase JÁ CHEGA em português leigo — a tela mostra cru.
create or replace function public.fail_document(_document_id uuid, _motivo text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  perform public.assert_document_admin(_document_id);

  update public.documents
     set status = 'failed',
         error_message = left(
           coalesce(nullif(_motivo, ''), 'Não deu pra processar este arquivo. Tente de novo.'),
           500
         ),
         processed_at = now(),
         updated_at = now()
   where id = _document_id;
end;
$$;

revoke execute on function public.fail_document(uuid, text) from public, anon;
grant execute on function public.fail_document(uuid, text) to authenticated;

-- =============================================================================
-- 7. A busca por significado
-- =============================================================================
-- ⚠️ ESTA FUNÇÃO CONFERE O PERTENCIMENTO ANTES DE RESPONDER. Ela é
-- `security definer` (precisa ser, pra usar o índice sem a RLS reprocessar
-- linha a linha), então o `is_org_member` aqui NÃO é enfeite: é a única coisa
-- entre uma pessoa logada e a base de conhecimento de outro workspace.
create or replace function public.match_document_chunks(
  _organization_id uuid,
  _knowledge_base_id uuid default null,
  _embedding text default null,
  _limite integer default 5,
  _min_similarity real default 0
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  knowledge_base_id uuid,
  seq integer,
  content text,
  similarity real
)
language plpgsql
security definer
stable
set search_path = public, extensions, pg_temp
set row_security = off
as $$
declare
  v_vec vector(1536);
  v_limite integer := greatest(least(coalesce(_limite, 5), 20), 1);
  v_min real := greatest(least(coalesce(_min_similarity, 0), 1), 0);
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if _organization_id is null or not public.is_org_member(_organization_id) then
    raise exception 'not a member of this organization';
  end if;
  if _embedding is null or _embedding = '' then
    raise exception 'embedding is required';
  end if;

  begin
    v_vec := _embedding::vector(1536);
  exception when others then
    raise exception 'invalid embedding';
  end;

  return query
  select c.id,
         c.document_id,
         d.title,
         c.knowledge_base_id,
         c.seq,
         c.content,
         (1 - (c.embedding <=> v_vec))::real
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
   where c.organization_id = _organization_id
     and (_knowledge_base_id is null or c.knowledge_base_id = _knowledge_base_id)
     and (1 - (c.embedding <=> v_vec))::real >= v_min
   order by c.embedding <=> v_vec
   limit v_limite;
end;
$$;

revoke execute on function public.match_document_chunks(uuid, uuid, text, integer, real)
  from public, anon;
grant execute on function public.match_document_chunks(uuid, uuid, text, integer, real)
  to authenticated;

-- =============================================================================
-- 8. O bucket dos arquivos
-- =============================================================================
-- O caminho é sempre `{organization_id}/{knowledge_base_id}/{document_id}.{ext}`,
-- então a primeira pasta identifica o workspace — é nela que as regras abaixo se
-- apoiam.
--
-- Esta função existe porque `((storage.foldername(name))[1])::uuid` ESTOURA
-- quando o nome do arquivo não tem uma pasta com cara de uuid — e uma policy que
-- estoura derruba a listagem inteira do bucket, não só aquele arquivo.
--
-- Declarada `stable`, não `immutable`: ela chama `storage.foldername`, que é de
-- outro schema e pode mudar numa versão futura do Storage. Mentir sobre
-- volatilidade é dívida que cobra juros depois.
create or replace function public.storage_folder_uuid(_name text)
returns uuid
language plpgsql
stable
set search_path = public, storage, pg_temp
as $$
declare
  v_primeira text;
begin
  if _name is null then
    return null;
  end if;

  v_primeira := (storage.foldername(_name))[1];
  if v_primeira is null
     or v_primeira !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return v_primeira::uuid;
exception
  when others then
    return null;
end;
$$;

revoke execute on function public.storage_folder_uuid(text) from public, anon;
grant execute on function public.storage_folder_uuid(text) to authenticated;

-- `on conflict do update` (e não `do nothing`): assim o teto de tamanho e a
-- lista de tipos aceitos são REAPLICADOS quando esta migration roda de novo por
-- cima de um banco que já tem o bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-docs',
  'knowledge-docs',
  false,
  5242880,
  array['application/pdf', 'text/plain', 'text/markdown', 'text/csv']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "knowledge-docs members read" on storage.objects;
create policy "knowledge-docs members read"
  on storage.objects for select
  using (
    bucket_id = 'knowledge-docs'
    and public.is_org_member(public.storage_folder_uuid(name))
  );

drop policy if exists "knowledge-docs admins insert" on storage.objects;
create policy "knowledge-docs admins insert"
  on storage.objects for insert
  with check (
    bucket_id = 'knowledge-docs'
    and public.has_org_role(
      public.storage_folder_uuid(name),
      array['owner', 'admin']::public.org_role[]
    )
  );

drop policy if exists "knowledge-docs admins update" on storage.objects;
create policy "knowledge-docs admins update"
  on storage.objects for update
  using (
    bucket_id = 'knowledge-docs'
    and public.has_org_role(
      public.storage_folder_uuid(name),
      array['owner', 'admin']::public.org_role[]
    )
  );

drop policy if exists "knowledge-docs admins delete" on storage.objects;
create policy "knowledge-docs admins delete"
  on storage.objects for delete
  using (
    bucket_id = 'knowledge-docs'
    and public.has_org_role(
      public.storage_folder_uuid(name),
      array['owner', 'admin']::public.org_role[]
    )
  );

-- Avisa o PostgREST (a API do Supabase) que o desenho do banco mudou.
notify pgrst, 'reload schema';
