-- =============================================================================
-- Permissões de tabela pros papéis do Supabase (authenticated / service_role)
-- =============================================================================
-- POR QUE ISSO EXISTE:
-- RLS (policies) diz QUAIS LINHAS cada pessoa pode ver. Mas antes da RLS o
-- Postgres checa uma camada mais grossa: se o papel tem permissão de tocar na
-- tabela. Projetos Supabase antigos davam essa permissão automaticamente. Nas
-- versões atuais do Postgres da Supabase isso não acontece mais quando a tabela
-- é criada pelo papel `postgres` (que é quem roda as migrations).
--
-- Sem isso, toda consulta volta com "permission denied for table X" (código
-- 42501) mesmo com as policies certas.
--
-- SEGURANÇA: dar esse GRANT não abre o banco. Todas as tabelas continuam com
-- RLS habilitada, então cada pessoa continua vendo só as linhas da própria
-- organização. `anon` (visitante deslogado) fica de fora de propósito.
-- =============================================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

grant usage, select
  on all sequences in schema public
  to authenticated, service_role;

-- Vale também pras tabelas que você criar daqui pra frente, pra não precisar
-- lembrar de dar GRANT toda vez.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
