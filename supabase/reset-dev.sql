-- =============================================================================
-- ZERAR O BANCO — SÓ EM DESENVOLVIMENTO
-- =============================================================================
-- ⚠️  ISSO APAGA TODOS OS DADOS: organizações, tarefas, convites, agentes,
--     conversas, automações, bases de conhecimento e contas.
--     NUNCA rode isso num banco que já tem gente usando de verdade.
--
-- PRA QUE SERVE:
-- Quando você aplicou as tabelas pela metade, ou bagunçou tudo testando, e
-- quer recomeçar do zero.
--
-- COMO USAR:
-- 1. No Supabase: SQL Editor → New query → cole este arquivo inteiro → Run.
-- 2. Reinicie seu app (no EasyPanel: Deploy). Ele recria tudo sozinho.
--
-- Se você usa o Supabase na sua máquina, existe um caminho mais curto:
--     npx supabase db reset
--
-- ⚠️ MEXEU NUMA MIGRATION? MEXA AQUI TAMBÉM.
-- Toda tabela, função, tipo, gatilho e policy que uma migration cria precisa
-- aparecer numa das listas abaixo — inclusive gatilho que mora fora do schema
-- `public` (os de `auth.users`) e policy que mora em `storage.objects`. Coisa
-- que sobra aqui vira erro de "já existe" no próximo `npm run migrate`.
-- =============================================================================

-- Gatilhos que moram FORA do schema do app (em auth.users). Eles não somem
-- junto com as tabelas, e um gatilho apontando pra função que já foi apagada
-- faz o próximo cadastro falhar.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created_platform_owner on auth.users;

-- Tabelas do app.
--
-- ⚠️ AS TABELAS SAEM ANTES DAS CONTAS DE LOGIN, e isso NÃO é detalhe.
-- Apagar `auth.users` primeiro derrubava `memberships` em cascata, e o gatilho
-- `memberships_assert_owner` reclamava com "cannot leave organization without
-- an owner" — o reset inteiro parava na segunda linha. Sem as tabelas, não
-- existe gatilho pra reclamar.
--
-- A ORDEM ENTRE ELAS TAMBÉM IMPORTA: quem depende vem antes de quem é
-- dependido. O `cascade` resolveria sozinho, mas assim fica legível o que
-- depende do quê.
drop table if exists public.org_ai_spend cascade;
drop table if exists public.org_ai_limits cascade;
drop table if exists public.document_chunks cascade;
drop table if exists public.documents cascade;
drop table if exists public.knowledge_bases cascade;
drop table if exists public.thread_messages cascade;
drop table if exists public.threads cascade;
drop table if exists public.jobs cascade;
drop table if exists public.schedules cascade;
drop table if exists public.webhook_endpoints cascade;
drop table if exists public.automation_usage cascade;
drop table if exists public.agent_run_steps cascade;
drop table if exists public.agent_runs cascade;
drop table if exists public.agents cascade;
drop table if exists public.credentials cascade;
drop table if exists public.platform_admins cascade;
drop table if exists public.llm_usage cascade;
drop table if exists public.tasks cascade;
drop table if exists public.invitations cascade;
drop table if exists public.memberships cascade;
drop table if exists public.organizations cascade;
drop table if exists public.profiles cascade;

-- Contas de login.
delete from auth.users;

-- Funções auxiliares.
--
-- ⚠️ A assinatura tem que bater INTEIRA (todos os tipos dos parâmetros), senão
-- o `drop` não acha a função e ela sobra. Por isso os tipos do próprio projeto
-- aparecem aqui (`public.job_status`, `public.agent_run_status`, …) — e por
-- isso as funções são apagadas ANTES dos tipos, logo abaixo.
drop function if exists public.accept_invitation(text) cascade;
drop function if exists public.create_organization_with_owner(text, text) cascade;
drop function if exists public.transfer_ownership(uuid, uuid) cascade;
drop function if exists public.consume_llm_tokens(integer) cascade;
drop function if exists public.current_user_email() cascade;
drop function if exists public.is_org_member(uuid) cascade;
drop function if exists public.has_org_role(uuid, public.org_role[]) cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.freeze_org_creator() cascade;
drop function if exists public.freeze_org_and_creator() cascade;
drop function if exists public.freeze_invitation_fields() cascade;
drop function if exists public.freeze_membership_keys() cascade;
drop function if exists public.assert_at_least_one_owner() cascade;
drop function if exists public.cleanup_org_logos_on_delete() cascade;
drop function if exists public.is_platform_admin() cascade;
drop function if exists public.claim_platform_ownership() cascade;
drop function if exists public.add_platform_admin(text) cascade;
drop function if exists public.remove_platform_admin(uuid) cascade;
drop function if exists public.can_manage_credential(uuid) cascade;
drop function if exists public.save_credential(public.credential_provider, text, integer, text, text, text, jsonb, uuid) cascade;
drop function if exists public.resolve_credential(uuid, public.credential_provider) cascade;
drop function if exists public.credential_status(uuid) cascade;
drop function if exists public.freeze_credential_fields() cascade;
drop function if exists public.freeze_agent_run_keys() cascade;
drop function if exists public.freeze_agent_slug() cascade;
drop function if exists public.finish_agent_run(uuid, public.agent_run_status, text, text) cascade;

