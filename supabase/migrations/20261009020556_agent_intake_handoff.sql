SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fmat_oauth_intake_handoff (
  p_id           uuid,
  p_browser_hash text,
  p_resource     text,
  p_proof_hash   text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i fmat.oauth_intakes; a fmat.oauth_grants; h fmat.hosts; c fmat.oauth_clients; r fmat.requests;
begin
 if p_browser_hash is null or p_browser_hash !~ '^[a-f0-9]{64}$'
  or (p_proof_hash is not null and p_proof_hash !~ '^[a-f0-9]{64}$') then return '{"error":"invalid_request"}';end if;
 select * into i from fmat.oauth_intakes where authorization_id=p_id for update;
 if not found or i.browser_hash is distinct from p_browser_hash or i.grant_id is null or i.revoked_at is not null then return '{"error":"invalid_grant"}';end if;
 select * into a from fmat.oauth_grants where id=i.grant_id;
 if not found or a.resource is distinct from p_resource then return '{"error":"invalid_grant"}';end if;
 a:=fmat.oauth_lock_grant(i.grant_id);
 if a.id is null then return '{"error":"invalid_grant"}';end if;
 if p_proof_hash is not null and (i.request_id is null or p_proof_hash is distinct from i.token_hash) then return '{"error":"invalid_grant"}';end if;
 select * into h from fmat.hosts where id=i.host_id;
 select * into c from fmat.oauth_clients where id=a.client_id;
 if i.request_id is not null then select * into r from fmat.requests where id=i.request_id;end if;
 if a.expires_at<=clock_timestamp() or not fmat.oauth_authority_current(a) then
  perform fmat.oauth_lock_grant(i.grant_id);return '{"error":"invalid_grant"}';
 end if;
 return jsonb_build_object('intakeId',i.id,'state',case when i.request_id is null then 'pending' else 'bound' end,
  'clientName',c.name,'hostName',h.display_name,'scope',a.scope,'requestId',i.request_id,
  'expiresAt',case when i.request_id is null then least(i.create_expires_at,a.expires_at) else least(a.expires_at,r.expires_at,r.token_expires_at) end,
  'tokenExpiresAt',r.token_expires_at);
end$function$;

REVOKE ALL ON FUNCTION "public"."fmat_oauth_intake_handoff"(uuid, text, text, text) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fmat_oauth_intake_handoff"(uuid, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_intake_handoff"(uuid, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_oauth_intake_handoff"(uuid, text, text, text) TO "service_role";
