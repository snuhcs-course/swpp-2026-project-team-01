-- Current application authority accompanies consent; legacy worker-supplied
-- actor objects cannot be used by the new browser callback.
alter table fmat.oauth_exchanges add column bound_credential jsonb;
alter table fmat.calendar_connections add column guest_authority_key text;
create index oauth_exchanges_principal_created_idx on fmat.oauth_exchanges ((actor->>'kind'),(coalesce(actor->>'id',actor->>'requestId')),created_at);

create or replace function fmat.calendar_actor(p_credential jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_actor jsonb; v_request fmat.requests; v_host uuid;
begin
  if p_credential->>'kind'='guest' then
    select * into v_request from fmat.requests where id=(p_credential->>'requestId')::uuid for update;
    v_host:=v_request.host_id;
  elsif p_credential->>'kind'='host' then v_host:=(p_credential->>'subject')::uuid;
  else raise exception 'UNAUTHORIZED'; end if;
  perform 1 from fmat.hosts where id=v_host for update;
  if p_credential->>'kind'='host' then
    perform 1 from auth.users where id=v_host for share;
    perform 1 from auth.sessions where id=(p_credential->>'sessionId')::uuid for share;
    if (p_credential->>'expiresAt')::timestamptz<=clock_timestamp() or exists(select 1 from auth.sessions where id=(p_credential->>'sessionId')::uuid and not_after<=clock_timestamp()) then raise exception 'UNAUTHORIZED'; end if;
  end if;
  v_actor:=fmat.credential_actor(p_credential);
  if v_actor->>'kind'='host' then perform fmat.require_host(v_actor,true);
  elsif v_request.status in ('booked','declined','withdrawn','expired','booking') or v_request.expires_at<=clock_timestamp() or v_request.token_expires_at<=clock_timestamp() then raise exception 'NOT_FOUND'; end if;
  return v_actor;
end;
$$;

create or replace function public.fmat_calendar_consent(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
    if v_kind='guest' and exists(select 1 from unnest(v_scopes) s where s not in ('openid','email','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly')) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    v_result:=fmat.onboarding_request_dispatch('credential_save','{"kind":"worker","id":"calendar-consent"}',p_input);
    update fmat.calendar_connections set generation=gen_random_uuid(),selected_calendar_ids='{}',guest_authority_key=case when v_kind='guest' then v_credential->>'tokenHash' else null end where id=(v_result->>'connectionId')::uuid;
    if v_kind='guest' then update fmat.requests set availability_mode='calendar',availability_failed=false where id=v_principal; end if;
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
$$;
revoke all on function fmat.calendar_actor(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.fmat_calendar_consent(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_calendar_consent(text,jsonb,jsonb) to service_role;