-- Conversa com o agente (onda 3).
drop function if exists public.freeze_thread_keys() cascade;
drop function if exists public.touch_thread_on_message() cascade;

-- Automação: fila, agendamento e webhook (onda 4).
drop function if exists public.claim_job(text) cascade;
drop function if exists public.job_for_run(uuid, text) cascade;
drop function if exists public.mark_job_started(uuid) cascade;
drop function if exists public.finish_job(uuid, public.job_status, text, uuid, interval) cascade;
drop function if exists public.release_job(uuid, text) cascade;
drop function if exists public.reclaim_stuck_jobs(interval) cascade;
drop function if exists public.reclaim_stuck_agent_runs(interval) cascade;
drop function if exists public.finish_agent_run_system(uuid, public.agent_run_status, text, text) cascade;
-- ⚠️ Onda 7: a assinatura ganhou um `text` no fim (`_modo`, migration
-- `20260821130000_execucao_sabe_o_modo.sql`). Mesmo motivo do
-- `record_agent_run_step` mais abaixo: um reset completo precisa apagar a
-- função pela assinatura QUE ESTÁ NO BANCO — com a antiga (8 args), o
-- "if exists" não dropa nada e o replay do zero quebra com "function already
-- exists".
drop function if exists public.open_agent_run_system(uuid, uuid, text, uuid, public.agent_trigger_kind, jsonb, text, uuid, text) cascade;
drop function if exists public.enqueue_due_schedules(integer) cascade;
drop function if exists public.enqueue_agent_job(uuid, jsonb, text, uuid) cascade;
drop function if exists public.enqueue_webhook_job(uuid, jsonb, text) cascade;
drop function if exists public.schedule_report_result(uuid, text, boolean) cascade;
drop function if exists public.webhook_endpoint_for_check(uuid) cascade;
drop function if exists public.webhook_touch(uuid, integer) cascade;
drop function if exists public.automation_daily_cap() cascade;
drop function if exists public.automation_budget_left(uuid) cascade;
drop function if exists public.next_schedule_run(text, smallint, smallint, smallint[], smallint, integer, text, timestamptz) cascade;
drop function if exists public.schedule_set_next_run() cascade;
drop function if exists public.agent_belongs_to_org(uuid, uuid) cascade;
-- ⚠️ Onda 7, task 4: a assinatura ganhou um `boolean` no fim (`_simulado`,
-- migration `20260821120000_rastro_marca_passo_simulado.sql`). Um reset
-- completo precisa apagar a função pela assinatura QUE ESTÁ NO BANCO — a
-- antiga (11 args) não bate mais com nada depois que essa migration aplicou,
-- então "if exists" não dropa nada e o replay do zero quebra com "function
-- already exists" na hora de recriar.
drop function if exists public.record_agent_run_step(uuid, smallint, public.agent_step_kind, text, jsonb, jsonb, text, integer, integer, integer, bigint, boolean) cascade;
drop function if exists public.max_micros_per_million_tokens() cascade;
drop function if exists public.enqueue_document_job(uuid) cascade;

-- Base de conhecimento (onda 5).
drop function if exists public.match_document_chunks(uuid, uuid, text, integer, real) cascade;
drop function if exists public.append_document_chunks(uuid, jsonb) cascade;
drop function if exists public.finish_document_indexing(uuid, text, integer, bigint) cascade;
drop function if exists public.start_document_processing(uuid) cascade;
drop function if exists public.queue_document(uuid) cascade;
drop function if exists public.fail_document(uuid, text) cascade;
drop function if exists public.assert_document_admin(uuid) cascade;
drop function if exists public.freeze_knowledge_base_slug() cascade;
drop function if exists public.storage_folder_uuid(text) cascade;

-- Teto de gasto com IA (onda 6).
--
-- ⚠️ `ai_today` e `ai_month_start` são o valor padrão da coluna `day` de
-- `llm_usage` e `automation_usage`. Por isso elas saem AQUI, depois das
-- tabelas — que já foram derrubadas lá em cima.
drop function if exists public.ai_today() cascade;
drop function if exists public.ai_month_start() cascade;
drop function if exists public.org_ai_spend_add(uuid, bigint, bigint, integer, integer) cascade;
drop function if exists public.org_ai_budget_status(uuid) cascade;
drop function if exists public.set_org_ai_limits(uuid, bigint, bigint, bigint, boolean, smallint) cascade;
drop function if exists public.set_org_platform_cap(uuid, bigint) cascade;
drop function if exists public.recompute_org_ai_spend(uuid, date, date) cascade;
drop function if exists public.platform_ai_spend_overview(date) cascade;

-- O agente que age (onda 7). Não criou tabela nova — só colunas nas de cima
-- (já derrubadas com as tabelas) e esta função.
drop function if exists public.webhook_job_result(uuid, uuid) cascade;

-- O código é o dono (onda 7, Task 7). Também não criou tabela nova — só
-- esta função, que `npm run semear` usa pra descobrir quem impersonar.
drop function if exists public.owner_memberships_for_seed(uuid) cascade;

-- Tipos.
drop type if exists public.org_role cascade;
drop type if exists public.task_status cascade;
drop type if exists public.task_priority cascade;
drop type if exists public.credential_provider cascade;
drop type if exists public.agent_status cascade;
drop type if exists public.agent_trigger_kind cascade;
drop type if exists public.agent_run_status cascade;
drop type if exists public.agent_step_kind cascade;
drop type if exists public.thread_message_role cascade;
drop type if exists public.job_status cascade;
drop type if exists public.document_source_kind cascade;
drop type if exists public.document_status cascade;

-- ⚠️ A EXTENSÃO `vector` NÃO É DERRUBADA AQUI, de propósito.
-- Ela pode ter sido ligada por você pra outra coisa, e `drop extension cascade`
-- apagaria coluna de terceiro sem avisar. Como a migration usa
-- `create extension if not exists`, deixar ela de pé não atrapalha em nada.

-- Arquivos enviados (logos das organizações e documentos das bases).
--
-- O Supabase novo BLOQUEIA apagar arquivo por SQL ("Direct deletion from
-- storage tables is not allowed"). Como este arquivo inteiro roda numa
-- transação só, um erro aqui desfazia o reset inteiro — o script parecia
-- rodar e não zerava nada.
--
-- Agora a limpeza é "se der, deu": o aviso aparece e o resto do reset segue.
-- Arquivo de organização apagada não atrapalha nada; se quiser apagar mesmo, vá
-- em Storage no painel do Supabase.
-- As regras de acesso aos arquivos moram em storage.objects e NÃO somem com
-- as tabelas do app. Sobrando, a migration 8 falha em "policy already exists".
drop policy if exists "org-logos public read" on storage.objects;
drop policy if exists "org-logos read by members" on storage.objects;
drop policy if exists "org-logos read by members only" on storage.objects;
drop policy if exists "org-logos admins insert" on storage.objects;
drop policy if exists "org-logos admins update" on storage.objects;
drop policy if exists "org-logos admins delete" on storage.objects;
drop policy if exists "knowledge-docs members read" on storage.objects;
drop policy if exists "knowledge-docs admins insert" on storage.objects;
drop policy if exists "knowledge-docs admins update" on storage.objects;
drop policy if exists "knowledge-docs admins delete" on storage.objects;

do $$
begin
  delete from storage.objects where bucket_id in ('org-logos', 'avatars', 'knowledge-docs');
  delete from storage.buckets where id in ('org-logos', 'avatars', 'knowledge-docs');
exception when others then
  raise notice 'Os arquivos enviados (logos e documentos) NÃO foram apagados: o Supabase não deixa fazer isso por SQL. Se quiser apagar, use a aba Storage no painel. O resto do reset funcionou normalmente.';
end $$;

-- Histórico de quais tabelas já foram criadas. Zerar isso é o que faz o app
-- recriar tudo do zero no próximo boot.
-- O `if` evita erro pra quem nunca usou a ferramenta de linha de comando do
-- Supabase (nesse caso essa tabela simplesmente não existe).
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations;
  end if;
end $$;
