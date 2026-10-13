SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

ALTER TABLE "fmat"."setup_drafts"
  ADD COLUMN "provenance" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION fmat.host_setup_operation (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb,
  p_source    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare h fmat.hosts; c fmat.setup_conversations; d fmat.setup_drafts; r fmat.setup_reviews; g fmat.calendar_connections; record fmat.idempotency; settings jsonb; provenance jsonb; patch jsonb; missing text[]; unresolved text[]; k text; val jsonb; draft_revision integer; review_revision integer; sequence integer;
begin
 if p_source not in ('host','assistant') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 select * into strict h from fmat.hosts where id=fmat.require_host(p_actor,true) and revoked_at is null for update;
 c:=fmat.ensure_setup_conversation(h.id);select * into strict c from fmat.setup_conversations where id=c.id for update;
 if p_operation='read' then if p_input<>'{}' then raise exception 'INVALID_INPUT'; end if;return fmat.host_setup_view(h.id); end if;
 if p_operation='confirm_replay' then
  if p_source<>'host' then raise exception 'FORBIDDEN'; end if;
  select * into record from fmat.idempotency where actor_scope='host:'||h.id and operation='setup_confirm' and key=p_input->>'idempotencyKey';
  if found then
   if record.input<>p_input||jsonb_build_object('source',p_source) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   if record.result is not null then return fmat.host_setup_view(h.id); end if;
  end if;
  return null;
 end if;
 if p_operation not in ('draft','confirm') or (p_operation='confirm' and p_source<>'host') then raise exception 'FORBIDDEN'; end if;
 if length(coalesce(p_input->>'idempotencyKey','')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
 insert into fmat.idempotency(actor_scope,operation,key,input) values('host:'||h.id,'setup_'||p_operation,p_input->>'idempotencyKey',p_input||jsonb_build_object('source',p_source)) on conflict do nothing;
 select * into strict record from fmat.idempotency where actor_scope='host:'||h.id and operation='setup_'||p_operation and key=p_input->>'idempotencyKey' for update;
 if record.input<>p_input||jsonb_build_object('source',p_source) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 if record.result is not null then return fmat.host_setup_view(h.id); end if;
 if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision')::integer is distinct from c.revision then raise exception 'REVISION_CONFLICT'; end if;
 if p_operation='draft' then
  if exists(select 1 from jsonb_object_keys(p_input) x where x not in ('expectedRevision','patch','unresolved','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
  patch:=p_input->'patch';perform fmat.validate_setup_patch(patch);
  if jsonb_typeof(p_input->'unresolved') is distinct from 'array' or jsonb_array_length(p_input->'unresolved')>20 or exists(select 1 from jsonb_array_elements(p_input->'unresolved') x where jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 200) then raise exception 'INVALID_INPUT'; end if;
  select coalesce(array_agg(value),'{}') into unresolved from jsonb_array_elements_text(p_input->'unresolved');
  select * into d from fmat.setup_drafts where conversation_id=c.id order by revision desc limit 1;
  if d.base_rules_version=h.rules_version or (d.status='confirmed' and d.settings=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules)) then settings:=d.settings;provenance:=d.provenance;else settings:=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules);provenance:='{}';end if;
  settings:=coalesce(settings,'{}');provenance:=coalesce(provenance,'{}');
  for k,val in select key,value from jsonb_each(patch-'rules') loop settings:=jsonb_set(settings,array[k],val);provenance:=provenance||jsonb_build_object(k,p_source);end loop;
  if patch ? 'rules' then
   for k,val in select key,value from jsonb_each(patch->'rules') loop
    -- Explicit values outrank a changed assistant suggestion until the host edits them.
    if p_source='assistant' and provenance->>('rules.'||k)='host' and settings->'rules'->k is distinct from val then raise exception 'EXPLICIT_CHOICE_CONFLICT'; end if;
    if settings->'rules'->k is distinct from val or provenance->>('rules.'||k) is null or p_source='host' then provenance:=provenance||jsonb_build_object('rules.'||k,p_source);end if;
   end loop;
   settings:=jsonb_set(settings,'{rules}',coalesce(nullif(settings->'rules','null'),'{}')||(patch->'rules'));
  end if;
  if settings->'rules'->>'meetingMode'='online' then settings:=jsonb_set(settings,'{rules}',settings->'rules'||'{"travelMode":"NONE","travelBufferMinutes":0,"locationPolicy":"per_meeting","locations":[]}');end if;
  missing:=fmat.setup_missing(settings,provenance,unresolved);
  update fmat.setup_drafts set status='superseded' where conversation_id=c.id and status='active';
  update fmat.setup_reviews set status='superseded' where conversation_id=c.id and status='pending';
  select coalesce(max(revision),0)+1 into draft_revision from fmat.setup_drafts where conversation_id=c.id;
  insert into fmat.setup_drafts(conversation_id,revision,base_rules_version,settings,provenance,unresolved) values(c.id,draft_revision,h.rules_version,settings,provenance,unresolved);
  if cardinality(missing)=0 then
   perform fmat.validate_rules(settings->'rules');
   select coalesce(max(revision),0)+1 into review_revision from fmat.setup_reviews where conversation_id=c.id;
   insert into fmat.setup_reviews(conversation_id,revision,draft_revision,settings) values(c.id,review_revision,draft_revision,settings);
  end if;
 else
  if exists(select 1 from jsonb_object_keys(p_input) x where x not in ('expectedRevision','draftRevision','reviewRevision','rulesVersion','calendarGeneration','confirmed','idempotencyKey')) or p_input->'confirmed' is distinct from 'true'::jsonb then raise exception 'INVALID_INPUT'; end if;
  select * into r from fmat.setup_reviews where conversation_id=c.id and revision=(p_input->>'reviewRevision')::integer;
  select * into d from fmat.setup_drafts where conversation_id=c.id and revision=(p_input->>'draftRevision')::integer;
  select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=h.id and revoked_at is null for update;
  if r.status is distinct from 'pending' or d.status is distinct from 'active' or r.draft_revision is distinct from d.revision or d.base_rules_version is distinct from h.rules_version or (p_input->>'rulesVersion')::integer is distinct from h.rules_version then raise exception 'REVISION_CONFLICT'; end if;
  if g.generation is distinct from (p_input->>'calendarGeneration')::uuid or g.id is null or cardinality(h.conflict_calendar_ids)=0 or h.booking_calendar_id is null then raise exception 'RECONNECT_REQUIRED'; end if;
  if cardinality(fmat.setup_missing(d.settings,d.provenance,d.unresolved))>0 or r.settings<>d.settings then raise exception 'INVALID_INPUT'; end if;
  perform fmat.onboarding_command('setup_save',p_actor,r.settings);
  update fmat.setup_drafts set status='confirmed' where conversation_id=c.id and revision=d.revision;
  update fmat.setup_reviews set status='confirmed',confirmed_at=clock_timestamp() where conversation_id=c.id and revision=r.revision;
 end if;
 select coalesce(max(t.sequence),0)+1 into sequence from fmat.setup_turns t where conversation_id=c.id;
 insert into fmat.setup_turns(id,conversation_id,sequence,role,channel,text) values(gen_random_uuid(),c.id,sequence,case when p_source='assistant' then 'assistant' else 'host' end,'web',case when p_operation='confirm' then 'Confirmed the current settings review.' else 'Updated the private setup draft. Settings are not saved until confirmed.' end);
 update fmat.setup_conversations set revision=revision+1,updated_at=clock_timestamp() where id=c.id;
 perform fmat.audit('setup_'||p_operation,p_actor,h.id::text);
 update fmat.idempotency set result='{"applied":true}' where actor_scope='host:'||h.id and operation='setup_'||p_operation and key=p_input->>'idempotencyKey';
 return fmat.host_setup_view(h.id);
exception when unique_violation then raise exception 'HANDLE_UNAVAILABLE';
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.host_setup_view (
  p_host uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare c fmat.setup_conversations; d fmat.setup_drafts; r fmat.setup_reviews; h fmat.hosts; g fmat.calendar_connections; missing text[];
begin
 select * into strict h from fmat.hosts where id=p_host and revoked_at is null;
 c:=fmat.ensure_setup_conversation(p_host);
 select * into d from fmat.setup_drafts where conversation_id=c.id order by revision desc limit 1;
 select * into r from fmat.setup_reviews where conversation_id=c.id order by revision desc limit 1;
 select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=p_host and revoked_at is null;
 missing:=fmat.setup_missing(d.settings,d.provenance,d.unresolved);
 return jsonb_build_object('revision',c.revision,'rulesVersion',h.rules_version,'calendarGeneration',g.generation,'calendarSelected',g.id is not null and cardinality(h.conflict_calendar_ids)>0 and h.booking_calendar_id is not null,
  'confirmed',jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules),
  'draft',case when d.revision is null then null else jsonb_build_object('revision',d.revision,'baseRulesVersion',d.base_rules_version,'settings',d.settings,'provenance',d.provenance,'unresolved',to_jsonb(missing),'status',d.status) end,
  'review',case when r.revision is null or d.base_rules_version<>h.rules_version then null else jsonb_build_object('revision',r.revision,'draftRevision',r.draft_revision,'settings',r.settings,'status',r.status) end,
  'nextAction',case when g.id is null then 'connect_calendar' when cardinality(h.conflict_calendar_ids)=0 or h.booking_calendar_id is null then 'select_calendars' when d.revision is null or cardinality(missing)>0 then 'complete_preferences' when d.status='confirmed' then 'settings_confirmed' when d.base_rules_version<>h.rules_version then 'refresh_draft' when r.status='pending' then 'confirm_review' when d.status='confirmed' then 'settings_confirmed' else 'complete_preferences' end);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.onboarding_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION fmat.setup_missing (
  p_settings   jsonb,
  p_provenance jsonb,
  p_unresolved text[]
)
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare missing text[]:=coalesce(p_unresolved,'{}'); r jsonb:=coalesce(nullif(p_settings->'rules','null'),'{}'); k text;
begin
 foreach k in array array['displayName','handle'] loop if coalesce(p_settings->>k,'')='' then missing:=array_append(missing,k); end if; end loop;
 foreach k in array array['timezone','durationMinutes','availability','focusBlocks','bufferMinutes','preferences','meetingMode'] loop if not r ? k then missing:=array_append(missing,k); end if; end loop;
 if p_provenance->>'rules.meetingMode' is distinct from 'host' then missing:=array_append(missing,'Choose online, in-person or either.'); end if;
 if r->>'meetingMode' in ('in_person','either') then
  foreach k in array array['locationPolicy','travelMode','travelBufferMinutes'] loop
   if not r ? k or p_provenance->>('rules.'||k) is distinct from 'host' then missing:=array_append(missing,k); end if;
  end loop;
  if r->>'travelMode'='NONE' then missing:=array_append(missing,'Choose transportation or decide per trip.'); end if;
  if r->>'locationPolicy'='preferred' and (coalesce(jsonb_array_length(r->'locations'),0)=0 or p_provenance->>'rules.locations' is distinct from 'host') then missing:=array_append(missing,'Choose preferred areas or venues.'); end if;
 end if;
 return missing;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.validate_rules (
  p_rules jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION fmat.validate_setup_patch (
  p_patch jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r jsonb; item jsonb; k text;
begin
 if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}' or exists(select 1 from jsonb_object_keys(p_patch) x where x not in ('handle','displayName','rules')) then raise exception 'INVALID_INPUT'; end if;
 if p_patch ? 'handle' and (jsonb_typeof(p_patch->'handle') is distinct from 'string' or p_patch->>'handle' !~ '^[a-z][a-z0-9-]{2,39}$' or p_patch->>'handle' in ('host','requests','api','operator','auth','skills','app','booking','connections','connect','_next','favicon','robots','sitemap')) then raise exception 'INVALID_INPUT'; end if;
 if p_patch ? 'displayName' and (jsonb_typeof(p_patch->'displayName') is distinct from 'string' or length(trim(p_patch->>'displayName')) not between 1 and 120) then raise exception 'INVALID_INPUT'; end if;
 if not p_patch ? 'rules' then return; end if;
 r:=p_patch->'rules';
 if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) x where x not in ('timezone','durationMinutes','availability','focusBlocks','bufferMinutes','travelMode','homeLocation','preferences','meetingMode','locationPolicy','locations','travelBufferMinutes')) then raise exception 'INVALID_INPUT'; end if;
 if r ? 'timezone' and (jsonb_typeof(r->'timezone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=r->>'timezone')) then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['durationMinutes','bufferMinutes','travelBufferMinutes'] loop
  if r ? k and (jsonb_typeof(r->k) is distinct from 'number' or r->>k !~ '^[0-9]+$' or (r->>k)::numeric not between case when k='durationMinutes' then 5 else 0 end and 240) then raise exception 'INVALID_INPUT'; end if;
 end loop;
 if r ? 'meetingMode' and coalesce(r->>'meetingMode','') not in ('online','in_person','either') then raise exception 'INVALID_INPUT'; end if;
 if r ? 'locationPolicy' and coalesce(r->>'locationPolicy','') not in ('per_meeting','preferred') then raise exception 'INVALID_INPUT'; end if;
 if r ? 'travelMode' and coalesce(r->>'travelMode','') not in ('DRIVE','TRANSIT','WALK','BICYCLE','PER_TRIP','NONE') then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['homeLocation','preferences'] loop
  if r ? k and (jsonb_typeof(r->k) is distinct from 'string' or length(r->>k)>case when k='homeLocation' then 2000 else 5000 end) then raise exception 'INVALID_INPUT'; end if;
 end loop;
 if r ? 'locations' then
  if jsonb_typeof(r->'locations') is distinct from 'array' or jsonb_array_length(r->'locations')>10 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'locations') loop
   if jsonb_typeof(item) is distinct from 'string' or length(trim(item#>>'{}')) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
 if r ? 'availability' then
  if jsonb_typeof(r->'availability') is distinct from 'array' or jsonb_array_length(r->'availability') not between 1 and 21 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'availability') loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) x where x not in ('days','start','end')) or jsonb_typeof(item->'days') is distinct from 'array' or jsonb_array_length(item->'days') not between 1 and 7
    or coalesce(item->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(item->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'start'>=item->>'end' then raise exception 'INVALID_INPUT'; end if;
   if exists(select 1 from jsonb_array_elements(item->'days') d where jsonb_typeof(d) is distinct from 'number' or d::text !~ '^[0-6]$') then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
 if r ? 'focusBlocks' then
  if jsonb_typeof(r->'focusBlocks') is distinct from 'array' or jsonb_array_length(r->'focusBlocks')>100 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'focusBlocks') loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) x where x not in ('start','end')) or coalesce(item->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(item->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or (item->>'start')::timestamptz>=(item->>'end')::timestamptz then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
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
    return fmat.host_setup_operation('read',v_actor,'{}','assistant');
  when 'setup_draft' then
    if v_access->>'audience'<>'host_setup' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_setup_operation('draft',v_actor,p_input,'assistant');
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

CREATE OR REPLACE FUNCTION public.fmat_host_setup (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor jsonb;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN'; end if;
 actor:=fmat.calendar_actor(p_credential);
 return fmat.host_setup_operation(p_operation,actor,p_input,'host');
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_host_setup"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."setup_drafts"
  ADD CONSTRAINT "setup_drafts_provenance_check" CHECK ((jsonb_typeof(provenance) = 'object'::text));

REVOKE ALL ON FUNCTION "fmat"."host_setup_operation"(text, jsonb, jsonb, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."host_setup_view"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."setup_missing"(jsonb, jsonb, text[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."validate_setup_patch"(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_host_setup"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_host_setup"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_host_setup"(text, jsonb, jsonb) TO "service_role";
