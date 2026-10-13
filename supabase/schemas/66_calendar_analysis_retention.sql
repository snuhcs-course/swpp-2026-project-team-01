-- The existing host-bound cleanup uses the same strict 24-hour cutoff.
create index calendar_scans_expiry_idx on fmat.calendar_scans(created_at,id);

create or replace function fmat.prune_calendar_scans()
returns integer language plpgsql security invoker set search_path='' set lock_timeout='50ms' as $$
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
$$;
revoke all on function fmat.prune_calendar_scans() from public,anon,authenticated,service_role;
select cron.schedule('fmat-calendar-scan-retention','* * * * *',
 'set statement_timeout=''5s''; select fmat.prune_calendar_scans();');
