-- supabase/migrations/20260821130000_execucao_sabe_o_modo.sql
--
-- ONDA 7 — A EXECUÇÃO PASSA A SABER EM QUE MODO ELA RODOU.
--
-- O DEFEITO QUE ISTO CONSERTA (medido no navegador, não suposto)
-- ---------------------------------------------------------------------------
-- Com o ensaio LIGADO (o padrão do playground), o aluno pede "manda o email de
-- aviso agora" e o card de resposta escreve: "Enviei o email com o relatório do
-- dia para chefe@empresa.com". Nada saiu. A ferramenta devolveu certinho
-- `{"aviso":"Isto foi um ENSAIO…","ensaio":true}` — o modelo simplesmente
-- ignorou. Numa outra rodada ele disse "em modo de ensaio", o que é PIOR: se
-- às vezes acerta e às vezes mente, o aluno não pode confiar em nada do que lê.
--
-- A RAIZ: até aqui, "ensaio" era propriedade do PASSO
-- (`agent_run_steps.simulado`, migration 20260821110000). Passo só existe
-- quando o agente AGIU. Uma execução que rodou em ensaio e não agiu — o caso
-- mais comum de longe — ficava indistinguível de uma que rodou pra valer, e
-- nenhuma tela tinha de onde tirar um selo. Ensaio é propriedade da EXECUÇÃO.
--
-- ---------------------------------------------------------------------------
-- POR QUE O PADRÃO AQUI É 'real', E EM `schedules.modo` É 'ensaio'
-- ---------------------------------------------------------------------------
-- Não é contradição — é o MESMO critério ("qual padrão não mente?") aplicado a
-- duas coisas de naturezas diferentes:
--
--   • `schedules.modo` / `webhook_endpoints.modo` são CONTROLE: decidem o que
--     VAI acontecer, sozinho, de madrugada, sem ninguém olhando. Ali o padrão
--     seguro é 'ensaio', porque agendamento que manda email de verdade na
--     primeira tentativa não dá chance de conferir antes de errar.
--
--   • `agent_runs.modo` é REGISTRO: descreve o que JÁ aconteceu. Aqui o perigo
--     inverte de lado. O selo que a tela desenha a partir desta coluna é uma
--     AFIRMAÇÃO POSITIVA — "isto foi um ensaio, nada saiu pra fora". Carimbar
--     esse selo numa execução antiga que PODE ter mandado email de verdade
--     seria exatamente a mentira que este conserto existe pra matar, só que
--     virada do avesso. Já a AUSÊNCIA de selo não afirma nada: é o que todas
--     as telas mostram hoje.
--
-- `alter table … add column … default` preenche TODA linha que já existe. Ou
-- seja: este `default` é, na prática, o que as execuções ANTIGAS vão dizer de
-- si mesmas. Entre "silêncio" e "juro que nada saiu", silêncio é o honesto.
--
-- E o padrão quase nunca é usado de verdade: os dois únicos lugares que abrem
-- linha em `agent_runs` (`createRun`, em `lib/agents/recorder.ts`, e
-- `open_agent_run_system`, mais abaixo) passam a mandar o valor explícito.
--
-- ---------------------------------------------------------------------------
-- ARMADILHA DAS PERMISSÕES POR COLUNA — CONFERIDA, E AQUI NÃO MORDE
-- ---------------------------------------------------------------------------
-- `credentials` e `webhook_endpoints` dão `grant select (col, col, …)` COLUNA A
-- COLUNA, e lá toda coluna nova nasce invisível (erro 42501) até ser nomeada.
-- `agent_runs` NÃO é assim: a 20260820020000 deu `grant select, insert, update,
-- delete` no NÍVEL DA TABELA (e a 20260820030000 revogou só o `update`).
-- Conferido no banco com `\dp public.agent_runs`: `authenticated=ard/postgres`
-- e a coluna "Column privileges" VAZIA. Permissão de tabela vale pra toda
-- coluna, inclusive as que ainda não existiam — então esta migration não
-- precisa de `grant` nenhum. Se um dia `agent_runs` passar a ter permissão por
-- coluna, esta linha deixa de ser verdade e `modo` some da ponte em silêncio.
-- ---------------------------------------------------------------------------

alter table public.agent_runs
  add column if not exists modo text not null default 'real';

-- Postgres não tem `add constraint if not exists`: derruba antes de criar.
alter table public.agent_runs drop constraint if exists agent_runs_modo_check;
alter table public.agent_runs add constraint agent_runs_modo_check
  check (modo in ('ensaio', 'real'));

comment on column public.agent_runs.modo is
  'Em que modo esta execução rodou. ''ensaio'' = nenhuma ação saiu pra fora (email não foi enviado); ''real'' = as ações aconteceram de verdade. Execução gravada antes desta coluna existir diz ''real'', que é o silêncio — nunca a promessa de que nada saiu.';

