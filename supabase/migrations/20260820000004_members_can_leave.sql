-- =============================================================================
-- Deixa a pessoa sair de um workspace por conta própria
-- =============================================================================
-- PROBLEMA QUE ISSO RESOLVE:
-- O botão "sair do workspace" existia na tela, mas as regras de segurança só
-- deixavam dono e admin remover alguém. Um membro comum clicava, o banco
-- ignorava em silêncio e a tela dizia que tinha dado certo.
--
-- Dono continua não podendo sair sem antes passar a propriedade pra outra
-- pessoa — senão o workspace ficaria sem responsável.
-- =============================================================================

-- `drop` antes de `create` porque o Postgres não tem "create policy if not
-- exists". Sem isso, reaplicar este arquivo dá erro.
drop policy if exists "members delete their own membership" on public.memberships;

create policy "members delete their own membership"
  on public.memberships for delete
  to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner');
