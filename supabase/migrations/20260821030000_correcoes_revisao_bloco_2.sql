-- ============================================================================
-- Correções apontadas pela revisão adversarial do bloco 2.
--
-- Cinco buracos que passaram pelos 621 testes verdes. Três deles os revisores
-- reproduziram no banco de verdade, virando papel `authenticated` — não foram
-- achados lendo código.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Agendamento alheio: membro comum não mexe mais
-- ----------------------------------------------------------------------------
-- ANTES: `enqueue_agent_job` só exigia ser MEMBRO do workspace. Com isso, um
-- membro comum:
--   (a) enfileirava trabalho carimbado com o número do agendamento de um
--       administrador — e quando esse trabalho falhava, o resultado voltava
--       como `schedule_report_result(pausar => true)` e DESLIGAVA o
--       agendamento do outro;
--   (b) rodava no PRÓPRIO nome (`run_as = auth.uid()`), não no nome de quem
--       armou o agendamento. O "Rodar agora" mentia sobre quem estava rodando.
--
-- AGORA: pedido vindo de agendamento exige papel de dono/administrador, e a
-- identidade sai DO AGENDAMENTO, nunca de quem clicou.
create or replace function public.enqueue_agent_job(
  _agent_id uuid,
  _input jsonb default '{}'::jsonb,
  _source_kind text default 'manual',
  _source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_agent public.agents%rowtype;
  v_schedule public.schedules%rowtype;
  v_run_as uuid;
  v_pendentes integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if _source_kind is null or _source_kind not in ('manual', 'schedule') then
    raise exception 'invalid source kind';
  end if;

  select * into v_agent from public.agents where id = _agent_id;
  if not found then
    raise exception 'agent not found';
  end if;
  if not public.is_org_member(v_agent.organization_id) then
    raise exception 'not a member of this organization';
  end if;
  if v_agent.status = 'archived' then
    raise exception 'agent is archived';
  end if;

  -- Quem roda no próprio nome é quem pediu.
  v_run_as := auth.uid();

  if _source_kind = 'schedule' then
    if _source_id is null then
      raise exception 'schedule id is required';
    end if;

    -- Mexer em automação é coisa de quem administra. A policy de leitura já
    -- deixa qualquer membro VER os agendamentos; ver não pode virar mexer.
    if not public.has_org_role(
      v_agent.organization_id,
      array['owner', 'admin']::public.org_role[]
    ) then
      raise exception 'not allowed to run this schedule';
    end if;

    select * into v_schedule
      from public.schedules s
     where s.id = _source_id
       and s.organization_id = v_agent.organization_id
       and s.agent_id = v_agent.id;
    if not found then
      raise exception 'schedule not found';
    end if;

    -- A IDENTIDADE SAI DO AGENDAMENTO. "Rodar agora" tem que rodar exatamente
    -- como a rodada das 8h da manhã rodaria — senão o teste na mão passa e a
    -- rodada automática falha, com permissão diferente.
    v_run_as := v_schedule.run_as;
    if v_run_as is null then
      raise exception 'schedule has no responsible user';
    end if;
  end if;

  -- Freio de mão contra alguém segurando o botão "Rodar agora".
  select count(*) into v_pendentes
    from public.jobs j
   where j.organization_id = v_agent.organization_id
     and j.status in ('pending', 'running');
  if v_pendentes >= 25 then
    raise exception 'too many jobs waiting';
  end if;

  insert into public.jobs (
    organization_id, kind, agent_id, run_as, payload, source_kind, source_id
  )
  values (
    v_agent.organization_id, 'run_agent', v_agent.id, v_run_as,
    coalesce(_input, '{}'::jsonb), _source_kind, _source_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.enqueue_agent_job(uuid, jsonb, text, uuid)
  from public, anon;
grant execute on function public.enqueue_agent_job(uuid, jsonb, text, uuid)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 2. Trabalho que falha para de girar pra sempre
-- ----------------------------------------------------------------------------
-- ANTES: `release_job` devolvia o trabalho pra fila sem contar tentativa e sem
-- teto. Quando a chamada interna falhava de um jeito que não passa (o site e o
-- trabalhador com ENCRYPTION_KEY diferentes, por exemplo), o trabalho girava
-- `pending → running → pending` PARA SEMPRE: nunca virava falha, nunca aparecia
-- como erro na tela, e ficava consumindo a fila.
--
-- AGORA: cada devolução conta uma tentativa. Estourou o teto, vira falha com
-- frase em PT-BR — que é o que a pessoa precisa pra saber que tem que agir.
create or replace function public.release_job(_job_id uuid, _error text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_job public.jobs%rowtype;
begin
  select * into v_job
    from public.jobs
   where id = _job_id
     and status = 'running'
     and started_at is null
   for update;

  if not found then
    return;
  end if;

  if v_job.attempts + 1 >= v_job.max_attempts then
    update public.jobs
       set status = 'failed',
           attempts = v_job.attempts + 1,
           locked_at = null,
           locked_by = null,
           last_error = left(
             coalesce(_error, 'A automação não conseguiu começar.') ||
             ' (desistimos depois de ' || (v_job.attempts + 1) || ' tentativas)',
             2000
           ),
           updated_at = now()
     where id = _job_id;
    return;
  end if;

  update public.jobs
     set status = 'pending',
         attempts = v_job.attempts + 1,
         -- Espera crescente: 30s, 60s, 120s… não adianta martelar um serviço
         -- que acabou de recusar.
         run_after = now() + make_interval(
           secs => least(30 * power(2, v_job.attempts)::integer, 900)
         ),
         locked_at = null,
         locked_by = null,
         last_error = left(_error, 2000),
         updated_at = now()
   where id = _job_id;
end;
$$;

revoke execute on function public.release_job(uuid, text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Automação não aponta mais pra agente de outro workspace
-- ----------------------------------------------------------------------------
-- ANTES: as policies de INSERT conferiam que o agente é do mesmo workspace, mas
-- as de UPDATE não. Um administrador conseguia editar o próprio agendamento e
-- trocar o `agent_id` pelo de OUTRA organização — a linha continuava com o
-- `organization_id` dele, mas rodando agente alheio.
create or replace function public.agent_belongs_to_org(_agent_id uuid, _organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.agents a
     where a.id = _agent_id
       and a.organization_id = _organization_id
  );
$$;

revoke execute on function public.agent_belongs_to_org(uuid, uuid) from public, anon;
grant execute on function public.agent_belongs_to_org(uuid, uuid) to authenticated;

drop policy if exists "admins update schedules" on public.schedules;
create policy "admins update schedules"
  on public.schedules for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and auth.uid() = run_as
    and public.agent_belongs_to_org(agent_id, organization_id)
  );

drop policy if exists "admins update webhook endpoints" on public.webhook_endpoints;
create policy "admins update webhook endpoints"
  on public.webhook_endpoints for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and public.agent_belongs_to_org(agent_id, organization_id)
  );


-- ----------------------------------------------------------------------------
-- 4. O segredo do webhook não é editável
-- ----------------------------------------------------------------------------
-- O `grant select` já era coluna a coluna, deixando `token_hash` de fora — mas
-- o `grant update` era da tabela inteira, então quem administra podia
-- SOBRESCREVER o segredo e o contador do limite de taxa. Quem implementou
-- registrou a discordância no relatório; ele estava certo.
revoke update on public.webhook_endpoints from authenticated;
grant update (label, is_active, run_as, updated_at) on public.webhook_endpoints to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Documento travado em "Lendo..." tem saída
-- ----------------------------------------------------------------------------
-- ANTES: se o processo morria no meio da leitura do arquivo (deploy, reinício
-- do container, queda), a linha ficava em `processing` PARA SEMPRE. E as duas
-- camadas travavam a saída: o botão "tentar de novo" ficava desligado nesse
-- estado, e a função do servidor recusava nesse mesmo estado. Beco sem saída.
--
-- AGORA: documento parado em `processing` há mais de 10 minutos é considerado
-- abandonado — ninguém está trabalhando nele — e pode voltar pra fila.
create or replace function public.queue_document(_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_doc public.documents%rowtype;
begin
  perform public.assert_document_admin(_document_id);

  select * into v_doc from public.documents where id = _document_id;
  if not found then
    raise exception 'document not found';
  end if;

  -- Leitura EM ANDAMENTO de verdade não é interrompida: mandar de novo agora
  -- geraria dois conjuntos de pedaços pro mesmo arquivo e cobraria embedding
  -- duas vezes.
  if v_doc.status = 'processing' and v_doc.updated_at > now() - interval '10 minutes' then
    raise exception 'document is being processed';
  end if;

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
