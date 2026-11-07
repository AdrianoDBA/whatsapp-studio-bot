-- A função que descobre "quem é o dono" pra `npm run semear` impersonar.
--
-- PROBLEMA DO OVO-E-A-GALINHA: pra ler `memberships` pela ponte
-- (`lib/automation/postgrest-bridge.ts`), o cliente do Supabase já precisa
-- estar impersonando ALGUÉM — é `auth.uid()` que a RLS de `memberships`
-- exige. `npm run semear` ainda não sabe quem impersonar quando começa: é
-- exatamente esse dado que falta.
--
-- A REGRA 10-G (`CLAUDE.md` raiz) E POR QUE ISSO NÃO A VIOLA
-- ------------------------------------------------------------
-- A regra proíbe consulta SOLTA por `systemPool()` e exige "só chamando
-- função com nome". Uma função nomeada, SÓ DE LEITURA, entrando na MESMA
-- lista fechada que já existe em `lib/automation/queue.ts`, é exatamente o
-- padrão que a regra descreve — não uma exceção a ela. O que a regra impede
-- (ler dado do aluno por fora da regra de segurança, pra decidir o que fazer
-- com ele) continua impedido: esta função não decide nada e não grava nada.
-- A materialização em si (o `insert`/`update` de agente, base, agendamento e
-- webhook) continua indo pela ponte, como `authenticated` — as MESMAS regras
-- de segurança do banco valem, exatamente como valem pra um trabalho da fila.
--
-- ESTREITA DE PROPÓSITO: devolve as linhas CRUAS de `role = 'owner'` daquele
-- workspace (ou de todos, quando `_organization_id` é nulo) e mais nada. Zero
-- lógica, zero escolha. Quem decide o que fazer com 0 ou 2+ linhas é o
-- TypeScript de `scripts/semear.mjs`/`app/api/internal/semear/route.ts` — e a
-- decisão lá é: nunca adivinhar, sempre pular e registrar (mesmo padrão de
-- `ResultadoDaSemeadura.agendamentosPulados`, de `lib/seed/materializar.ts`).
--
-- ⚠️ NÃO existe garantia de banco de "no máximo um dono por workspace" — só
-- de "PELO MENOS um" (gatilho `assert_at_least_one_owner`,
-- `20260525000015_security_hardening_b.sql`). Dois owners no mesmo workspace
-- não deveria acontecer (o único caminho pra virar dono é
-- `transfer_ownership`, que promove um e rebaixa o outro na MESMA transação;
-- convite nunca oferece `role: "owner"`) — mas como a policy de INSERT
-- ("owners create any membership") não impede tecnicamente uma segunda linha
-- com `role = 'owner'`, o caso é tratado, não descartado.
--
-- 🔴 RODADA DE CONSERTO 1 (I2): `left join` a partir de `organizations`, não
-- um `select` direto em `memberships`. Sem o `left join`, um workspace com
-- ZERO donos simplesmente NÃO APARECE na resposta — nem como linha "sem
-- dono nenhum", nem de jeito nenhum. Na varredura completa (sem
-- `_organization_id`, o modo que o deploy usa) isso faz o workspace órfão
-- SUMIR da conta em silêncio: `semearWorkspaces()` nunca vê a chave dele e
-- nunca registra `workspacesPulados`. Com o `left join`, todo workspace
-- relevante devolve PELO MENOS uma linha — com `user_id null` quando não tem
-- dono — e o TypeScript (`lib/seed/semear.ts`) decide o que fazer com isso.
-- Continua ESTREITA: ainda é um `select` só, ainda zero lógica, zero escrita.
--
-- Postgres não tem `create function if not exists`: derrube antes de criar
-- (mesma armadilha do `grant`/`policy`, regra 9 do CLAUDE.md raiz).
drop function if exists public.owner_memberships_for_seed(uuid);
create or replace function public.owner_memberships_for_seed(_organization_id uuid default null)
returns table (organization_id uuid, user_id uuid)
language sql
security definer
stable
set search_path = public, pg_temp
set row_security = off
as $$
  select o.id as organization_id, m.user_id
    from public.organizations o
    left join public.memberships m
      on m.organization_id = o.id and m.role = 'owner'
   where (_organization_id is null or o.id = _organization_id)
   order by o.id, m.user_id;
$$;

-- Igual a `webhook_endpoint_for_check`: revogado de TODO mundo que entra
-- logado ou anônimo. Só o papel `postgres` (via `systemPool()`, só em
-- `queue.ts`) alcança.
revoke execute on function public.owner_memberships_for_seed(uuid) from public, anon, authenticated;
