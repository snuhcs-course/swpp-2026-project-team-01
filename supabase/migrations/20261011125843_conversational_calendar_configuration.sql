SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fmat_calendar_access (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_host fmat.hosts; v_connection fmat.calendar_connections; v_conflicts text[]; v_requested text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN'; end if;
  v_actor:=fmat.calendar_actor(p_credential);
  select * into strict v_host from fmat.hosts where id=(v_actor->>'id')::uuid for update;
  select * into v_connection from fmat.calendar_connections where principal_kind='host' and principal_id=v_host.id and revoked_at is null for update;
  if not found then raise exception 'RECONNECT_REQUIRED'; end if;
  if p_operation='read' then
    return jsonb_build_object('connectionId',v_connection.id,'generation',v_connection.generation,'principalId',v_host.id,'encryptedCredential',v_connection.encrypted_credential,
      'rulesVersion',v_host.rules_version,'conflictCalendarIds',to_jsonb(v_host.conflict_calendar_ids),'bookingCalendarId',v_host.booking_calendar_id);
  end if;
  if (p_input->>'connectionId')::uuid is distinct from v_connection.id or (p_input->>'generation')::uuid is distinct from v_connection.generation then raise exception 'REVISION_CONFLICT'; end if;
  if p_operation='check' then return jsonb_build_object('current',true);
  elsif p_operation='refresh' then
    if p_input->>'previousCredential' is distinct from v_connection.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
    if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=v_connection.id;
    return jsonb_build_object('refreshed',true);
  elsif p_operation='select' then
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'REVISION_CONFLICT'; end if;
    if jsonb_typeof(p_input->'conflictCalendarIds') is distinct from 'array' or jsonb_typeof(p_input->'verifiedCalendars') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    select array_agg(distinct value) into v_conflicts from jsonb_array_elements_text(p_input->'conflictCalendarIds');
    if coalesce(cardinality(v_conflicts),0) not between 1 and 50 then raise exception 'INVALID_INPUT'; end if;
    foreach v_requested in array v_conflicts loop
      if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=v_requested and c->>'accessRole' in ('freeBusyReader','reader','writer','writerWithoutPrivateAccess','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    end loop;
    if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=p_input->>'bookingCalendarId' and c->>'accessRole' in ('writer','writerWithoutPrivateAccess','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    update fmat.hosts set conflict_calendar_ids=v_conflicts,booking_calendar_id=p_input->>'bookingCalendarId',rules_version=rules_version+1,updated_at=clock_timestamp() where id=v_host.id returning * into v_host;
    perform fmat.audit('calendar_save',v_actor,v_host.id::text);
    return jsonb_build_object('saved',true,'rulesVersion',v_host.rules_version);
  end if;
  raise exception 'FORBIDDEN';
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_calendar (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_session_id      text,
  p_message_id      uuid,
  p_operation       text,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_access jsonb;v_scope fmat.conversation_scopes;v_grant fmat.conversation_grants;
 v_receipt fmat.idempotency;v_actor_scope text;v_key text;v_result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 select * into strict v_scope from fmat.conversation_scopes where id=p_conversation_id;
 perform fmat.require_runtime_generation(v_scope,p_session_id,true);
 select * into strict v_grant from fmat.conversation_grants where id=p_grant_id;
 if v_access->>'audience' is distinct from 'host_setup' or v_access->'actor'->>'kind' is distinct from 'host'
  or v_grant.credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from fmat.runtime_messages where id=p_message_id and conversation_id=p_conversation_id and grant_id=p_grant_id and status='pending') then raise exception 'UNAUTHORIZED';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation in ('replay','select') then
  if jsonb_typeof(p_input->'choice') is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
  v_actor_scope:='host:'||v_scope.host_id::text;v_key:='calendar:'||p_message_id::text;
  select * into v_receipt from fmat.idempotency where actor_scope=v_actor_scope and operation='conversation_calendar_select' and key=v_key for update;
  if found then
   if v_receipt.input is distinct from p_input->'choice' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return v_receipt.result;
  end if;
  if p_operation='replay' then return 'null'::jsonb;end if;
  v_result:=public.fmat_calendar_access('select',v_grant.credential,p_input->'selection');
  insert into fmat.idempotency(actor_scope,operation,key,input,result) values(v_actor_scope,'conversation_calendar_select',v_key,p_input->'choice',v_result);
  return v_result;
 elsif p_operation in ('read','check','refresh') then
  return public.fmat_calendar_access(p_operation,v_grant.credential,p_input);
 end if;
 raise exception 'FORBIDDEN';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_calendar"(uuid, uuid, text, uuid, text, jsonb) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fmat_conversation_calendar"(uuid, uuid, text, uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_calendar"(uuid, uuid, text, uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_calendar"(uuid, uuid, text, uuid, text, jsonb) TO "service_role";
