SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE OR REPLACE FUNCTION public.fmat_conversation_check (
  p_grant_id        uuid,
  p_conversation_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_scope fmat.conversation_scopes; v_grant fmat.conversation_grants; v_writable boolean;
begin
  select * into v_grant from fmat.conversation_grants where id=p_grant_id and conversation_id=p_conversation_id;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
  select * into v_scope from fmat.conversation_scopes where id=v_grant.conversation_id;
  -- Match request-command lock order. Keep revocation and the eventual tool
  -- effect serialized in this transaction, including an idempotent replay.
  perform 1 from fmat.requests where id=v_scope.request_id for update;
  perform 1 from fmat.hosts where id=v_scope.host_id for share;
  if v_grant.actor_kind='host' then
    perform 1 from auth.users where id=(v_grant.credential->>'subject')::uuid for share;
    perform 1 from auth.sessions where id=(v_grant.credential->>'sessionId')::uuid for share;
  end if;
  select * into v_scope from fmat.conversation_scopes where id=p_conversation_id for share;
  select * into v_grant from fmat.conversation_grants where id=p_grant_id and conversation_id=p_conversation_id for share;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
  v_actor:=fmat.credential_actor(v_grant.credential);
  v_writable:=fmat.authorize_conversation(v_scope,v_actor);
  -- A transaction may have waited for another writer. Recheck time-based
  -- authority against wall time after locks, not its earlier transaction time.
  if v_grant.actor_kind='host' and exists(select 1 from auth.sessions
    where id=(v_grant.credential->>'sessionId')::uuid and not_after<=clock_timestamp()) then raise exception 'UNAUTHORIZED'; end if;
  if exists(select 1 from fmat.requests where id=v_scope.request_id and status<>'booking' and expires_at<=clock_timestamp()) then
    if v_grant.actor_kind='guest' then raise exception 'REQUEST_EXPIRED'; end if;
    v_writable:=false;
  end if;
  return fmat.conversation_projection(v_scope,v_grant,v_writable)||jsonb_build_object('actor',v_actor);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_tool (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_operation       text,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_access jsonb; v_actor jsonb; v_input jsonb; v_result jsonb; v_request_id uuid;
begin
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  v_actor:=v_access->'actor'; v_request_id:=(v_access->>'requestId')::uuid;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  case p_operation
  when 'setup_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return public.fmat_command('setup_read',v_actor,'{}');
  when 'request_read' then
    if v_request_id is null then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    -- Host identity does not make a shared conversation private. Project for
    -- the audience at the database boundary before any model sees the result.
    return fmat.request_view(v_request_id,case when v_access->>'audience'='request_shared' then '{"kind":"guest"}'::jsonb else v_actor end);
  when 'private_note_save' then
    if v_access->>'audience'<>'host_private' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('text','expectedRevision','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(p_input->'text') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  when 'details_update' then
    if v_access->>'audience'<>'request_shared' then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('details','expectedRevision','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(p_input->'details') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(p_input->'details') k where k not in ('requesterName','requesterEmail','purpose','durationMinutes','timezone','windows','mode','location')) then raise exception 'INVALID_INPUT'; end if;
  else
    -- Approval, agreement, confirmed settings, travel exceptions and worker or
    -- provider outcomes require separate authored application operations.
    raise exception 'FORBIDDEN';
  end case;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number'
    or (p_input->>'expectedRevision') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  v_input:=p_input||jsonb_build_object('requestId',v_request_id);
  v_result:=public.fmat_command(p_operation,v_actor,v_input);
  if v_access->>'audience'='request_shared' then
    -- Also scrub cached idempotency results; these may have been produced by
    -- the host's same command from a private application surface.
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_result from jsonb_each(v_result)
      where key=any(array['id','hostId','revision','status','details','candidates','proposal','requesterAgreed','hostApproved','contactVerified','calendarConnected','event','messages','nextAction','receipt']);
  end if;
  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

REVOKE ALL ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb) TO "service_role";
