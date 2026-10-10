SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE OR REPLACE FUNCTION public.fmat_browser_command (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_state jsonb; v_request uuid;
begin
  if p_operation='waitlist_join' then
    return public.fmat_command('waitlist_join','{"kind":"public"}'::jsonb,p_input);
  elsif p_operation='guest_state' then
    if p_credential->>'kind' is distinct from 'guest' then raise exception 'UNAUTHORIZED'; end if;
    v_request:=(p_credential->>'requestId')::uuid;
    v_actor:=jsonb_build_object('kind','guest','requestId',v_request,'tokenHash',p_credential->>'tokenHash');
    v_state:=public.fmat_command('request_read',v_actor,jsonb_build_object('requestId',v_request));
    return jsonb_build_object('requestId',v_request,'status',v_state->>'status','closed',coalesce((v_state->>'receipt')::boolean,false),
      'title',case when coalesce((v_state->>'receipt')::boolean,false) then null else v_state->'details'->>'purpose' end,
      'proposal',case when v_state->'proposal' is null or v_state->'proposal'='null'::jsonb then null else
        jsonb_build_object('start',v_state->'proposal'->>'start','end',v_state->'proposal'->>'end','timezone',v_state->'proposal'->>'timezone',
          'location',coalesce(v_state->'proposal'->>'location',''),'mode',coalesce(v_state->'proposal'->>'mode','online')) end);
  end if;
  if p_operation not in ('host_state','invite_redeem') or p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN'; end if;
  perform 1 from auth.users where id=(p_credential->>'subject')::uuid for share;
  perform 1 from auth.sessions where id=(p_credential->>'sessionId')::uuid for share;
  v_actor:=fmat.credential_actor(p_credential);
  if exists(select 1 from auth.sessions where id=(p_credential->>'sessionId')::uuid and not_after<=clock_timestamp()) then raise exception 'UNAUTHORIZED'; end if;
  if p_operation='invite_redeem' then v_state:=public.fmat_command('invite_redeem',v_actor,p_input);
  else v_state:=public.fmat_command('setup_read',v_actor,'{}'::jsonb); end if;
  return jsonb_build_object('email',v_actor->>'email','admitted',v_state->'admitted','profile',v_state->'profile',
    'calendarConnected',v_state->'calendarConnected','nextAction',v_state->>'nextAction');
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_browser_command"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

REVOKE ALL ON FUNCTION "public"."fmat_browser_command"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_browser_command"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_browser_command"(text, jsonb, jsonb) TO "service_role";