-- ---------------------------------------------------------------------------
-- `modo` entra na lista do que NÃO se reescreve depois
-- ---------------------------------------------------------------------------
-- Mesma disciplina do resto do gatilho (20260820020000): rastro que pode ser
-- editado depois não serve como rastro. Um selo de ensaio que alguém consegue
-- virar pra 'real' (ou o contrário) depois do fato não vale nada.
--
-- `update` em `agent_runs` já é proibido pra quem está logado — quem fecha a
-- execução é `finish_agent_run_system`, que mexe em `status`, `output`, tokens,
-- custo e datas, e nunca em `modo`. Então esta linha não fecha porta nenhuma
-- que esteja em uso: ela impede a porta de ser aberta por engano lá na frente.
--
-- `create or replace` puro é seguro aqui: função de gatilho não tem argumento e
-- o tipo de retorno (`trigger`) continua o mesmo — nada de sobrecarga nova nem
-- de "cannot change return type" (a armadilha que mordeu
-- `webhook_endpoint_for_check` e `record_agent_run_step` nesta mesma onda).
create or replace function public.freeze_agent_run_keys()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.agent_slug is distinct from old.agent_slug
     or new.trigger_kind is distinct from old.trigger_kind
     or new.input is distinct from old.input
     or new.modo is distinct from old.modo
     or new.created_at is distinct from old.created_at then
    raise exception 'agent_runs: id, organization_id, agent_slug, trigger_kind, input, modo and created_at are immutable (security)';
  end if;

  -- agent_id só pode ir pra nulo, e só quando o agente realmente sumiu
  -- (on delete set null). Nunca pode apontar pra outro agente.
  if new.agent_id is distinct from old.agent_id then
    if new.agent_id is null
       and old.agent_id is not null
       and not exists (select 1 from public.agents where id = old.agent_id) then
      return new;
    end if;
    raise exception 'agent_runs.agent_id is immutable (security)';
  end if;

  -- Mesma regra pra quem disparou: só vira nulo se a conta foi apagada.
  if new.triggered_by is distinct from old.triggered_by then
    if new.triggered_by is null
       and old.triggered_by is not null
       and not exists (select 1 from auth.users where id = old.triggered_by) then
      return new;
    end if;
    raise exception 'agent_runs.triggered_by is immutable (security)';
  end if;

  return new;
end;
$$;

revoke execute on function public.freeze_agent_run_keys() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- `open_agent_run_system` aprende o modo
-- ---------------------------------------------------------------------------
-- Esta é a porta que abre execução SEM sessão (20260821010000): ela existe pro
-- caminho da automação conseguir registrar até o trabalho que nem chegou a
-- virar sessão ("quem essa automação representa saiu do time"), pra tela de
-- Execuções nunca ter um buraco sem explicação. Nenhum arquivo `.ts` chama ela
-- hoje — o motor abre a linha por `insert` normal, pela ponte —, mas ela abre
-- justamente as execuções de AUTOMAÇÃO, que são as que nascem em ensaio. Uma
-- porta dormente que grava 'real' num ensaio é a mesma mentira, só esperando.
--
-- ⚠️ ARMADILHA 2 (a que já mordeu `webhook_endpoint_for_check` na task 1 e
-- `record_agent_run_step` na task 4): acrescentar um parâmetro muda a lista de
-- TIPOS, e pra Postgres isso é identidade de uma função DIFERENTE. Um
-- `create or replace` com 9 tipos NÃO substitui a de 8 — cria uma SOBRECARGA ao
-- lado dela, e aí o PostgREST recusa a chamada por ambiguidade. Por isso o
-- `drop function if exists` da assinatura ANTIGA COMPLETA vem primeiro.
--
-- ⚠️ E a criação usa `create or replace`, NÃO `create` puro — pelo motivo que a
-- 20260821120000 documentou depois de reproduzir: com `create` puro a segunda
-- aplicação falha ("function already exists with same argument types"), porque
-- o `drop` da assinatura antiga não acha mais nada pra apagar (o banco já está
-- na versão de 9 argumentos) e o `create` recusa recriar o que já existe.
--
-- ⚠️ O `drop` LEVA OS GRANTS JUNTO: função recém-criada volta a ter `EXECUTE`
-- concedido a `PUBLIC` por padrão. O `revoke` no fim deste bloco é o que fecha
-- ela de novo, agora pela assinatura nova.
--
-- ⚠️ `supabase/reset-dev.sql` também foi corrigido no mesmo commit: o `drop`
-- de lá precisa da assinatura NOVA, senão um reset completo não apaga a função
-- (a assinatura antiga não bate com o que está no banco) e o replay do zero
-- quebra com "function already exists".
drop function if exists public.open_agent_run_system(
  uuid, uuid, text, uuid, public.agent_trigger_kind, jsonb, text, uuid
);

create or replace function public.open_agent_run_system(
  _organization_id uuid,
  _agent_id uuid,
  _agent_slug text,
  _triggered_by uuid,
  _trigger_kind public.agent_trigger_kind,
  _input jsonb,
  _model text,
  _thread_id uuid default null,
  -- Todo parâmetro novo precisa de `default`, senão chamada existente pararia
  -- de compilar. O `default` repete o da coluna, e pelo mesmo motivo.
  _modo text default 'real'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_id uuid;
begin
  if _organization_id is null or _agent_slug is null then
    raise exception 'organization and agent slug are required';
  end if;

  insert into public.agent_runs (
    organization_id, agent_id, agent_slug, model,
    triggered_by, trigger_kind, input, status, started_at, thread_id, modo
  )
  values (
    _organization_id, _agent_id, _agent_slug, _model,
    _triggered_by, coalesce(_trigger_kind, 'manual'::public.agent_trigger_kind),
    coalesce(_input, '{}'::jsonb), 'running', now(), _thread_id,
    -- Valor de fora é fechado na marra: só 'ensaio' vira ensaio. Qualquer
    -- outra coisa (nulo, erro de digitação, texto solto) cai em 'real', que é
    -- o silêncio — nunca a promessa de que nada saiu. Sem isto, o `check` da
    -- coluna derrubaria a abertura da execução por causa de um texto torto, e
    -- a automação perderia o rastro inteiro em vez de perder um selo.
    case when _modo = 'ensaio' then 'ensaio' else 'real' end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.open_agent_run_system(
  uuid, uuid, text, uuid, public.agent_trigger_kind, jsonb, text, uuid, text
) from public, anon, authenticated;
