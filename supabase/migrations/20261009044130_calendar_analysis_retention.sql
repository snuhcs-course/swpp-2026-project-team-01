SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.prune_calendar_scans()
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  SET lock_timeout TO '50ms'
  AS $function$
declare cutoff timestamptz:=clock_timestamp()-interval '24 hours'; removed integer;
begin
 with expired as materialized (
  select id from fmat.calendar_scans where created_at<cutoff
  order by created_at,id limit 1000 for update skip locked
 ), deleted as (
  delete from fmat.calendar_scans s using expired e
  where s.id=e.id and s.created_at<cutoff returning s.id
 ) select count(*)::integer into removed from deleted;
 return removed;
end;
$function$;

CREATE INDEX calendar_scans_expiry_idx ON fmat.calendar_scans USING btree (created_at, id);

REVOKE ALL ON FUNCTION "fmat"."prune_calendar_scans"() FROM PUBLIC;

SELECT cron.schedule_in_database('fmat-calendar-scan-retention', '* * * * *', 'set statement_timeout=''5s''; select fmat.prune_calendar_scans();', 'postgres', NULL, true);
