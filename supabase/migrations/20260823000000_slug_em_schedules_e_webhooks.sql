-- A chave estável das definições que agora nascem de arquivo.
--
-- `agents` e `knowledge_bases` já tinham `slug` porque sempre tiveram apelido
-- na URL. `schedules` e `webhook_endpoints` não tinham: até aqui elas só
-- nasciam de formulário, então nunca precisaram de nome estável.
--
-- 🔴 NULLABLE DE PROPÓSITO, e é por isso que o índice é PARCIAL.
-- As linhas que já existem nos bancos dos alunos foram criadas pelo painel e
-- não têm arquivo correspondente. `slug is null` passa a ser a marca exata de
-- LINHA ÓRFÃ: o materializador nunca a encontra e nunca a toca. Um `not null`
-- com valor inventado no backfill faria o oposto — entregaria a linha órfã ao
-- primeiro arquivo que sorteasse o mesmo apelido.

alter table public.schedules add column if not exists slug text;
alter table public.webhook_endpoints add column if not exists slug text;

comment on column public.schedules.slug is
  'Apelido da declaração em código. Nulo = linha criada à mão, que o materializador nunca toca.';
comment on column public.webhook_endpoints.slug is
  'Apelido da declaração em código. Nulo = linha criada à mão, que o materializador nunca toca.';

-- Postgres não tem `add constraint if not exists`: derrube antes de criar.
alter table public.schedules drop constraint if exists schedules_slug_format;
alter table public.schedules
  add constraint schedules_slug_format
  check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60));

alter table public.webhook_endpoints drop constraint if exists webhook_endpoints_slug_format;
alter table public.webhook_endpoints
  add constraint webhook_endpoints_slug_format
  check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60));

create unique index if not exists schedules_org_slug_uidx
  on public.schedules (organization_id, slug) where slug is not null;
create unique index if not exists webhook_endpoints_org_slug_uidx
  on public.webhook_endpoints (organization_id, slug) where slug is not null;

-- ⚠️ ARMADILHA DAS PERMISSÕES POR COLUNA, DE NOVO (ver
-- 20260821010000_automacao_fila.sql e 20260821110000_agente_que_age.sql).
-- Em `schedules` o `grant select/insert/update/delete` é da TABELA INTEIRA
-- (20260821010000_automacao_fila.sql), então `slug` já está coberto lá — não
-- mexa. Em `webhook_endpoints` o `insert` é de tabela inteira, mas `select` e
-- `update` são COLUNA A COLUNA: toda coluna nova nasce INVISÍVEL até entrar
-- nesses `grant`, sem exceção — sem esta linha, ler `slug` de volta (inclusive
-- pela ponte da automação, que conecta como `authenticated`) falha em tempo de
-- EXECUÇÃO com "permission denied for column slug" (42501), não em teste.
grant select (slug) on public.webhook_endpoints to authenticated;

-- 🔴 DE PROPÓSITO SEM `grant update (slug)`. `slug` é a IDENTIDADE que o
-- materializador usa pra decidir "essa linha já existe" (upsert por
-- `(organization_id, slug)`). Se o app pudesse trocar o apelido depois de
-- criado, uma linha gerenciada por arquivo viraria linha órfã em silêncio na
-- próxima materialização — o arquivo que a criou deixaria de reconhecê-la, e
-- ela ficaria pra trás como se ninguém mais fosse dono dela. Quem quer outro
-- apelido declara outro webhook; não renomeia o existente.
