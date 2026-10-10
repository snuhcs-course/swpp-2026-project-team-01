SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

ALTER TABLE "fmat"."calendar_connections"
  ADD COLUMN "generation" uuid NOT NULL DEFAULT gen_random_uuid();

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
  select * into strict v_host from fmat.hosts where id=(v_actor->>'id')::uuid;
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

REVOKE ALL ON FUNCTION "public"."fmat_calendar_access"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_calendar_consent (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_credential jsonb; v_exchange fmat.oauth_exchanges; v_connection fmat.calendar_connections;
  v_result jsonb; v_kind text; v_principal uuid; v_return text; v_scopes text[]; v_revision integer;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  if p_operation in ('consume','save') then
    if p_operation='consume' then select * into v_exchange from fmat.oauth_exchanges where state_hash=p_input->>'stateHash';
    else select * into v_exchange from fmat.oauth_exchanges where id=(p_input->>'exchangeId')::uuid; end if;
    if not found or v_exchange.bound_credential is null then raise exception 'OAUTH_STATE_INVALID'; end if;
    v_credential:=v_exchange.bound_credential;
  else v_credential:=p_credential; end if;
  -- Lock authority before consent rows, matching request/host command order.
  v_actor:=fmat.calendar_actor(v_credential);
  v_kind:=v_actor->>'kind';v_principal:=coalesce(v_actor->>'id',v_actor->>'requestId')::uuid;
  v_return:=case when v_kind='host' then '/app' else '/booking/'||v_principal::text end;
  if p_operation='start' then
    if coalesce(p_input->>'stateHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'bindingHash','') !~ '^[a-f0-9]{64}$'
      or length(coalesce(p_input->>'encryptedVerifier','')) not between 20 and 16384 then raise exception 'INVALID_INPUT'; end if;
    if (select count(*) from fmat.oauth_exchanges where actor->>'kind'=v_kind and coalesce(actor->>'id',actor->>'requestId')=v_principal::text and created_at>clock_timestamp()-interval '10 minutes')>=10 then raise exception 'CONSENT_LIMIT'; end if;
    -- A newer start or disconnect must fence an older in-flight callback.
    update fmat.oauth_exchanges set expires_at=least(expires_at,clock_timestamp()),encrypted_verifier=null
      where actor->>'kind'=v_kind and coalesce(actor->>'id',actor->>'requestId')=v_principal::text and saved_at is null;
    v_result:=fmat.onboarding_command('oauth_start',v_actor,p_input||jsonb_build_object('context',
      jsonb_build_object('redirectUri',p_input->>'redirectUri','returnPath',v_return)||case when v_kind='guest' then jsonb_build_object('requestId',v_principal) else '{}'::jsonb end));
    update fmat.oauth_exchanges set bound_credential=v_credential where id=(v_result->>'exchangeId')::uuid;
    return jsonb_build_object('started',true);
  elsif p_operation in ('consume','save') then
    select * into strict v_exchange from fmat.oauth_exchanges where id=v_exchange.id for update;
    if v_exchange.expires_at<=clock_timestamp() or v_exchange.saved_at is not null then raise exception 'OAUTH_STATE_INVALID'; end if;
    if p_operation='consume' then
      if v_exchange.binding_hash is distinct from p_input->>'bindingHash' or v_exchange.consumed_at is not null then raise exception 'OAUTH_STATE_INVALID'; end if;
      update fmat.oauth_exchanges set consumed_at=clock_timestamp() where id=v_exchange.id;
      return jsonb_build_object('exchangeId',v_exchange.id,'kind',v_kind,'principalId',v_principal,'returnPath',v_return,
        'redirectUri',v_exchange.context->>'redirectUri','encryptedVerifier',v_exchange.encrypted_verifier);
    end if;
    if v_exchange.consumed_at is null then raise exception 'OAUTH_STATE_INVALID'; end if;
    select array_agg(value) into v_scopes from jsonb_array_elements_text(p_input->'scopes');
    if v_kind='guest' and exists(select 1 from unnest(v_scopes) s where s not in ('openid','email','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar.freebusy')) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    v_result:=fmat.onboarding_request_dispatch('credential_save','{"kind":"worker","id":"calendar-consent"}',p_input);
    update fmat.calendar_connections set generation=gen_random_uuid(),guest_authority_key=case when v_kind='guest' then v_credential->>'tokenHash' else null end where id=(v_result->>'connectionId')::uuid;
    return jsonb_build_object('connected',true);
  elsif p_operation='disconnect' then
    if v_kind='host' then perform fmat.onboarding_command('calendar_disconnect',v_actor,'{}');
    else
      select revision into v_revision from fmat.requests where id=v_principal;
      perform fmat.request_command('request_calendar_disconnect',v_actor,jsonb_build_object('requestId',v_principal,'expectedRevision',v_revision));
    end if;
  elsif p_operation<>'status' then raise exception 'FORBIDDEN'; end if;
  select * into v_connection from fmat.calendar_connections where principal_kind=v_kind and principal_id=v_principal and revoked_at is null;
  return jsonb_build_object('connected',coalesce(v_connection.id is not null and (v_kind='host' or v_connection.guest_authority_key=v_credential->>'tokenHash'),false),
    'kind',v_kind,'selected',case when v_kind='host' then exists(select 1 from fmat.hosts where id=v_principal and cardinality(conflict_calendar_ids)>0 and booking_calendar_id is not null) else false end);
end;
$function$;

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

REVOKE ALL ON FUNCTION "public"."fmat_calendar_access"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_calendar_access"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_calendar_access"(text, jsonb, jsonb) TO "service_role";
