-- ============================================================================
-- O trabalhador passa a CONSEGUIR ler o arquivo que foi enfileirado.
--
-- O QUE ACONTECIA: a migration 20260821070000 mandou o upload pra fila (pra
-- fugir do corte de 60 s do proxy), mas a PONTE DA AUTOMAÇÃO NÃO SERVE STORAGE
-- — está escrito em `lib/automation/postgrest-bridge.ts` e repetido em
-- `lib/knowledge/storage.ts`. O trabalhador pegava o trabalho, tentava baixar
-- o arquivo do balde e não conseguia. Resultado medido no navegador: TODO
-- arquivo enviado morria com "Não achei mais o arquivo original desse
-- documento", enquanto texto colado (que é lido na hora) funcionava.
--
-- AGORA: quem enfileira é uma função do servidor, com sessão de gente de
-- verdade — e é ELA que pede um endereço temporário pro balde, com a permissão
-- de quem subiu o arquivo. O endereço viaja no trabalho, e o trabalhador só
-- faz um `fetch` nele.
--
-- ⚠️ A REGRA R5 CONTINUA DE PÉ. O trabalhador NÃO ganhou Storage: ele não pede
-- endereço nenhum, não fala com o balde e não sabe o que é um bucket. Ele
-- busca uma URL que já veio pronta, como buscaria qualquer endereço da
-- internet. Não troque isso por "dar Storage pra ponte".
--
-- ⚠️ O ENDEREÇO É UM SEGREDO CURTO. Ele mora em `jobs.payload`, que é uma
-- tabela escopada por workspace com RLS — quem enxerga já podia baixar o
-- arquivo pela tela de qualquer jeito. Ainda assim ele expira (ver
-- SEGUNDOS_DO_LINK_DA_FILA em `lib/knowledge/storage.ts`): trabalho que ficou
-- parado tempo demais falha pedindo pra tentar de novo, e o "Tentar de novo"
-- gera um endereço novo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- `enqueue_document_job` ganha o endereço do arquivo
-- ----------------------------------------------------------------------------
-- DROP antes do CREATE, e não `create or replace`: acrescentar um parâmetro
-- com valor padrão cria uma SEGUNDA função (sobrecarga), não substitui a
-- primeira — e aí `enqueue_document_job(uuid)` ficaria ambígua. Com o drop, a
-- migration também reaplica limpa por cima de um banco que já tem tudo, que é
-- o caso que o boot do container faz acontecer (regra 9 do CLAUDE.md).
drop function if exists public.enqueue_document_job(uuid);
drop function if exists public.enqueue_document_job(uuid, text);

create function public.enqueue_document_job(
  _document_id uuid,
  _download_url text default null
)
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
    -- `strip_nulls` pra não gravar `"downloadUrl": null` num documento de
    -- texto colado, que não tem arquivo nenhum pra baixar.
    jsonb_strip_nulls(
      jsonb_build_object(
        'documentId', _document_id::text,
        'downloadUrl', _download_url
      )
    ),
    'upload', _document_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.enqueue_document_job(uuid, text) from public, anon;
grant execute on function public.enqueue_document_job(uuid, text) to authenticated;

comment on function public.enqueue_document_job(uuid, text) is
  'Põe a leitura de um documento na fila. O endereço temporário do arquivo vem de quem chama (uma função do servidor, com sessão de gente) — o trabalhador não fala com o Storage.';
