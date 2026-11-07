-- =============================================================================
-- Conserta o "aceitar convite", que nunca funcionou
-- =============================================================================
-- PROBLEMA QUE ISSO RESOLVE:
-- A função que aceita convite devolve uma tabela com uma coluna chamada
-- `organization_id`. Dentro da mesma função existe um comando que grava na
-- tabela de membros usando a coluna `organization_id`. Pro Postgres, os dois
-- nomes são a mesma palavra: ele não sabe se você quis dizer "a coluna" ou "o
-- valor que a função vai devolver", e aborta com
--   column reference "organization_id" is ambiguous
--
-- Ou seja: toda tentativa de aceitar convite falhava, e a tela só dizia
-- "Erro ao aceitar convite".
--
-- A correção é a diretiva `#variable_conflict use_column`, que manda o Postgres
-- entender esses nomes como COLUNA — que é o certo aqui. O resto da função
-- continua idêntico (as variáveis internas começam com `v_`, então nenhuma
-- delas é afetada).
-- =============================================================================

create or replace function public.accept_invitation(_token text)
returns table(organization_id uuid, slug text)
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_invite public.invitations%rowtype;
  v_user_email text;
begin
  select lower(au.email) into v_user_email
  from auth.users au
  where au.id = auth.uid();

  if v_user_email is null then raise exception 'not authenticated'; end if;

  select * into v_invite from public.invitations where token = _token for update;
  if v_invite is null then raise exception 'invitation not found'; end if;
  if v_invite.role = 'owner' then raise exception 'invalid invitation role'; end if;
  if v_invite.accepted_at is not null then raise exception 'invitation already accepted'; end if;
  if v_invite.expires_at < now() then raise exception 'invitation expired'; end if;
  if lower(v_invite.email) <> v_user_email then raise exception 'invitation is for different email'; end if;

  update public.invitations set accepted_at = now() where id = v_invite.id;

  insert into public.memberships (organization_id, user_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role)
  on conflict (organization_id, user_id) do update
    set role = case
      when public.memberships.role = 'member' and excluded.role = 'admin' then 'admin'::public.org_role
      else public.memberships.role
    end;

  return query select o.id, o.slug from public.organizations o where o.id = v_invite.organization_id;
end;
$function$;

revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
