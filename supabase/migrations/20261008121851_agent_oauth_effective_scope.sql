SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fmat_oauth_grant_check (
  p_id         uuid,
  p_client_id  uuid,
  p_resource   text,
  p_actor_kind text,
  p_actor_id   uuid,
  p_scope      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_grant fmat.oauth_grants;
begin
  v_grant:=fmat.oauth_lock_grant(p_id);
  if v_grant.id is null or v_grant.client_id is distinct from p_client_id or v_grant.resource is distinct from p_resource
    or v_grant.actor_kind is distinct from p_actor_kind or v_grant.actor_id is distinct from p_actor_id
    or not fmat.oauth_scope_valid(p_scope) or not(string_to_array(p_scope,' ') <@ string_to_array(v_grant.scope,' ')) then return '{"error":"invalid_grant"}';end if;
  -- Preserve the verified token's narrower scope in the authorized result.
  return fmat.oauth_grant_projection(v_grant)||jsonb_build_object('scope',p_scope);
end$function$;

