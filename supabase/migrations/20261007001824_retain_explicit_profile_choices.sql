SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

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
 if p_operation not in ('draft','rebase','confirm') or (p_operation in ('rebase','confirm') and p_source<>'host') then raise exception 'FORBIDDEN'; end if;
 if length(coalesce(p_input->>'idempotencyKey','')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
 insert into fmat.idempotency(actor_scope,operation,key,input) values('host:'||h.id,'setup_'||p_operation,p_input->>'idempotencyKey',p_input||jsonb_build_object('source',p_source)) on conflict do nothing;
 select * into strict record from fmat.idempotency where actor_scope='host:'||h.id and operation='setup_'||p_operation and key=p_input->>'idempotencyKey' for update;
 if record.input<>p_input||jsonb_build_object('source',p_source) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 if record.result is not null then return fmat.host_setup_view(h.id); end if;
 if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision')::integer is distinct from c.revision then raise exception 'REVISION_CONFLICT'; end if;
 if p_operation in ('draft','rebase') then
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
   settings:=d.settings;provenance:=d.provenance;unresolved:=d.unresolved;
  elsif d.revision is not null and d.base_rules_version<>h.rules_version and not(d.status='confirmed' and d.settings=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules)) then raise exception 'REVISION_CONFLICT';
  elsif d.base_rules_version=h.rules_version or (d.status='confirmed' and d.settings=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules)) then settings:=d.settings;provenance:=d.provenance;else settings:=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules);provenance:='{}';end if;
  settings:=coalesce(settings,'{}');provenance:=coalesce(provenance,'{}');
  for k,val in select key,value from jsonb_each(patch-'rules') loop
   if k='displayName' then val:=to_jsonb(trim(val#>>'{}')); end if;
   if p_source='assistant' and provenance->>k='host' and settings->k is distinct from val then raise exception 'EXPLICIT_CHOICE_CONFLICT'; end if;
   if settings->k is distinct from val or provenance->>k is null or p_source='host' then provenance:=provenance||jsonb_build_object(k,p_source);end if;
   settings:=jsonb_set(settings,array[k],val);end loop;
  if patch ? 'rules' then
   for k,val in select key,value from jsonb_each(patch->'rules') loop
    -- Explicit values outrank a changed assistant suggestion until the host edits them.
    if p_source='assistant' and provenance->>('rules.'||k)='host' and settings->'rules'->k is distinct from val then raise exception 'EXPLICIT_CHOICE_CONFLICT'; end if;
    if settings->'rules'->k is distinct from val or provenance->>('rules.'||k) is null or p_source='host' then provenance:=provenance||jsonb_build_object('rules.'||k,p_source);end if;
   end loop;
   settings:=jsonb_set(settings,'{rules}',coalesce(nullif(settings->'rules','null'),'{}')||(patch->'rules'));
  end if;
  if settings->'rules'->>'meetingMode'='online' then provenance:=provenance-array['rules.travelMode','rules.travelBufferMinutes','rules.locationPolicy','rules.locations'];settings:=jsonb_set(settings,'{rules}',settings->'rules'||'{"travelMode":"NONE","travelBufferMinutes":0,"locationPolicy":"per_meeting","locations":[]}');end if;
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

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));
