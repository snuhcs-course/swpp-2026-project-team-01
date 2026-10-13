SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

ALTER TABLE "fmat"."setup_drafts"
  ADD COLUMN "origins" jsonb NOT NULL DEFAULT '{}'::jsonb;

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
declare h fmat.hosts; c fmat.setup_conversations; d fmat.setup_drafts; r fmat.setup_reviews; g fmat.calendar_connections; record fmat.idempotency; settings jsonb; provenance jsonb; origins jsonb; patch jsonb; missing text[]; unresolved text[]; k text; val jsonb; draft_revision integer; review_revision integer; sequence integer;
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
  if exists(select 1 from jsonb_object_keys(p_input) x where x not in ('expectedRevision','patch','unresolved','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
  patch:=p_input->'patch';perform fmat.validate_setup_patch(patch);
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
    if p_source='assistant' and provenance->>('rules.'||k)='host' and settings->'rules'->k is distinct from val then raise exception 'EXPLICIT_CHOICE_CONFLICT'; end if;
    if settings->'rules'->k is distinct from val or not origins ? ('rules.'||k) then origins:=origins||jsonb_build_object('rules.'||k,jsonb_build_object('source',p_source));end if;
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
 insert into fmat.setup_turns(id,conversation_id,sequence,role,channel,text) values(gen_random_uuid(),c.id,sequence,case when p_source='assistant' then 'assistant' else 'host' end,'web',case when p_operation='confirm' then 'Confirmed the current settings review.' when p_operation='progress' then 'Updated setup guidance choices. Confirmed settings are unchanged.' else 'Updated the private setup draft. Settings are not saved until confirmed.' end);
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
 return jsonb_build_object('progress',jsonb_build_object('analysisDecided',c.analysis_decided,'dismissedSuggestions',to_jsonb(c.dismissed_suggestions)),'revision',c.revision,'rulesVersion',h.rules_version,'calendarGeneration',g.generation,'calendarSelected',g.id is not null and cardinality(h.conflict_calendar_ids)>0 and h.booking_calendar_id is not null,
  'confirmed',jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules),
  'draft',case when d.revision is null then null else jsonb_build_object('revision',d.revision,'baseRulesVersion',d.base_rules_version,'settings',d.settings,'provenance',d.provenance,'origins',d.origins,'unresolved',to_jsonb(missing),'clarifications',to_jsonb(d.unresolved),'status',d.status) end,
  'review',case when r.revision is null or d.base_rules_version<>h.rules_version then null else jsonb_build_object('revision',r.revision,'draftRevision',r.draft_revision,'settings',r.settings,'status',r.status) end,
  'nextAction',case when g.id is null then 'connect_calendar' when cardinality(h.conflict_calendar_ids)=0 or h.booking_calendar_id is null then 'select_calendars' when d.revision is null then 'complete_preferences' when d.status='confirmed' and d.settings=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules) then 'settings_confirmed' when d.base_rules_version<>h.rules_version then 'refresh_draft' when cardinality(missing)>0 then 'complete_preferences' when r.status='pending' then 'confirm_review' else 'complete_preferences' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_calendar_scan (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor jsonb;h fmat.hosts;c fmat.setup_conversations;g fmat.calendar_connections;s fmat.calendar_scans;d fmat.setup_drafts;
 scope jsonb;k text;ids text[];settings jsonb;provenance jsonb;patch jsonb;result jsonb;v_fingerprint text;v_start date;v_end date;new_origins jsonb;origin_base jsonb;candidate jsonb;places jsonb;mode text;place_source text;has_candidate boolean;apply_schedule boolean;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 actor:=fmat.calendar_actor(p_credential);select * into strict h from fmat.hosts where id=(actor->>'id')::uuid;
 c:=fmat.ensure_setup_conversation(h.id);select * into strict c from fmat.setup_conversations where id=c.id for update;
 delete from fmat.calendar_scans where host_id=h.id and created_at<clock_timestamp()-interval '24 hours';
 if p_operation='read' then if p_input<>'{}' then raise exception 'INVALID_INPUT';end if;return fmat.calendar_scan_view(h.id);end if;
 select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=h.id and revoked_at is null for update;
 if p_operation='start' then
  select * into s from fmat.calendar_scans where host_id=h.id and key=p_input->>'idempotencyKey';
  if found then if s.input<>p_input-'verifiedCalendars'-'idempotencyKey' then raise exception 'IDEMPOTENCY_CONFLICT';end if;return jsonb_build_object('execute',false,'state',fmat.calendar_scan_view(h.id));end if;
  if g.id is null then raise exception 'RECONNECT_REQUIRED';end if;
  if jsonb_typeof(p_input) is distinct from 'object' or p_input->'consented' is distinct from 'true'::jsonb or length(coalesce(p_input->>'idempotencyKey','')) not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
  if (p_input->>'expectedRevision')::integer is distinct from c.revision or (p_input->>'rulesVersion')::integer is distinct from h.rules_version or (p_input->>'generation')::uuid is distinct from g.generation then raise exception 'REVISION_CONFLICT';end if;
  if exists(select 1 from fmat.calendar_scans where host_id=h.id and status='running' and created_at>clock_timestamp()-interval '90 seconds') then raise exception 'CONVERSATION_BUSY';end if;
  if (select count(*) from fmat.calendar_scans where host_id=h.id and created_at>clock_timestamp()-interval '1 minute')>=3 then raise exception 'CONSENT_LIMIT';end if;
  scope:=p_input->'scope';
  if jsonb_typeof(scope) is distinct from 'object' or not exists(select 1 from pg_catalog.pg_timezone_names where name=scope->>'timezone') or jsonb_typeof(scope->'calendarIds') is distinct from 'array' or jsonb_array_length(scope->'calendarIds') not between 1 and 10 then raise exception 'INVALID_INPUT';end if;
  v_start:=(scope->>'startDate')::date;v_end:=(scope->>'endDate')::date;
  if v_start is null or v_end is null or v_end-v_start not between 14 and 56 or v_start<(clock_timestamp() at time zone (scope->>'timezone'))::date-90 or v_end>(clock_timestamp() at time zone (scope->>'timezone'))::date+90 then raise exception 'INVALID_INPUT';end if;
  select array_agg(value) into ids from jsonb_array_elements_text(scope->'calendarIds');
  if cardinality(ids)<>(select count(distinct x) from unnest(ids)x) then raise exception 'INVALID_INPUT';end if;
  foreach k in array ids loop
   if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') x where x->>'id'=k and x->>'accessRole' in ('reader','writer','writerWithoutPrivateAccess','owner')) then raise exception 'CALENDAR_ACCESS_INVALID';end if;
  end loop;
  update fmat.setup_reviews set status='superseded' where conversation_id=c.id and status='pending';
  update fmat.setup_conversations set analysis_decided=true,revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  insert into fmat.calendar_scans(host_id,input,key,generation,rules_version,revision,status) values(h.id,p_input-'verifiedCalendars'-'idempotencyKey',p_input->>'idempotencyKey',g.generation,h.rules_version,c.revision,'running') returning * into s;
  return jsonb_build_object('execute',true,'id',s.id,'state',fmat.calendar_scan_view(h.id));
 end if;
 select * into s from fmat.calendar_scans where host_id=h.id and id=(p_input->>'scanId')::uuid for update;
 if s.id is null then raise exception 'NOT_FOUND';end if;
 if p_operation in ('apply','dismiss') and s.decision_operation is not null then
  if s.decision_operation<>p_operation or s.decision_input<>p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;return fmat.calendar_scan_view(h.id);
 end if;
 if p_operation='fail' then
  update fmat.calendar_scans set status='failed',summary=null where id=s.id and status='running';return fmat.calendar_scan_view(h.id);
 end if;
 if g.generation is distinct from s.generation or h.rules_version<>s.rules_version or c.revision<>s.revision or s.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='complete' then
  if s.status<>'running' or s.created_at<clock_timestamp()-interval '90 seconds' or jsonb_typeof(p_input->'summary') is distinct from 'object' or octet_length((p_input->'summary')::text)>32768 then raise exception 'INVALID_INPUT';end if;
  v_fingerprint:=encode(extensions.digest((p_input->'summary')::text,'sha256'),'hex');
  update fmat.calendar_scans set summary=p_input->'summary',status=case when exists(select 1 from fmat.calendar_scan_dismissals where host_id=h.id and calendar_scan_dismissals.fingerprint=v_fingerprint) then 'dismissed' else 'ready' end where id=s.id;
  return fmat.calendar_scan_view(h.id);
 elsif p_operation in ('apply','dismiss') then
  if (p_input->>'expectedRevision')::integer is distinct from c.revision or s.status<>'ready' then raise exception 'REVISION_CONFLICT';end if;
  if p_operation='dismiss' then
   insert into fmat.calendar_scan_dismissals values(h.id,encode(extensions.digest(s.summary::text,'sha256'),'hex')) on conflict do nothing;
   update fmat.calendar_scans set status='dismissed',decision_operation=p_operation,decision_input=p_input where id=s.id;return fmat.calendar_scan_view(h.id);
  end if;
  if exists(select 1 from jsonb_object_keys(p_input) x where x not in ('scanId','expectedRevision','idempotencyKey','schedule','windows','meetingMode','location')) or length(coalesce(p_input->>'idempotencyKey','')) not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
  if p_input ? 'schedule' and jsonb_typeof(p_input->'schedule') is distinct from 'boolean' then raise exception 'INVALID_INPUT';end if;
  apply_schedule:=coalesce((p_input->>'schedule')::boolean,true);
  if not apply_schedule and p_input ? 'windows' then raise exception 'INVALID_INPUT';end if;
  select * into d from fmat.setup_drafts where conversation_id=c.id order by revision desc limit 1;
  settings:=coalesce(d.settings,jsonb_build_object('rules',h.rules));provenance:=coalesce(d.provenance,'{}');patch:='{}';new_origins:='{}';
  origin_base:=jsonb_build_object('scanId',s.id,'startDate',s.input->'scope'->'startDate','endDate',s.input->'scope'->'endDate','timezone',s.input->'scope'->'timezone');
  -- Applying evidence never replaces an existing explicit or confirmed preference.
  if apply_schedule then
   if coalesce(jsonb_array_length(coalesce(p_input->'windows',s.summary->'windows')),0)=0 then raise exception 'INVALID_INPUT';end if;
   if settings->'rules'->>'timezone' is not null and settings->'rules'->>'timezone'<>s.input->'scope'->>'timezone' then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;
   if p_input ? 'windows' and (provenance->>'rules.availability'='host' or h.rules ? 'availability') and settings->'rules'->'availability' is distinct from p_input->'windows' then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;
   foreach k in array array['timezone','availability','durationMinutes','bufferMinutes','focusBlocks','preferences'] loop
    if provenance->>('rules.'||k)='host' or h.rules ? k then continue;end if;
    patch:=patch||jsonb_build_object(k,case k when 'timezone' then s.input->'scope'->'timezone' when 'availability' then coalesce(p_input->'windows',s.summary->'windows') when 'durationMinutes' then '30'::jsonb when 'bufferMinutes' then '10'::jsonb when 'focusBlocks' then '[]'::jsonb else '""'::jsonb end);
    new_origins:=new_origins||jsonb_build_object('rules.'||k,origin_base||jsonb_build_object('source',case when k='timezone' then 'host' when k='availability' and p_input ? 'windows' and p_input->'windows'<>s.summary->'windows' then case when s.summary->>'windowSource'='calendar' then 'calendar_edited' else 'host' end when k='availability' and s.summary->>'windowSource'='calendar' then 'calendar' else 'starter' end));
   end loop;
  end if;
  mode:=settings->'rules'->>'meetingMode';
  if p_input ? 'meetingMode' then
   if coalesce(p_input->>'meetingMode','') not in ('online','in_person','either') then raise exception 'INVALID_INPUT';end if;
   if provenance->>'rules.meetingMode'='host' or h.rules ? 'meetingMode' then
    if mode is distinct from p_input->>'meetingMode' then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;
   else patch:=patch||jsonb_build_object('meetingMode',p_input->'meetingMode');end if;
   mode:=p_input->>'meetingMode';
  end if;
  if p_input ? 'location' then
   if mode is null or mode='online' or (not p_input ? 'meetingMode' and provenance->>'rules.meetingMode' is distinct from 'host') then raise exception 'INVALID_INPUT';end if;
   candidate:=p_input->'location';
   if jsonb_typeof(candidate) is distinct from 'object' or coalesce(candidate->>'policy','') not in ('per_meeting','preferred') or exists(select 1 from jsonb_object_keys(candidate) x where x not in ('policy','places')) then raise exception 'INVALID_INPUT';end if;
   places:='[]';place_source:='host';has_candidate:=false;
   if candidate->>'policy'='preferred' then
    if jsonb_typeof(candidate->'places') is distinct from 'array' or jsonb_array_length(candidate->'places') not between 1 and 10 then raise exception 'INVALID_INPUT';end if;
    place_source:='calendar';
    for candidate in select value from jsonb_array_elements(candidate->'places') loop
     if jsonb_typeof(candidate) is distinct from 'object' or exists(select 1 from jsonb_object_keys(candidate) x where x not in ('index','label')) or jsonb_typeof(candidate->'label') is distinct from 'string' then raise exception 'INVALID_INPUT';end if;
     if candidate ? 'index' then
      if jsonb_typeof(candidate->'index') is distinct from 'number' or candidate->>'index' !~ '^[0-4]$' or s.summary->'locations'->(candidate->>'index')::integer is null then raise exception 'INVALID_INPUT';end if;
      has_candidate:=true;
      if trim(candidate->>'label') is distinct from s.summary->'locations'->(candidate->>'index')::integer->>'label' then place_source:='calendar_edited';end if;
     else place_source:='calendar_edited';end if;
     if places @> jsonb_build_array(trim(candidate->>'label')) then raise exception 'INVALID_INPUT';end if;
     places:=places||jsonb_build_array(trim(candidate->>'label'));
    end loop;
    if not has_candidate then place_source:='host';end if;
   elsif candidate ? 'places' then raise exception 'INVALID_INPUT';end if;
   foreach k in array array['locationPolicy','locations'] loop
    candidate:=case k when 'locationPolicy' then p_input->'location'->'policy' else places end;
    if provenance->>('rules.'||k)='host' or h.rules ? k then
     if settings->'rules'->k is distinct from candidate then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;
    else
     patch:=patch||jsonb_build_object(k,candidate);
     new_origins:=new_origins||jsonb_build_object('rules.'||k,case when k='locations' and has_candidate then origin_base||jsonb_build_object('source',place_source) else jsonb_build_object('source','host') end);
    end if;
   end loop;
  end if;
  if patch='{}' then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;
  result:=fmat.host_setup_operation('draft',actor,jsonb_build_object('expectedRevision',c.revision,'patch',jsonb_build_object('rules',patch),'unresolved',to_jsonb(coalesce(d.unresolved,'{}')),'idempotencyKey','scan:'||s.id),'host');
  update fmat.setup_drafts set origins=setup_drafts.origins||new_origins where conversation_id=c.id and revision=(result->'draft'->>'revision')::integer;
  update fmat.calendar_scans set status='applied',decision_operation=p_operation,decision_input=p_input,revision=(result->>'revision')::integer where id=s.id;
  return fmat.calendar_scan_view(h.id);
 end if;
 raise exception 'FORBIDDEN';
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'INVALID_INPUT';
end;
$function$;

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."setup_drafts"
  ADD CONSTRAINT "setup_drafts_origins_check" CHECK ((jsonb_typeof(origins) = 'object'::text));
