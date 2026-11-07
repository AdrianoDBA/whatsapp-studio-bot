-- ============================================================================
-- Indexar documento passa a ser trabalho de FILA, como o desenho mandava.
--
-- O QUE ACONTECIA: `uploadDocumentAction` chamava `processarDocumento` dentro
-- da própria requisição. Um PDF de 50 páginas vira dezenas de chamadas de
-- embedding em série — e o proxy do EasyPanel corta requisição parada em 60
-- segundos. O aluno subia o arquivo, a tela dava erro de rede, e o documento
-- ficava marcado como "Lendo..." pra sempre.
--
-- A correção anterior (20260821050000) deu uma SAÍDA pra isso: depois de 10
-- minutos parado, dá pra mandar ler de novo. Mas era saída, não conserto — o
-- arquivo grande continuava sem conseguir terminar nunca.
--
-- AGORA: subir o arquivo só enfileira. Quem lê é o trabalhador, que roda fora
-- da requisição e não tem corte de 60 segundos.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A fila aceita um segundo tipo de trabalho
-- ----------------------------------------------------------------------------
-- `agent_id` era obrigatório porque só existia trabalho de agente. Indexar
-- documento não tem agente nenhum — mas continua exigindo agente pro tipo
-- 'run_agent', senão um trabalho de agente sem agente entraria calado.
alter table public.jobs alter column agent_id drop not null;

alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check
  check (kind in ('run_agent', 'ingest_document'));

alter table public.jobs drop constraint if exists jobs_agent_required;
alter table public.jobs add constraint jobs_agent_required
  check (kind <> 'run_agent' or agent_id is not null);

alter table public.jobs drop constraint if exists jobs_source_kind_check;
alter table public.jobs add constraint jobs_source_kind_check
  check (source_kind in ('schedule', 'webhook', 'manual', 'upload'));


-- ----------------------------------------------------------------------------
-- 2. Enfileirar a leitura de um documento
-- ----------------------------------------------------------------------------
-- A identidade (`run_as`) é de quem subiu o arquivo, pelo mesmo motivo de
-- sempre: é a permissão dela que vale quando o trabalhador for ler o documento,
-- e é assim que a RLS continua valendo num caminho que roda sem ninguém logado.
create or replace function public.enqueue_document_job(_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_doc public.documents%rowtype;
  v_pendentes integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Mesma conferência de papel que apagar/reler um documento exige.
  perform public.assert_document_admin(_document_id);

  select * into v_doc from public.documents where id = _document_id;
  if not found then
    raise exception 'document not found';
  end if;

  -- Já tem um trabalho esperando por este documento? Não enfileira de novo:
  -- dois trabalhadores lendo o mesmo arquivo cobrariam o embedding duas vezes.
  if exists (
    select 1 from public.jobs j
     where j.kind = 'ingest_document'
       and j.source_id = _document_id
       and j.status in ('pending', 'running')
  ) then
    raise exception 'document already queued';
  end if;

  select count(*) into v_pendentes
    from public.jobs j
   where j.organization_id = v_doc.organization_id
     and j.status in ('pending', 'running');
  if v_pendentes >= 25 then
    raise exception 'too many jobs waiting';
  end if;

  insert into public.jobs (
    organization_id, kind, agent_id, run_as, payload, source_kind, source_id
  )
  values (
    v_doc.organization_id, 'ingest_document', null, auth.uid(),
    jsonb_build_object('documentId', _document_id::text), 'upload', _document_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.enqueue_document_job(uuid) from public, anon;
grant execute on function public.enqueue_document_job(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. O trabalhador precisa saber QUE TIPO de trabalho pegou
-- ----------------------------------------------------------------------------
drop function if exists public.job_for_run(uuid, text);
create function public.job_for_run(_job_id uuid, _worker_id text)
returns table (
  id uuid,
  organization_id uuid,
  kind text,
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
  select j.id, j.organization_id, j.kind, j.agent_id, j.payload, j.run_as,
         j.source_kind, j.source_id, j.attempts, j.max_attempts, j.locked_by
    from public.jobs j
   where j.id = _job_id
     and j.status = 'running'
     and j.locked_by is not distinct from _worker_id;
$$;

revoke execute on function public.job_for_run(uuid, text) from public, anon, authenticated;
