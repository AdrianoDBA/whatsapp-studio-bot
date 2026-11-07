-- =============================================================================
-- Fecha o buraco do "ex-dono que volta sozinho"
-- =============================================================================
-- PROBLEMA QUE ISSO RESOLVE:
-- Quando a criação de organização passou a ser feita por uma função do banco
-- (create_organization_with_owner), duas permissões antigas ficaram sobrando.
-- Uma delas deixava qualquer pessoa se inserir como DONA de uma organização
-- que ela mesma tivesse criado um dia. Ou seja: você remove um sócio da
-- empresa, e ele consegue voltar como dono chamando a API na mão — pra sempre,
-- porque o campo "quem criou" nunca muda.
--
-- Nada do app usa essas permissões: a criação de organização passa pela função
-- do banco, que já coloca o criador como dono.
-- =============================================================================

drop policy if exists "creator inserts initial owner membership" on public.memberships;
drop policy if exists "creators read their orgs" on public.organizations;

-- Também tiramos a permissão de criar organização escrevendo direto na tabela.
-- Sem as duas de cima, um insert direto criaria uma organização "órfã", que
-- nem quem criou consegue enxergar. O caminho certo é a função
-- create_organization_with_owner, que é o que o app usa.
drop policy if exists "any authenticated user creates an org" on public.organizations;
