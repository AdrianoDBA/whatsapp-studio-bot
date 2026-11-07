-- ============================================================================
-- Correções apontadas pela revisão adversarial do bloco 1.
--
-- São três buracos que passaram pelos testes (todos verdes) mas que a revisão
-- pegou lendo o código:
--
--   1. A chave da plataforma era alcançável por qualquer pessoa logada.
--   2. Quem disparou uma execução podia reescrever quanto ela custou.
--   3. O apelido do agente podia mudar, quebrando o histórico.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Só o dono do sistema alcança a credencial da plataforma
-- ----------------------------------------------------------------------------
-- ANTES: a conferência de pertencimento era pulada quando o escopo pedido era
-- o da plataforma (`_organization_id` nulo). Qualquer pessoa logada — inclusive
-- quem não é membro de workspace nenhum — recebia o texto cifrado da chave.
--
-- O conteúdo está trancado com a ENCRYPTION_KEY, que não mora no banco, então
-- isso sozinho não entrega a chave. Mas é uma camada de defesa que existia só
-- na intenção. Agora existe de verdade.
--
-- O caminho normal do app não muda: ele sempre pergunta pelo escopo de um
-- workspace, e a busca continua caindo na chave da plataforma quando o
-- workspace não tem a própria.
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

  -- Pedir DIRETO o escopo da plataforma exige ser o dono do sistema.
  if _organization_id is null and not public.is_platform_admin() then
    raise exception 'not a platform admin';
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

revoke execute on function public.resolve_credential(uuid, public.credential_provider)
  from public, anon;
grant execute on function public.resolve_credential(uuid, public.credential_provider)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 2. A conta da execução sai do rastro, não de quem chamou
-- ----------------------------------------------------------------------------
-- ANTES: `agent_runs` dava UPDATE pra quem disparou a execução, e o gatilho de
-- congelamento não cobria `cost_micros`, `tokens_input`, `tokens_output`,
-- `status` nem `output`. Ou seja: dava pra rodar o agente caro e depois zerar
-- o próprio gasto. Como esse número vira o teto de gasto da onda 6, seria uma
-- cobrança errada silenciosa.
--
-- AGORA: ninguém escreve nessas colunas direto. Quem fecha a execução é esta
-- função, e ela SOMA o rastro (`agent_run_steps`) em vez de acreditar no
-- número que chegou. O rastro já era append-only de verdade — sem permissão de
-- UPDATE e sem policy de UPDATE —, então é a fonte confiável.
--
-- ⚠️ O `drop function if exists` abaixo é o que deixa a PILHA INTEIRA reaplicar
-- por cima de um banco cheio. A migration 20260821040000 (teto de gasto) troca
-- o retorno desta função de `void` pra `jsonb`; sem derrubar antes, este
-- `create or replace` erraria com "cannot change return type of existing
-- function" quando as migrations fossem reaplicadas do zero.
drop function if exists public.finish_agent_run(uuid, public.agent_run_status, text, text);
create or replace function public.finish_agent_run(
  _run_id uuid,
  _status public.agent_run_status,
  _output text default null,
  _error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_run public.agent_runs%rowtype;
  v_tokens_in integer;
  v_tokens_out integer;
  v_cost bigint;
  v_custo_desconhecido boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if _status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid terminal status';
  end if;

  select * into v_run from public.agent_runs where id = _run_id;
  if not found then
    raise exception 'run not found';
  end if;

  -- Fecha quem disparou, ou quem administra o workspace.
  if v_run.triggered_by is distinct from auth.uid()
     and not public.has_org_role(
       v_run.organization_id,
       array['owner', 'admin']::public.org_role[]
     ) then
    raise exception 'not allowed to finish this run';
  end if;

  -- Execução já fechada não reabre e não muda de número. Sai calado de
  -- propósito: fechar duas vezes é corrida normal entre o tempo estourando e o
  -- modelo respondendo, não é erro que mereça estourar na cara de ninguém.
  if v_run.status in ('succeeded', 'failed', 'cancelled') then
    return;
  end if;

  select
    coalesce(sum(coalesce(s.tokens_input, 0)), 0)::integer,
    coalesce(sum(coalesce(s.tokens_output, 0)), 0)::integer,
    coalesce(sum(s.cost_micros), 0)::bigint,
    coalesce(bool_or(s.kind = 'model' and s.cost_micros is null), false)
  into v_tokens_in, v_tokens_out, v_cost, v_custo_desconhecido
  from public.agent_run_steps s
  where s.run_id = _run_id;

  update public.agent_runs
     set status = _status,
         output = _output,
         error_message = _error_message,
         tokens_input = v_tokens_in,
         tokens_output = v_tokens_out,
         -- `null` continua querendo dizer "não deu pra calcular" (modelo fora
         -- do catálogo de preços). Zero seria mentira.
         cost_micros = case when v_custo_desconhecido then null else v_cost end,
         finished_at = now()
   where id = _run_id;
end;
$$;

revoke execute on function public.finish_agent_run(
  uuid, public.agent_run_status, text, text
) from public, anon;
grant execute on function public.finish_agent_run(
  uuid, public.agent_run_status, text, text
) to authenticated;

-- Fechada a porta antiga. Sem policy de UPDATE E sem permissão de UPDATE — as
-- duas coisas, porque uma sozinha não basta (a permissão de tabela e a RLS são
-- camadas diferentes).
drop policy if exists "owner of run updates it" on public.agent_runs;
revoke update on public.agent_runs from authenticated;


-- ----------------------------------------------------------------------------
-- 3. O apelido do agente é congelado de verdade
-- ----------------------------------------------------------------------------
-- O comentário da coluna já dizia que o apelido não muda depois de criado —
-- `agent_runs.agent_slug` guarda uma cópia dele pra que o histórico sobreviva
-- ao agente ser apagado. Só que nada no banco impedia a mudança, e a tela de
-- edição só omitia o campo. Uma alteração por fora desligava o histórico
-- inteiro do agente.
create or replace function public.freeze_agent_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'agent slug cannot be changed';
  end if;
  return new;
end;
$$;

revoke execute on function public.freeze_agent_slug() from public, anon, authenticated;

drop trigger if exists agents_freeze_slug on public.agents;
create trigger agents_freeze_slug
  before update on public.agents
  for each row execute function public.freeze_agent_slug();
