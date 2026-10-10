SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fmat_oauth_grant_revoke (
  p_id         uuid,
  p_credential jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor fmat.oauth_grants; v_grant fmat.oauth_grants;
begin
  v_actor:=fmat.oauth_browser_authority(p_credential);
  if v_actor.actor_id is null then return '{"error":"invalid_grant"}';end if;
  select * into v_grant from fmat.oauth_grants where id=p_id for update;
  if not found or v_grant.actor_kind is distinct from v_actor.actor_kind or v_grant.actor_id is distinct from v_actor.actor_id then return '{"error":"invalid_grant"}';end if;
  if not fmat.oauth_authority_current(v_actor) or v_actor.expires_at<=clock_timestamp()
    or (v_actor.actor_kind='host' and (p_credential->>'expiresAt')::timestamptz<=clock_timestamp()) then return '{"error":"invalid_grant"}';end if;
  update fmat.oauth_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id;
  return '{"revoked":true}';
end$function$;

