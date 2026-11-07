-- =============================================================================
-- Quem foi convidado consegue ver o nome do workspace pra onde foi chamado
-- =============================================================================
-- PROBLEMA QUE ISSO RESOLVE:
-- A tela de aceitar convite mostra "Você foi convidado para <nome do
-- workspace>". Só que a pessoa convidada ainda NÃO é membro, e a única regra
-- de leitura de organizações exigia ser membro. Resultado: o nome vinha vazio
-- e a tela quebrava com "Algo deu errado" bem no meio do fluxo de convite.
--
-- Esta regra libera a leitura APENAS da organização em que a pessoa tem um
-- convite pendente e dentro da validade — e só do que a tela precisa mostrar.
-- Assim que o convite é aceito, ela passa a ler como membro normal.
-- =============================================================================

drop policy if exists "invited users read the org of their invitation" on public.organizations;

create policy "invited users read the org of their invitation"
  on public.organizations for select
  to authenticated
  using (
    exists (
      select 1
      from public.invitations i
      where i.organization_id = organizations.id
        and lower(i.email) = public.current_user_email()
        and i.accepted_at is null
        and i.expires_at > now()
    )
  );
