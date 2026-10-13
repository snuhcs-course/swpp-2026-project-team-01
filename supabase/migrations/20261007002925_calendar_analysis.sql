SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE TABLE "fmat"."calendar_scan_dismissals" (
  "host_id"     uuid NOT NULL,
  "fingerprint" text NOT NULL,
  CONSTRAINT "calendar_scan_dismissals_pkey" PRIMARY KEY (host_id, fingerprint)
);

ALTER TABLE "fmat"."calendar_scan_dismissals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."calendar_scans" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_id"            uuid                     NOT NULL,
  "input"              jsonb                    NOT NULL,
  "key"                text                     NOT NULL,
  "generation"         uuid                     NOT NULL,
  "rules_version"      integer                  NOT NULL,
  "revision"           integer                  NOT NULL,
  "decision_operation" text,
  "decision_input"     jsonb,
  "status"             text                     NOT NULL,
  "summary"            jsonb,
  "created_at"         timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "expires_at"         timestamp with time zone NOT NULL DEFAULT (clock_timestamp() + '00:15:00'::interval),
  CONSTRAINT "calendar_scans_host_id_key_key" UNIQUE (host_id, key),
  CONSTRAINT "calendar_scans_pkey" PRIMARY KEY (id),
  CONSTRAINT "calendar_scans_status_check" CHECK ((status = ANY (ARRAY['running'::text, 'ready'::text, 'failed'::text, 'dismissed'::text, 'applied'::text])))
);

ALTER TABLE "fmat"."calendar_scans"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.calendar_scan_view (
  p_host uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare s fmat.calendar_scans; h fmat.hosts; c fmat.setup_conversations; g fmat.calendar_connections; status text;
begin
 select * into s from fmat.calendar_scans where host_id=p_host order by created_at desc,id desc limit 1;
 if not found then return '{"scan":null}';end if;
 select * into strict h from fmat.hosts where id=p_host;
 select * into c from fmat.setup_conversations where host_id=p_host;
 select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=p_host and revoked_at is null;
 status:=case when g.generation is distinct from s.generation or h.rules_version<>s.rules_version or c.revision<>s.revision then 'stale'
 when s.expires_at<=clock_timestamp() then 'expired' when s.status='running' and s.created_at<clock_timestamp()-interval '90 seconds' then 'failed' else s.status end;
 return jsonb_build_object('scan',jsonb_build_object('id',s.id,'status',status,'scope',s.input->'scope','revision',s.revision,'expiresAt',s.expires_at,'summary',case when status in ('ready','applied') then s.summary else null end));
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
 scope jsonb;k text;ids text[];settings jsonb;provenance jsonb;patch jsonb;result jsonb;v_fingerprint text;v_start date;v_end date;
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
  update fmat.setup_conversations set revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into c;
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
  select * into d from fmat.setup_drafts where conversation_id=c.id order by revision desc limit 1;
  settings:=coalesce(d.settings,jsonb_build_object('rules',h.rules));provenance:=coalesce(d.provenance,'{}');patch:='{}';
  -- Explicit current/confirmed values outrank analyzed gaps and starter defaults.
  if coalesce(jsonb_array_length(s.summary->'windows'),0)=0 then raise exception 'INVALID_INPUT';end if;
  foreach k in array array['timezone','availability','durationMinutes','bufferMinutes','focusBlocks','preferences'] loop
   if provenance->>('rules.'||k)='host' or h.rules ? k then continue;end if;
   patch:=patch||jsonb_build_object(k,case k when 'timezone' then s.input->'scope'->'timezone' when 'availability' then s.summary->'windows' when 'durationMinutes' then '30'::jsonb when 'bufferMinutes' then '10'::jsonb when 'focusBlocks' then '[]'::jsonb else '""'::jsonb end);
  end loop;
  if settings->'rules'->>'timezone' is not null and settings->'rules'->>'timezone'<>s.input->'scope'->>'timezone' then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;
  if patch='{}' then raise exception 'EXPLICIT_CHOICE_CONFLICT';end if;
  result:=fmat.host_setup_operation('draft',actor,jsonb_build_object('expectedRevision',c.revision,'patch',jsonb_build_object('rules',patch),'unresolved',to_jsonb(coalesce(d.unresolved,'{}')),'idempotencyKey','scan:'||s.id),'host');
  update fmat.calendar_scans set status='applied',decision_operation=p_operation,decision_input=p_input,revision=(result->>'revision')::integer where id=s.id;
  return fmat.calendar_scan_view(h.id);
 end if;
 raise exception 'FORBIDDEN';
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'INVALID_INPUT';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_calendar_scan"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."calendar_scan_dismissals"
  ADD CONSTRAINT "calendar_scan_dismissals_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."calendar_scans"
  ADD CONSTRAINT "calendar_scans_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

CREATE INDEX calendar_scans_host_created_idx ON fmat.calendar_scans USING btree (host_id, created_at DESC);

REVOKE ALL ON FUNCTION "fmat"."calendar_scan_view"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_calendar_scan"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_calendar_scan"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_calendar_scan"(text, jsonb, jsonb) TO "service_role";
