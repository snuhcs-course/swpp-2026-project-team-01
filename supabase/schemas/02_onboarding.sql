create table fmat.waitlist (
  email text primary key check (email=lower(email)),
  name text,
  created_at timestamptz not null default now()
);
alter table fmat.waitlist enable row level security;

create table fmat.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check(email=lower(email)),
  token_hash text not null unique check(length(token_hash)=64),
  expires_at timestamptz not null,
  issued_by text not null,
  redeemed_by uuid,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check((redeemed_by is null)=(redeemed_at is null))
);
alter table fmat.invitations enable row level security;

create table fmat.hosts (
  id uuid primary key,
  email text not null,
  invitation_id uuid not null references fmat.invitations(id),
  admitted_at timestamptz not null default now(),
  revoked_at timestamptz,
  handle text unique check(handle ~ '^[a-z][a-z0-9-]{2,39}$'),
  display_name text,
  rules jsonb,
  rules_version integer not null default 0,
  conflict_calendar_ids text[] not null default '{}',
  booking_calendar_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hosts_invitation_idx on fmat.hosts(invitation_id);
alter table fmat.hosts enable row level security;

create table fmat.oauth_exchanges (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check(length(state_hash)=64),
  binding_hash text not null check(length(binding_hash)=64),
  actor jsonb not null,
  context jsonb not null,
  encrypted_verifier text,
  expires_at timestamptz not null default now()+interval '10 minutes',
  consumed_at timestamptz,
  saved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table fmat.oauth_exchanges enable row level security;

create table fmat.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  principal_kind text not null check(principal_kind in ('host','guest')),
  principal_id uuid not null,
  provider_subject text not null,
  scopes text[] not null,
  encrypted_credential text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(principal_kind,principal_id),
  check((revoked_at is null)=(encrypted_credential is not null))
);
alter table fmat.calendar_connections enable row level security;

create or replace function fmat.cleanup_oauth()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  update fmat.oauth_exchanges set encrypted_verifier=null where (expires_at<=now() or saved_at is not null) and encrypted_verifier is not null;
  get diagnostics v_count=row_count;
  update fmat.idempotency i set result=i.result-'encryptedVerifier' where i.operation='oauth_start' and i.result ? 'encryptedVerifier'
    and exists(select 1 from fmat.oauth_exchanges e where e.id=(i.result->>'exchangeId')::uuid and (e.expires_at<=now() or e.saved_at is not null));
  return v_count;
end;
$$;

create or replace function fmat.install_onboarding_runtime()
returns void language plpgsql set search_path='' as $$
begin perform cron.schedule('fmat-oauth-cleanup','*/10 * * * *','select fmat.cleanup_oauth();'); end;
$$;

-- P3 replaces this with persisted request token, expiry, and ownership checks.
-- Until a real request exists the requester connection path remains closed.
create or replace function fmat.authorize_guest(p_actor jsonb,p_request_id uuid)
returns void language plpgsql set search_path='' as $$
begin raise exception 'NOT_FOUND'; end;
$$;

create or replace function fmat.require_host(p_actor jsonb,p_admitted boolean default true)
returns uuid language plpgsql set search_path='' as $$
declare v_id uuid;
begin
  if p_actor->>'kind' is distinct from 'host' or coalesce(p_actor->>'id','')='' or coalesce(p_actor->>'email','')='' then raise exception 'UNAUTHORIZED'; end if;
  v_id := (p_actor->>'id')::uuid;
  if p_admitted and not exists(select 1 from fmat.hosts where id=v_id and revoked_at is null) then raise exception 'HOST_NOT_ADMITTED'; end if;
  return v_id;
end;
$$;

create or replace function fmat.host_ready(p_host fmat.hosts)
returns boolean language sql stable set search_path='' as $$
  select p_host.revoked_at is null and p_host.handle is not null and p_host.display_name is not null
    and p_host.rules is not null and cardinality(p_host.conflict_calendar_ids)>0 and p_host.booking_calendar_id is not null
    and exists(select 1 from fmat.calendar_connections c where c.principal_kind='host' and c.principal_id=p_host.id and c.revoked_at is null
      and c.scopes @> array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events']);
$$;

create or replace function fmat.setup_view(p_host_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare v_host fmat.hosts; v_connected boolean; v_ready boolean;
begin
  select * into v_host from fmat.hosts where id=p_host_id and revoked_at is null;
  if not found then return jsonb_build_object('admitted',false,'profile',null,'rules',null,'calendarConnected',false,'conflictCalendarIds','[]'::jsonb,'bookingCalendarId',null,'nextAction','redeem_invitation'); end if;
  select exists(select 1 from fmat.calendar_connections where principal_kind='host' and principal_id=p_host_id and revoked_at is null) into v_connected;
  v_ready:=fmat.host_ready(v_host);
  return jsonb_build_object('admitted',true,'profile',case when v_host.handle is null then null else jsonb_build_object('id',v_host.id,'handle',v_host.handle,'displayName',v_host.display_name,'timezone',v_host.rules->>'timezone','ready',v_ready,'durationMinutes',(v_host.rules->>'durationMinutes')::integer) end,
    'rules',v_host.rules,'calendarConnected',v_connected,'conflictCalendarIds',to_jsonb(v_host.conflict_calendar_ids),'bookingCalendarId',v_host.booking_calendar_id,
    'nextAction',case when v_host.rules is null then 'confirm_rules' when not v_connected then 'connect_calendar' when not v_ready then 'select_calendars' else 'ready' end);
end;
$$;

create or replace function fmat.validate_rules(p_rules jsonb)
returns void language plpgsql set search_path='' as $$
declare v_item jsonb;
begin
  if jsonb_typeof(p_rules) is distinct from 'object' or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_rules->>'timezone')
    or coalesce((p_rules->>'durationMinutes')::integer,0) not between 5 and 240
    or coalesce((p_rules->>'bufferMinutes')::integer,-1) not between 0 and 240
    or coalesce(p_rules->>'travelMode','') not in ('DRIVE','TRANSIT','WALK','BICYCLE','PER_TRIP','NONE')
    or jsonb_typeof(p_rules->'availability') is distinct from 'array' or jsonb_array_length(p_rules->'availability')=0
    or jsonb_typeof(p_rules->'focusBlocks') is distinct from 'array'
    or jsonb_typeof(p_rules->'preferences') is distinct from 'string' or length(p_rules->>'preferences')>5000 then raise exception 'INVALID_INPUT'; end if;
  for v_item in select value from jsonb_array_elements(p_rules->'availability') loop
    if jsonb_typeof(v_item->'days') is distinct from 'array' or jsonb_array_length(v_item->'days')=0
      or coalesce(v_item->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(v_item->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v_item->>'start') >= (v_item->>'end') then raise exception 'INVALID_INPUT'; end if;
    if exists(select 1 from jsonb_array_elements_text(v_item->'days') d where d::integer not between 0 and 6) then raise exception 'INVALID_INPUT'; end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_rules->'focusBlocks') loop
    if (v_item->>'start')::timestamptz is null or (v_item->>'end')::timestamptz is null or (v_item->>'start')::timestamptz >= (v_item->>'end')::timestamptz then raise exception 'INVALID_INPUT'; end if;
  end loop;
end;
$$;

create or replace function fmat.onboarding_authorize(p_operation text,p_actor jsonb,p_input jsonb)
returns void language plpgsql set search_path='' as $$
begin
  case p_operation
  when 'waitlist_join','host_public' then return;
  when 'setup_read','invite_redeem' then perform fmat.require_host(p_actor,false);
  when 'setup_save','calendar_read','calendar_save','calendar_disconnect' then perform fmat.require_host(p_actor,true);
  when 'invite_issue','invitation_create','invite_revoke' then
    if p_actor->>'kind' is distinct from 'operator' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  when 'oauth_start' then
    if p_actor->>'kind'='host' then perform fmat.require_host(p_actor,true);
    elsif p_actor->>'kind'='guest' then perform fmat.authorize_guest(p_actor,(p_actor->>'requestId')::uuid);
    else raise exception 'FORBIDDEN'; end if;
  when 'oauth_consume' then
    if p_actor->>'kind' is distinct from 'public' then raise exception 'FORBIDDEN'; end if;
  when 'credential_save','connection_read','token_update','oauth_cleanup' then
    if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  else raise exception 'UNKNOWN_OPERATION';
  end case;
end;
$$;

create or replace function fmat.onboarding_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_host_id uuid; v_email text; v_invite fmat.invitations; v_host fmat.hosts;
  v_exchange fmat.oauth_exchanges; v_connection fmat.calendar_connections; v_principal uuid; v_kind text;
  v_scopes text[]; v_conflicts text[]; v_id uuid; v_requested text;
begin
  perform fmat.onboarding_authorize(p_operation,p_actor,p_input);
  case p_operation
  when 'waitlist_join' then
    v_email:=lower(trim(p_input->>'email'));
    if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(coalesce(p_input->>'name',''))>200 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.waitlist(email,name) values(v_email,nullif(trim(p_input->>'name'),'')) on conflict(email) do nothing;
    return jsonb_build_object('status','pending');
  when 'invite_issue','invitation_create' then
    v_email:=lower(trim(p_input->>'email'));
    if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(p_input->>'tokenHash','') !~ '^[0-9a-f]{64}$'
      or (p_input->>'expiresAt')::timestamptz is null or (p_input->>'expiresAt')::timestamptz<=now() or (p_input->>'expiresAt')::timestamptz>now()+interval '7 days' then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.invitations(email,token_hash,expires_at,issued_by) values(v_email,p_input->>'tokenHash',(p_input->>'expiresAt')::timestamptz,p_actor->>'id') returning id into v_id;
    perform fmat.audit(p_operation,p_actor,v_id::text,jsonb_build_object('email',v_email));
    return jsonb_build_object('invitationId',v_id,'email',v_email,'expiresAt',p_input->>'expiresAt');
  when 'invite_revoke' then
    update fmat.invitations set revoked_at=now() where id=(p_input->>'invitationId')::uuid returning * into v_invite;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform fmat.audit(p_operation,p_actor,v_invite.id::text);
    return jsonb_build_object('ok',true);
  when 'invite_redeem' then
    v_host_id:=fmat.require_host(p_actor,false);
    select * into v_invite from fmat.invitations where token_hash=p_input->>'tokenHash' for update;
    if not found or v_invite.revoked_at is not null or (v_invite.redeemed_by is null and v_invite.expires_at<=now()) then raise exception 'INVITATION_INVALID'; end if;
    if v_invite.email is distinct from lower(p_actor->>'email') then raise exception 'INVITATION_INVALID'; end if;
    if v_invite.redeemed_by is not null and v_invite.redeemed_by<>v_host_id then raise exception 'INVITATION_INVALID'; end if;
    if exists(select 1 from fmat.hosts where id=v_host_id and revoked_at is not null) then raise exception 'HOST_NOT_ADMITTED'; end if;
    update fmat.invitations set redeemed_by=v_host_id,redeemed_at=coalesce(redeemed_at,now()) where id=v_invite.id;
    insert into fmat.hosts(id,email,invitation_id) values(v_host_id,v_invite.email,v_invite.id) on conflict(id) do nothing;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'setup_read','calendar_read' then return fmat.setup_view(fmat.require_host(p_actor,false));
  when 'setup_save' then
    v_host_id:=fmat.require_host(p_actor,true);
    if coalesce(p_input->>'handle','') !~ '^[a-z][a-z0-9-]{2,39}$' or p_input->>'handle' in ('host','requests','api','operator','auth','skills','app','booking','connections','connect','_next','favicon','robots','sitemap')
      or length(trim(coalesce(p_input->>'displayName',''))) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
    perform fmat.validate_rules(p_input->'rules');
    update fmat.hosts set handle=p_input->>'handle',display_name=trim(p_input->>'displayName'),rules=p_input->'rules',rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'host_public' then
    select * into v_host from fmat.hosts where handle=p_input->>'handle';
    if not found or not fmat.host_ready(v_host) then raise exception 'NOT_FOUND'; end if;
    return jsonb_build_object('id',v_host.id,'handle',v_host.handle,'displayName',v_host.display_name,'timezone',v_host.rules->>'timezone','ready',true,'durationMinutes',(v_host.rules->>'durationMinutes')::integer);
  when 'oauth_start' then
    if coalesce(p_input->>'stateHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_input->>'bindingHash','') !~ '^[0-9a-f]{64}$'
      or length(coalesce(p_input->>'encryptedVerifier',''))<20 or jsonb_typeof(p_input->'context') is distinct from 'object'
      or coalesce(p_input->'context'->>'redirectUri','') !~ '^https?://' then raise exception 'INVALID_INPUT'; end if;
    if p_actor->>'kind'='guest' and (p_input->'context'->>'requestId') is distinct from p_actor->>'requestId' then raise exception 'FORBIDDEN'; end if;
    if p_actor->>'kind'='host' and p_input->'context' ? 'requestId' then raise exception 'FORBIDDEN'; end if;
    insert into fmat.oauth_exchanges(state_hash,binding_hash,actor,context,encrypted_verifier)
      values(p_input->>'stateHash',p_input->>'bindingHash',p_actor,p_input->'context',p_input->>'encryptedVerifier') returning * into v_exchange;
    perform fmat.audit(p_operation,p_actor,v_exchange.id::text);
    return jsonb_build_object('exchangeId',v_exchange.id,'encryptedVerifier',v_exchange.encrypted_verifier,'context',v_exchange.context);
  when 'oauth_consume' then
    select * into v_exchange from fmat.oauth_exchanges where state_hash=p_input->>'stateHash' for update;
    if not found or v_exchange.binding_hash is distinct from p_input->>'bindingHash' or v_exchange.consumed_at is not null or v_exchange.expires_at<=now() then raise exception 'OAUTH_STATE_INVALID'; end if;
    if v_exchange.actor->>'kind'='host' then perform fmat.require_host(v_exchange.actor,true);
    else perform fmat.authorize_guest(v_exchange.actor,(v_exchange.actor->>'requestId')::uuid); end if;
    update fmat.oauth_exchanges set consumed_at=now() where id=v_exchange.id;
    return jsonb_build_object('actor',v_exchange.actor,'context',v_exchange.context,'encryptedVerifier',v_exchange.encrypted_verifier,'exchangeId',v_exchange.id);
  when 'credential_save' then
    select * into v_exchange from fmat.oauth_exchanges where id=(p_input->>'exchangeId')::uuid for update;
    if not found or v_exchange.consumed_at is null or v_exchange.saved_at is not null or v_exchange.expires_at<=now() then raise exception 'OAUTH_STATE_INVALID'; end if;
    v_kind:=v_exchange.actor->>'kind';
    if v_kind='host' then v_principal:=fmat.require_host(v_exchange.actor,true);
    else v_principal:=(v_exchange.actor->>'requestId')::uuid; perform fmat.authorize_guest(v_exchange.actor,v_principal); end if;
    select array_agg(value) into v_scopes from jsonb_array_elements_text(p_input->'scopes');
    if v_kind='host' and not coalesce(v_scopes @> array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],false) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if v_kind='guest' and not coalesce(v_scopes @> array['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],false) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if v_kind='guest' and v_scopes && array['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar'] then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if length(coalesce(p_input->>'encryptedCredential',''))<20 or length(coalesce(p_input->>'providerSubject','')) not between 1 and 300 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
      values(v_kind,v_principal,p_input->>'providerSubject',v_scopes,p_input->>'encryptedCredential')
      on conflict(principal_kind,principal_id) do update set provider_subject=excluded.provider_subject,scopes=excluded.scopes,encrypted_credential=excluded.encrypted_credential,revoked_at=null,updated_at=now()
      returning id into v_id;
    update fmat.oauth_exchanges set saved_at=now(),encrypted_verifier=null where id=v_exchange.id;
    if v_kind='host' then update fmat.hosts set conflict_calendar_ids='{}',booking_calendar_id=null,updated_at=now() where id=v_principal; end if;
    perform fmat.audit(p_operation,p_actor,v_id::text,jsonb_build_object('principalKind',v_kind));
    return jsonb_build_object('connectionId',v_id);
  when 'connection_read' then
    if (p_input ? 'hostId')=(p_input ? 'requestId') then raise exception 'INVALID_INPUT'; end if;
    v_kind:=case when p_input ? 'hostId' then 'host' else 'guest' end;
    v_principal:=coalesce(p_input->>'hostId',p_input->>'requestId')::uuid;
    if v_kind='host' and not exists(select 1 from fmat.hosts where id=v_principal and revoked_at is null) then raise exception 'HOST_NOT_ADMITTED'; end if;
    select * into v_connection from fmat.calendar_connections where principal_kind=v_kind and principal_id=v_principal and revoked_at is null;
    if not found then raise exception 'RECONNECT_REQUIRED'; end if;
    select * into v_host from fmat.hosts where id=v_principal and v_kind='host';
    return jsonb_build_object('connectionId',v_connection.id,'encryptedCredential',v_connection.encrypted_credential,'scopes',to_jsonb(v_connection.scopes),'conflictCalendarIds',to_jsonb(coalesce(v_host.conflict_calendar_ids,'{}')),'bookingCalendarId',v_host.booking_calendar_id);
  when 'token_update' then
    if length(coalesce(p_input->>'encryptedCredential',''))<20 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=now() where id=(p_input->>'connectionId')::uuid and revoked_at is null returning id into v_id;
    if not found then raise exception 'RECONNECT_REQUIRED'; end if;
    return jsonb_build_object('ok',true);
  when 'calendar_save' then
    v_host_id:=fmat.require_host(p_actor,true);
    if not exists(select 1 from fmat.calendar_connections where principal_kind='host' and principal_id=v_host_id and revoked_at is null) then raise exception 'RECONNECT_REQUIRED'; end if;
    if jsonb_typeof(p_input->'conflictCalendarIds') is distinct from 'array' or jsonb_typeof(p_input->'verifiedCalendars') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    select array_agg(distinct value) into v_conflicts from jsonb_array_elements_text(p_input->'conflictCalendarIds');
    if coalesce(cardinality(v_conflicts),0) not between 1 and 50 then raise exception 'INVALID_INPUT'; end if;
    foreach v_requested in array v_conflicts loop
      if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=v_requested and c->>'accessRole' in ('reader','writer','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    end loop;
    if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=p_input->>'bookingCalendarId' and c->>'accessRole' in ('writer','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    update fmat.hosts set conflict_calendar_ids=v_conflicts,booking_calendar_id=p_input->>'bookingCalendarId',rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'calendar_disconnect' then
    v_host_id:=fmat.require_host(p_actor,true);
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=now(),updated_at=now() where principal_kind='host' and principal_id=v_host_id;
    update fmat.hosts set conflict_calendar_ids='{}',booking_calendar_id=null,rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,now()),encrypted_verifier=null where actor->>'kind'='host' and actor->>'id'=v_host_id::text and saved_at is null;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'oauth_cleanup' then
    return jsonb_build_object('cleared',fmat.cleanup_oauth());
  else raise exception 'UNKNOWN_OPERATION';
  end case;
end;
$$;

create or replace function fmat.dispatch_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
begin
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then return fmat.foundation_command(p_operation,p_actor,p_input); end if;
  return fmat.onboarding_command(p_operation,p_actor,p_input);
end;
$$;

create or replace function fmat.authorize_command(p_operation text,p_actor jsonb,p_input jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then
    if p_actor->>'kind' not in ('worker','operator') or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  else perform fmat.onboarding_authorize(p_operation,p_actor,p_input);
  end if;
end;
$$;

create or replace function public.fmat_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scope text; v_key text; v_record fmat.idempotency; v_result jsonb; v_identity_input jsonb;
begin
  if jsonb_typeof(p_actor) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object'
    or p_actor->>'kind' is null or p_actor->>'kind' not in ('host','guest','worker','operator','public') then raise exception 'INVALID_INPUT'; end if;
  perform fmat.authorize_command(p_operation,p_actor,p_input);
  if p_operation like 'jobs_%' or p_operation in ('oauth_consume','credential_save','token_update','oauth_cleanup','host_public','setup_read','calendar_read','requests_list','request_read','connection_read') then return fmat.dispatch_command(p_operation,p_actor,p_input); end if;
  v_key:=p_input->>'idempotencyKey';
  if v_key is null or length(v_key) not between 1 and 200 then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  v_scope:=coalesce(p_actor->>'kind','')||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash',p_actor->>'email','public');
  v_identity_input:=case when p_operation='oauth_start' then jsonb_build_object('context',p_input->'context','idempotencyKey',v_key) else p_input end;
  insert into fmat.idempotency(actor_scope,operation,key,input) values(v_scope,p_operation,v_key,v_identity_input) on conflict do nothing;
  select * into strict v_record from fmat.idempotency where actor_scope=v_scope and operation=p_operation and key=v_key for update;
  if v_record.input<>v_identity_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_record.result is not null then
    if p_operation='oauth_start' and not exists(select 1 from fmat.oauth_exchanges where id=(v_record.result->>'exchangeId')::uuid and consumed_at is null and expires_at>now()) then raise exception 'OAUTH_STATE_INVALID'; end if;
    return v_record.result;
  end if;
  v_result:=fmat.dispatch_command(p_operation,p_actor,p_input);
  update fmat.idempotency set result=v_result where actor_scope=v_scope and operation=p_operation and key=v_key;
  return v_result;
end;
$$;
revoke all on all tables in schema fmat from public,anon,authenticated,service_role;
revoke execute on all functions in schema fmat from public,anon,authenticated,service_role;
revoke execute on function public.fmat_command(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_command(text,jsonb,jsonb) to service_role;

select fmat.install_onboarding_runtime();
