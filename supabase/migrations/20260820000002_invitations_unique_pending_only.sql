-- =============================================================================
-- Permite reconvidar quem já foi membro
-- =============================================================================
-- PROBLEMA QUE ISSO RESOLVE:
-- A trava que impedia convite duplicado contava também os convites JÁ ACEITOS.
-- Resultado: funcionário entra, sai da empresa, e quando você tenta convidar
-- de novo o app diz "esse email já foi convidado" — mas não aparece convite
-- nenhum na lista pra você cancelar. Beco sem saída permanente.
--
-- Agora a trava vale só pros convites PENDENTES, que é a intenção original.
-- =============================================================================

drop index if exists public.invitations_org_email_lower_key;

create unique index if not exists invitations_org_email_pending_key
  on public.invitations (organization_id, lower(email))
  where accepted_at is null;
