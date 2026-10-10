SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

ALTER TABLE "fmat"."photon_inbox"
  ADD COLUMN "receiver_id" uuid;

ALTER TABLE "fmat"."photon_inbox"
  ADD COLUMN "link_id" uuid;

ALTER TABLE "fmat"."photon_inbox"
  ADD COLUMN "runtime_message_id" uuid;

ALTER TABLE "fmat"."photon_inbox"
  ADD COLUMN "processing_outcome" text;

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
declare h fmat.hosts; c fmat.setup_conversations; d fmat.setup_drafts; r fmat.setup_reviews; g fmat.calendar_connections; record fmat.idempotency; settings jsonb; provenance jsonb; origins jsonb; starter_fields text[]; patch jsonb; missing text[]; unresolved text[]; k text; val jsonb; draft_revision integer; review_revision integer; sequence integer;
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
 if p_operation not in ('draft','rebase','confirm','progress') or (p_operation in ('rebase','confirm','progress') and p_source<>'host') then raise exception 'FORBIDDEN'; end if;
 if length(coalesce(p_input->>'idempotencyKey','')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
 insert into fmat.idempotency(actor_scope,operation,key,input) values('host:'||h.id,'setup_'||p_operation,p_input->>'idempotencyKey',p_input||jsonb_build_object('source',p_source)) on conflict do nothing;
 select * into strict record from fmat.idempotency where actor_scope='host:'||h.id and operation='setup_'||p_operation and key=p_input->>'idempotencyKey' for update;
 if record.input<>p_input||jsonb_build_object('source',p_source) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 if record.result is not null then return fmat.host_setup_view(h.id); end if;
 if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision')::integer is distinct from c.revision then raise exception 'REVISION_CONFLICT'; end if;
 if p_operation='progress' then
  if exists(select 1 from jsonb_object_keys(p_input) x where x not in ('expectedRevision','choice','idempotencyKey')) or coalesce(p_input->>'choice','') not in ('skip_analysis','dismiss_schedule','dismiss_mode','offer_schedule','offer_mode') then raise exception 'INVALID_INPUT';end if;
  if p_input->>'choice'='skip_analysis' then update fmat.setup_conversations set analysis_decided=true where id=c.id;
  elsif p_input->>'choice' in ('dismiss_schedule','dismiss_mode') then update fmat.setup_conversations set dismissed_suggestions=array(select distinct v from unnest(dismissed_suggestions||array[replace(p_input->>'choice','dismiss_','')])v) where id=c.id;
  else update fmat.setup_conversations set dismissed_suggestions=array_remove(dismissed_suggestions,replace(p_input->>'choice','offer_','')) where id=c.id;end if;
 elsif p_operation in ('draft','rebase') then
  if p_operation='draft' then
  if exists(select 1 from jsonb_object_keys(p_input) x where x not in ('expectedRevision','patch','unresolved','idempotencyKey','starterFields')) then raise exception 'INVALID_INPUT'; end if;
  patch:=p_input->'patch';perform fmat.validate_setup_patch(patch);
  if p_input ? 'starterFields' then
   if p_source<>'host' or jsonb_typeof(p_input->'starterFields') is distinct from 'array' or jsonb_array_length(p_input->'starterFields')>8 then raise exception 'INVALID_INPUT';end if;
   select coalesce(array_agg(value),'{}') into starter_fields from jsonb_array_elements_text(p_input->'starterFields');
   if not starter_fields<@array['timezone','durationMinutes','availability','bufferMinutes','focusBlocks','preferences','meetingMode','travelBufferMinutes'] or cardinality(starter_fields)<>(select count(distinct v) from unnest(starter_fields)v) then raise exception 'INVALID_INPUT';end if;
   foreach k in array starter_fields loop
    if not patch->'rules' ? k or (k<>'timezone' and patch->'rules'->k is distinct from case k when 'durationMinutes' then '30'::jsonb when 'availability' then '[{"days":[1,2,3,4,5],"start":"13:00","end":"17:00"}]'::jsonb when 'bufferMinutes' then '10'::jsonb when 'focusBlocks' then '[]'::jsonb when 'preferences' then '""'::jsonb when 'meetingMode' then '"either"'::jsonb else '15'::jsonb end) then raise exception 'INVALID_INPUT';end if;
   end loop;
  end if;

  if jsonb_typeof(p_input->'unresolved') is distinct from 'array' or jsonb_array_length(p_input->'unresolved')>20 or exists(select 1 from jsonb_array_elements(p_input->'unresolved') x where jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 200) then raise exception 'INVALID_INPUT'; end if;
  select coalesce(array_agg(value),'{}') into unresolved from jsonb_array_elements_text(p_input->'unresolved');
  else
   if exists(select 1 from jsonb_object_keys(p_input) x where x not in ('expectedRevision','rulesVersion','idempotencyKey')) or jsonb_typeof(p_input->'rulesVersion') is distinct from 'number' or (p_input->>'rulesVersion')::integer is distinct from h.rules_version then raise exception 'REVISION_CONFLICT'; end if;
   patch:='{}';
  end if;
  select * into d from fmat.setup_drafts where conversation_id=c.id order by revision desc limit 1;
  if p_operation='rebase' then
   if d.revision is null then raise exception 'INVALID_INPUT'; end if;
   settings:=d.settings;provenance:=d.provenance;origins:=d.origins;unresolved:=d.unresolved;
  elsif d.revision is not null and d.base_rules_version<>h.rules_version and not(d.status='confirmed' and d.settings=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules)) then raise exception 'REVISION_CONFLICT';
  elsif d.base_rules_version=h.rules_version or (d.status='confirmed' and d.settings=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules)) then settings:=d.settings;provenance:=d.provenance;origins:=d.origins;else settings:=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules);provenance:='{}';origins:='{}';end if;
  settings:=coalesce(settings,'{}');provenance:=coalesce(provenance,'{}');origins:=coalesce(origins,'{}');
  for k,val in select key,value from jsonb_each(patch-'rules') loop
   if k='displayName' then val:=to_jsonb(trim(val#>>'{}')); end if;
   if p_source='assistant' and provenance->>k='host' and settings->k is distinct from val then raise exception 'EXPLICIT_CHOICE_CONFLICT'; end if;
   if settings->k is distinct from val or provenance->>k is null or p_source='host' then provenance:=provenance||jsonb_build_object(k,p_source);end if;
   if settings->k is distinct from val or not origins ? k then origins:=origins||jsonb_build_object(k,jsonb_build_object('source',p_source));end if;
   settings:=jsonb_set(settings,array[k],val);end loop;
  if patch ? 'rules' then
   for k,val in select key,value from jsonb_each(patch->'rules') loop
    -- Explicit values outrank a changed assistant suggestion until the host edits them.
    if p_source='assistant' and settings->'rules'->k is distinct from val and ((c.dismissed_suggestions @> array['schedule'] and k in ('timezone','durationMinutes','availability','bufferMinutes','focusBlocks','preferences')) or (c.dismissed_suggestions @> array['mode'] and k='meetingMode')) then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;
    if k=any(starter_fields) and (provenance->>('rules.'||k)='host' or h.rules ? k) then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;

    if p_source='assistant' and provenance->>('rules.'||k)='host' and settings->'rules'->k is distinct from val then raise exception 'EXPLICIT_CHOICE_CONFLICT'; end if;
    if settings->'rules'->k is distinct from val or not origins ? ('rules.'||k) then origins:=origins||jsonb_build_object('rules.'||k,jsonb_build_object('source',case when k=any(starter_fields) then 'starter' else p_source end));end if;
    if settings->'rules'->k is distinct from val or provenance->>('rules.'||k) is null or p_source='host' then provenance:=provenance||jsonb_build_object('rules.'||k,p_source);end if;
   end loop;
   settings:=jsonb_set(settings,'{rules}',coalesce(nullif(settings->'rules','null'),'{}')||(patch->'rules'));
  end if;
  if settings->'rules'->>'meetingMode'='online' then origins:=origins-array['rules.travelMode','rules.travelBufferMinutes','rules.locationPolicy','rules.locations'];provenance:=provenance-array['rules.travelMode','rules.travelBufferMinutes','rules.locationPolicy','rules.locations'];settings:=jsonb_set(settings,'{rules}',settings->'rules'||'{"travelMode":"NONE","travelBufferMinutes":0,"locationPolicy":"per_meeting","locations":[]}');end if;
  missing:=fmat.setup_missing(settings,provenance,unresolved);
  update fmat.setup_drafts set status='superseded' where conversation_id=c.id and status='active';
  update fmat.setup_reviews set status='superseded' where conversation_id=c.id and status='pending';
  select coalesce(max(revision),0)+1 into draft_revision from fmat.setup_drafts where conversation_id=c.id;
  insert into fmat.setup_drafts(conversation_id,revision,base_rules_version,settings,provenance,origins,unresolved) values(c.id,draft_revision,h.rules_version,settings,provenance,origins,unresolved);
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
 insert into fmat.setup_turns(id,conversation_id,sequence,role,channel,text) values(gen_random_uuid(),c.id,sequence,case when p_source='assistant' then 'assistant' else 'host' end,case when p_actor->>'channel'='imessage' then 'imessage' else 'web' end,case when p_operation='confirm' then 'Confirmed the current settings review.' when p_operation='progress' then 'Updated setup guidance choices. Confirmed settings are unchanged.' else 'Updated the private setup draft. Settings are not saved until confirmed.' end);
 update fmat.setup_conversations set revision=revision+1,updated_at=clock_timestamp() where id=c.id;
 perform fmat.audit('setup_'||p_operation,p_actor,h.id::text);
 update fmat.idempotency set result='{"applied":true}' where actor_scope='host:'||h.id and operation='setup_'||p_operation and key=p_input->>'idempotencyKey';
 return fmat.host_setup_view(h.id);
exception when unique_violation then raise exception 'HANDLE_UNAVAILABLE';
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_execution_actor (
  p_credential jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; l fmat.photon_links; h fmat.hosts; u auth.users; r fmat.photon_receivers;
begin
 if jsonb_typeof(p_credential) is distinct from 'object' or p_credential->>'kind' is distinct from 'photon'
  or p_credential-array['kind','linkId','inboxId','receiverId']<>'{}'::jsonb then raise exception 'UNAUTHORIZED'; end if;
 select * into i from fmat.photon_inbox where id=(p_credential->>'inboxId')::uuid;
 select * into l from fmat.photon_links where id=i.link_id and id=(p_credential->>'linkId')::uuid;
 if not found then raise exception 'UNAUTHORIZED'; end if;
 -- Same host/Auth/receiver/link order as unlink and browser setup. UPDATE up
 -- front avoids upgrading a shared host lock after another setup writer starts.
 select * into h from fmat.hosts where id=l.host_id for update;
 if not found or h.revoked_at is not null then raise exception 'UNAUTHORIZED'; end if;
 select * into u from auth.users where id=h.id for share;
 if not found or u.deleted_at is not null or u.email_confirmed_at is null
  or u.banned_until>clock_timestamp() or lower(u.email) is distinct from h.email then raise exception 'UNAUTHORIZED'; end if;
 select * into r from fmat.photon_receivers where project_id=i.project_id for share;
 select * into l from fmat.photon_links where id=i.link_id for share;
 if not found or l.revoked_at is not null or not r.enabled
  or r.receiver_id is distinct from i.receiver_id or i.receiver_id is distinct from (p_credential->>'receiverId')::uuid
  or l.project_id is distinct from i.project_id or l.phone is distinct from i.sender_id
  or l.line is distinct from i.line or l.space_id is distinct from i.space_id
  or i.occurred_at<l.linked_at or i.occurred_at>i.received_at+interval '5 minutes'
  or i.received_at+interval '1 hour'<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
 return jsonb_build_object('kind','host','id',h.id,'email',h.email,'channel','imessage');
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.wake_photon_inbox()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_url text; v_secret text;
begin
 if not exists(select 1 from fmat.photon_inbox where processed_at is null and link_id is not null) then return null; end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if v_url is null or v_secret is null then return null; end if;
 if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION'; end if;
 v_url:=replace(v_url,'/api/internal/conversations/dispatch','/api/internal/photon/dispatch');
 return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$function$;

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
  if v_grant.credential->>'kind'='photon' then
    -- Link authority is issued only by the durable private inbox processor,
    -- never by credential_actor or a browser-supplied credential.
    if v_grant.actor_kind<>'host' or v_scope.audience<>'host_setup' then raise exception 'UNAUTHORIZED'; end if;
    v_actor:=fmat.photon_execution_actor(v_grant.credential);
  end if;
  perform 1 from fmat.hosts where id=v_scope.host_id for share;
  if v_grant.actor_kind='host' then
    perform 1 from auth.users where id=(v_grant.credential->>'subject')::uuid for share;
    perform 1 from auth.sessions where id=(v_grant.credential->>'sessionId')::uuid for share;
  end if;
  select * into v_scope from fmat.conversation_scopes where id=p_conversation_id for share;
  select * into v_grant from fmat.conversation_grants where id=p_grant_id and conversation_id=p_conversation_id for share;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
  if v_grant.credential->>'kind'<>'photon' then v_actor:=fmat.credential_actor(v_grant.credential); end if;
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

CREATE OR REPLACE FUNCTION public.fmat_photon_dispatch (
  p_project_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; j fmat.jobs; l fmat.photon_links; s fmat.conversation_scopes;
 g fmat.conversation_grants; credential jsonb; accepted jsonb; outcome text; publication record;
begin
 select j0.* into j from fmat.jobs j0
 join fmat.photon_inbox i0 on j0.dedupe_key='photon-ingress:'||i0.id::text and j0.kind='photon_ingress'
 join fmat.photon_links l0 on l0.id=i0.link_id
 where i0.project_id=p_project_id and i0.processed_at is null
  and ((j0.status='pending' and j0.available_at<=clock_timestamp()) or (j0.status='running' and j0.lease_until<=clock_timestamp()))
  and not exists(select 1 from fmat.photon_inbox prior where prior.project_id=i0.project_id
   and prior.line=i0.line and prior.space_id=i0.space_id and prior.link_id is not null
   and prior.processed_at is null and prior.received_order<i0.received_order)
  and not exists(select 1 from fmat.conversation_scopes cs join fmat.runtime_messages rm on rm.conversation_id=cs.id
   where cs.host_id=l0.host_id and cs.audience='host_setup' and rm.status='pending')
 order by i0.received_order limit 1 for update of j0 skip locked;
 if not found then return jsonb_build_object('outcome','idle'); end if;
 select * into strict i from fmat.photon_inbox where id=(j.payload->>'inboxId')::uuid;
 select * into strict l from fmat.photon_links where id=i.link_id;
 credential:=jsonb_build_object('kind','photon','linkId',l.id,'inboxId',i.id,'receiverId',i.receiver_id);
 begin
  -- Open the canonical scope without giving the caller an execution grant.
  insert into fmat.conversation_scopes(host_id,request_id,audience) values(l.host_id,null,'host_setup') on conflict do nothing;
  select * into strict s from fmat.conversation_scopes where host_id=l.host_id and audience='host_setup';
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||s.id::text,0));
  perform fmat.photon_execution_actor(credential);
  insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
   values(s.id,'host','photon:'||i.id::text,credential,i.received_at+interval '1 hour')
   on conflict(conversation_id,actor_kind,authority_key) do nothing;
  select * into strict g from fmat.conversation_grants where conversation_id=s.id and actor_kind='host' and authority_key='photon:'||i.id::text;
  accepted:=public.fmat_runtime_message('accept',g.id,s.id,jsonb_build_object('clientId',i.id,'text',i.text));
  update fmat.runtime_messages set next_dispatch_at=clock_timestamp() where id=(accepted->>'id')::uuid and status='pending';
  outcome:='accepted';
 exception when raise_exception then
  if sqlerrm='CONVERSATION_BUSY' then return jsonb_build_object('outcome','busy');
  elsif sqlerrm in ('UNAUTHORIZED','NOT_FOUND','HOST_NOT_ADMITTED') then outcome:='revoked';
  elsif sqlerrm='CONVERSATION_LIMIT' then outcome:='limited';
  else raise; end if;
 end;
 update fmat.photon_inbox set processed_at=clock_timestamp(),processing_outcome=outcome,
  runtime_message_id=case when outcome='accepted' then (accepted->>'id')::uuid else null end where id=i.id;
 update fmat.jobs set status='complete',lease_token=null,lease_until=null,worker_id=null,last_error=null,
  result=jsonb_build_object('outcome',outcome),updated_at=clock_timestamp() where id=j.id;
 for publication in select message_id from fmat.queue_publications where job_id=j.id and acknowledged_at is null loop
  perform pgmq.archive('fmat_jobs',publication.message_id);
 end loop;
 update fmat.queue_publications set acknowledged_at=clock_timestamp() where job_id=j.id and acknowledged_at is null;
 return jsonb_build_object('outcome',outcome);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_dispatch"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_photon_ingress (
  p_project_id  uuid,
  p_receiver_id uuid,
  p_input       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_receiver fmat.photon_receivers; v_inbox fmat.photon_inbox; v_new_id uuid; v_occurred timestamptz; v_job uuid;
begin
  select * into v_receiver from fmat.photon_receivers where project_id=p_project_id for share;
  if not found or not v_receiver.enabled or v_receiver.receiver_id is distinct from p_receiver_id then
    raise exception 'CONFIGURATION_UNAVAILABLE';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' or
    p_input-array['messageId','senderId','spaceId','line','text','occurredAt']<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array['messageId','senderId','spaceId','line','text','occurredAt']) k
    where jsonb_typeof(p_input->k) is distinct from 'string') then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array['messageId','senderId','spaceId','line']) k
    where length(p_input->>k) not between 1 and 512 or (p_input->>k)~'[[:cntrl:]]') or
    length(p_input->>'text') not between 1 and 4000 or btrim(p_input->>'text')='' then raise exception 'INVALID_INPUT'; end if;
  begin v_occurred:=(p_input->>'occurredAt')::timestamptz;
  exception when others then raise exception 'INVALID_INPUT'; end;
  if not isfinite(v_occurred) then raise exception 'INVALID_INPUT'; end if;

  -- Preserve receipt order within the provider conversation across concurrent
  -- deliveries. Provider timestamps are evidence, not a manufactured sequence.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('photon-ingress',p_project_id,p_input->>'line',p_input->>'spaceId')::text,0));
  -- Freeze authority at receipt. An old/unlinked message cannot inherit a
  -- later link; every execution still checks that this exact link is active.
  insert into fmat.photon_inbox(project_id,message_id,sender_id,space_id,line,text,occurred_at,receiver_id,link_id)
    values(p_project_id,p_input->>'messageId',p_input->>'senderId',p_input->>'spaceId',p_input->>'line',p_input->>'text',v_occurred,p_receiver_id,
      (select id from fmat.photon_links where project_id=p_project_id and phone=p_input->>'senderId'
        and space_id=p_input->>'spaceId' and line=p_input->>'line' and revoked_at is null
        and linked_at<=v_occurred and v_occurred<=clock_timestamp()+interval '5 minutes'))
    on conflict(project_id,message_id) do nothing returning id into v_new_id;
  select * into strict v_inbox from fmat.photon_inbox where project_id=p_project_id and message_id=p_input->>'messageId';
  if v_inbox.sender_id<>p_input->>'senderId' or v_inbox.space_id<>p_input->>'spaceId' or v_inbox.line<>p_input->>'line'
    or v_inbox.text<>p_input->>'text' or v_inbox.occurred_at<>v_occurred then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_new_id is not null then
    v_job:=fmat.enqueue_job('photon_ingress','photon-ingress:'||v_inbox.id::text,jsonb_build_object('inboxId',v_inbox.id));
  end if;
  return jsonb_build_object('inboxId',v_inbox.id,'duplicate',v_new_id is null);
end;
$function$;

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."photon_inbox"
  ADD CONSTRAINT "photon_inbox_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.photon_links(id);

ALTER TABLE "fmat"."photon_inbox"
  ADD CONSTRAINT "photon_inbox_processing_outcome_check" CHECK ((processing_outcome = ANY (ARRAY['accepted'::text, 'revoked'::text, 'limited'::text])));

ALTER TABLE "fmat"."photon_inbox"
  ADD CONSTRAINT "photon_inbox_runtime_message_id_fkey" FOREIGN KEY (runtime_message_id) REFERENCES fmat.runtime_messages(id);

CREATE INDEX photon_inbox_link_idx ON fmat.photon_inbox USING btree (link_id);

CREATE INDEX photon_inbox_runtime_idx ON fmat.photon_inbox USING btree (runtime_message_id);

REVOKE ALL ON FUNCTION "fmat"."photon_execution_actor"(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."wake_photon_inbox"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_photon_dispatch"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_dispatch"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_dispatch"(uuid) TO "service_role";

SELECT cron.schedule_in_database('fmat-photon-inbox', '* * * * *', 'select fmat.wake_photon_inbox();', 'postgres', NULL, true);
