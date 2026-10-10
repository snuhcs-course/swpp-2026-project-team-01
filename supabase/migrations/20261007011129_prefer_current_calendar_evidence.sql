SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

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
 return jsonb_build_object('analysisStatus',fmat.calendar_scan_view(p_host)->'scan'->'status','progress',jsonb_build_object('analysisDecided',c.analysis_decided,'dismissedSuggestions',to_jsonb(c.dismissed_suggestions)),'revision',c.revision,'rulesVersion',h.rules_version,'calendarGeneration',g.generation,'calendarSelected',g.id is not null and cardinality(h.conflict_calendar_ids)>0 and h.booking_calendar_id is not null,
  'confirmed',jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules),
  'draft',case when d.revision is null then null else jsonb_build_object('revision',d.revision,'baseRulesVersion',d.base_rules_version,'settings',d.settings,'provenance',d.provenance,'origins',d.origins,'unresolved',to_jsonb(missing),'clarifications',to_jsonb(d.unresolved),'status',d.status) end,
  'review',case when r.revision is null or d.base_rules_version<>h.rules_version then null else jsonb_build_object('revision',r.revision,'draftRevision',r.draft_revision,'settings',r.settings,'status',r.status) end,
  'nextAction',case when g.id is null then 'connect_calendar' when cardinality(h.conflict_calendar_ids)=0 or h.booking_calendar_id is null then 'select_calendars' when d.revision is null then 'complete_preferences' when d.status='confirmed' and d.settings=jsonb_build_object('handle',h.handle,'displayName',h.display_name,'rules',h.rules) then 'settings_confirmed' when d.base_rules_version<>h.rules_version then 'refresh_draft' when cardinality(missing)>0 then 'complete_preferences' when r.status='pending' then 'confirm_review' else 'complete_preferences' end);
end;
$function$;

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));
