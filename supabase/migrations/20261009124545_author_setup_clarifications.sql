SET local check_function_bodies = off;

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
  unresolved:=fmat.setup_clarification_questions(unresolved);
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
 d.unresolved:=fmat.setup_clarification_questions(d.unresolved);
 select * into r from fmat.setup_reviews where conversation_id=c.id order by revision desc limit 1;
 select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=p_host and revoked_at is null;
 missing:=fmat.setup_missing(d.settings,d.provenance,d.unresolved);
 return jsonb_build_object('analysisStatus',fmat.calendar_scan_view(p_host)->'scan'->'status','progress',jsonb_build_object('analysisDecided',c.analysis_decided,'dismissedSuggestions',to_jsonb(c.dismissed_suggestions)),'revision',c.revision,'rulesVersion',h.rules_version,'calendarGeneration',g.generation,'calendarSelected',g.id is not null and cardinality(h.conflict_calendar_ids)>0 and h.booking_calendar_id is not null,
  'confirmed',jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules),
  'draft',case when d.revision is null then null else jsonb_build_object('revision',d.revision,'baseRulesVersion',d.base_rules_version,'settings',d.settings,'provenance',d.provenance,'origins',d.origins,'unresolved',to_jsonb(missing),'clarifications',to_jsonb(d.unresolved),'status',d.status) end,
  'review',case when r.revision is null or d.base_rules_version<>h.rules_version then null else jsonb_build_object('revision',r.revision,'draftRevision',r.draft_revision,'settings',r.settings,'status',r.status) end,
  'nextAction',case when g.id is null then 'connect_calendar' when cardinality(h.conflict_calendar_ids)=0 or h.booking_calendar_id is null then 'select_calendars' when d.revision is null then 'complete_preferences' when d.status='confirmed' and d.settings=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules) then 'settings_confirmed' when d.base_rules_version<>h.rules_version then 'refresh_draft' when cardinality(missing)>0 then 'complete_preferences' when r.status='pending' then 'confirm_review' else 'complete_preferences' end);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.setup_clarification_questions (
  p_values text[]
)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
 with questions(code,question) as (values
  ('en:displayName','What name should your booking page display?'),
  ('ko:displayName','예약 페이지에 어떤 이름을 표시할까요?'),
  ('en:handle','Which public booking handle would you like?'),
  ('ko:handle','공개 예약 주소에 어떤 이름을 사용할까요?'),
  ('en:timezone','Which timezone should we use for your schedule?'),
  ('ko:timezone','일정에 어떤 시간대를 사용할까요?'),
  ('en:durationMinutes','How long should meetings last?'),
  ('ko:durationMinutes','회의는 얼마나 진행할까요?'),
  ('en:availability','Which weekdays and start and end times work for meetings?'),
  ('ko:availability','회의가 가능한 요일과 시작·종료 시간을 알려 주세요.'),
  ('en:focusBlocks','Which times should be kept free of meetings?'),
  ('ko:focusBlocks','회의를 잡지 않을 시간을 알려 주세요.'),
  ('en:bufferMinutes','How many minutes should separate meetings?'),
  ('ko:bufferMinutes','회의 사이에 몇 분의 여유를 둘까요?'),
  ('en:preferences','What other scheduling preferences should we consider?'),
  ('ko:preferences','추가로 고려할 일정 선호 사항이 있나요?'),
  ('en:meetingMode','Do you prefer online meetings, in-person meetings, or either?'),
  ('ko:meetingMode','온라인, 대면 또는 둘 다 중 어떤 방식을 선호하시나요?'),
  ('en:location','Which areas or venues do you prefer, or will you decide per meeting?'),
  ('ko:location','선호하는 지역이나 장소가 있나요, 아니면 회의마다 정하시겠어요?'),
  ('en:travelMode','How do you usually travel, or will you decide per trip?'),
  ('ko:travelMode','주로 어떻게 이동하시나요, 아니면 이동할 때마다 정하시겠어요?'),
  ('en:travelBufferMinutes','How many extra minutes should we allow beyond estimated travel time?'),
  ('ko:travelBufferMinutes','예상 이동 시간 외에 몇 분의 여유를 더 둘까요?'),
  ('en:setup','What would you like to clarify or change about your setup preferences?'),
  ('ko:setup','설정 선호 사항에서 어떤 내용을 명확히 하거나 변경하고 싶으신가요?')
 )
 select coalesce(array_agg(coalesce(
  (select q.question from questions q where q.code=v.value or q.question=v.value limit 1),
  'What would you like to clarify or change about your setup preferences?'
 ) order by v.position),'{}'::text[])
 from unnest(p_values) with ordinality v(value,position);
$function$;

REVOKE ALL ON FUNCTION "fmat"."setup_clarification_questions"(text[]) FROM PUBLIC;
