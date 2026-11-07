-- =============================================================================
-- Para de expor o token dos convites pra membros comuns
-- =============================================================================
-- PROBLEMA QUE ISSO RESOLVE:
-- Sobrou uma permissão antiga que deixava QUALQUER membro da organização ler
-- todas as linhas da tabela de convites — inclusive a coluna `token`, que é o
-- segredo do link de aceite, e a lista de quem está sendo convidado.
--
-- Trocamos por uma permissão equivalente, mas restrita a dono e admin, que são
-- quem de fato gerencia convites (é o único lugar do app que mostra a lista).
--
-- ATENÇÃO PRA QUEM FOR MEXER AQUI:
-- Não dá pra simplesmente APAGAR essa permissão de leitura. Quando o app cria
-- um convite ele pede o token de volta na mesma operação, e o banco só devolve
-- a linha se quem escreveu também puder LÊ-LA. Sem uma permissão de leitura
-- pro dono, criar convite passa a falhar com "violates row-level security".
-- =============================================================================

drop policy if exists "members read invitations of their orgs" on public.invitations;

drop policy if exists "owners and admins read invitations" on public.invitations;

create policy "owners and admins read invitations"
  on public.invitations for select
  to authenticated
  using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );
