-- ============================================================================
-- A busca na base de conhecimento passa a somar no medidor — com segurança.
--
-- O QUE ACONTECIA: transformar a pergunta em números custa dinheiro, e esse
-- custo não entrava no medidor. Eu tinha "consertado" chamando `org_ai_spend_add`
-- direto do código da busca — e ela é inalcançável por quem está logado, de
-- propósito: se qualquer pessoa pudesse somar no medidor, somaria um valor
-- gigante e travaria os agentes do workspace até virar o mês.
--
-- Resultado do meu conserto errado: `permission denied for function
-- org_ai_spend_add`, engolido por um log. O custo continuava invisível.
--
-- AGORA: uma função própria, que confere o pertencimento ao workspace e
-- CALCULA o valor a partir dos tokens — não aceita valor pronto. É o mesmo
-- raciocínio do `record_agent_run_step`: número que vem de fora tem teto.
-- ============================================================================

create or replace function public.org_ai_spend_add_embedding(
  _organization_id uuid,
  _tokens integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_tokens bigint;
  v_micros bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_org_member(_organization_id) then
    raise exception 'not a member of this organization';
  end if;

  -- Uma busca transforma UMA pergunta em números. A pergunta é cortada em
  -- 2.000 caracteres antes de sair do app, o que dá umas 500 fichas — 20 mil
  -- é folga com sobra, e impede alguém de alegar um número absurdo.
  v_tokens := least(greatest(coalesce(_tokens, 0), 0), 20000);
  if v_tokens = 0 then
    return;
  end if;

  -- O valor sai DAQUI, não de quem chamou. O embedding mais caro do catálogo
  -- custa US$ 0,15 por milhão de tokens; usamos US$ 0,20 pra ter folga.
  v_micros := ceil((v_tokens::numeric * 200000) / 1000000)::bigint;

  perform public.org_ai_spend_add(_organization_id, 0::bigint, v_micros, 0, 0);
end;
$$;

revoke execute on function public.org_ai_spend_add_embedding(uuid, integer)
  from public, anon;
grant execute on function public.org_ai_spend_add_embedding(uuid, integer)
  to authenticated;

comment on function public.org_ai_spend_add_embedding(uuid, integer) is
  'Soma no medidor o custo de transformar uma pergunta em números. Calcula o valor a partir dos tokens — não aceita valor pronto.';
