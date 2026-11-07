-- ---------------------------------------------------------------------------
-- Aposentar uma base de conhecimento
-- ---------------------------------------------------------------------------
--
-- O BURACO QUE ISTO FECHA. Desde que definição passou a nascer de arquivo
-- (regra 10-N), o agente ganhou `status: "archived"` como jeito de ser
-- aposentado — e a base de conhecimento não ganhou equivalente nenhum.
-- Resultado medido no navegador: a tela da base dizia, com todas as letras,
-- "não existe caminho pra apagar uma base". Quem declarasse uma base com o
-- apelido errado ficava com ela na lista pra sempre.
--
-- E não dava pra contornar: o apelido e o modelo de leitura são CONGELADOS por
-- gatilho assim que a base nasce (regra 10-I), a tela de criar/editar foi
-- removida de propósito, e base — diferente de agendamento e webhook — não tem
-- agente dono cujo `archived` a desligaria por tabela.
--
-- POR QUE `text` + CHECK, E NÃO O ENUM `agent_status` QUE JÁ EXISTE:
-- aquele enum tem três valores ('draft', 'active', 'archived') e 'draft' não
-- quer dizer nada pra uma base. Reaproveitar traria um valor sem significado
-- que a tela teria que esconder. E criar um enum novo compartilhado obrigaria
-- a migrar a coluna dos agentes junto — mudança destrutiva numa tabela que já
-- está em produção, pra ganhar arrumação. `text` + CHECK diz a mesma coisa,
-- roda duas vezes sem quebrar, e não encosta em ninguém.
--
-- ⚠️ `status` NÃO é congelado pelo gatilho `freeze_knowledge_base_slug`, e é
-- de propósito: aposentar e voltar atrás são as duas operações que precisam
-- funcionar. Quem congela é `slug` e `embedding_model` — esses sim, mudar
-- depois faz a busca devolver trecho aleatório em silêncio.

alter table public.knowledge_bases
  add column if not exists status text not null default 'active';

-- Postgres não tem `add constraint if not exists`: derruba antes de criar, pra
-- a migration poder rodar duas vezes (regra 9).
alter table public.knowledge_bases
  drop constraint if exists knowledge_bases_status_check;
alter table public.knowledge_bases
  add constraint knowledge_bases_status_check check (status in ('active', 'archived'));

comment on column public.knowledge_bases.status is
  'active | archived. Aposentada some da busca do agente e não aceita documento novo, mas o que já foi indexado fica no lugar. Quem decide é o ARQUIVO (lib/seed/registro.ts), não a tela.';
