-- Content-free, best-effort observations. No actor/resource/error payload is stored.
create table fmat.rejection_counters (
  category text not null check(category in ('authorization_denied','stale_action')),
  bucket_start timestamptz not null check(date_trunc('hour',bucket_start at time zone 'UTC')=bucket_start at time zone 'UTC'),
  count integer not null check(count between 1 and 1000000),
  last_seen_at timestamptz not null,
  primary key(category,bucket_start),
  check(last_seen_at>=bucket_start and last_seen_at<bucket_start+interval '1 hour')
);
alter table fmat.rejection_counters enable row level security;
revoke all on fmat.rejection_counters from public,anon,authenticated,service_role;

create or replace function public.fmat_rejection_record(p_category text)
returns void language plpgsql security definer set search_path='' set lock_timeout='50ms' as $$
declare v_now timestamptz; v_bucket timestamptz;
begin
  if p_category is null or p_category not in ('authorization_denied','stale_action') then raise exception 'INVALID_INPUT';end if;
  -- Derive time after acquiring ownership so pruning and insertion use one window.
  perform pg_advisory_xact_lock(hashtextextended('fmat-rejection-counters',0));
  v_now:=clock_timestamp();v_bucket:=date_trunc('hour',v_now,'UTC');
  delete from fmat.rejection_counters where bucket_start<v_bucket-interval '23 hours' or bucket_start>v_bucket;
  insert into fmat.rejection_counters(category,bucket_start,count,last_seen_at) values(p_category,v_bucket,1,v_now)
    on conflict(category,bucket_start) do update
      set count=least(fmat.rejection_counters.count+1,1000000),last_seen_at=excluded.last_seen_at;
end;
$$;

create or replace function public.fmat_rejection_snapshot()
returns jsonb language sql stable security definer set search_path='' as $$
  with clock as (
    select statement_timestamp() as observed,date_trunc('hour',statement_timestamp(),'UTC') as bucket
  ), categories(category,position) as (values ('authorization_denied',1),('stale_action',2)), signals as (
    select c.category,c.position,coalesce(sum(r.count),0) as count,max(r.last_seen_at) as last_seen_at,
      coalesce(bool_or(r.count=1000000),false) as saturated
    from categories c cross join clock
    left join fmat.rejection_counters r on r.category=c.category and r.bucket_start between clock.bucket-interval '23 hours' and clock.bucket
    group by c.category,c.position
  )
  select jsonb_build_object('version',1,'scope','database_rpc','delivery','best_effort',
    'observedAt',clock.observed,'windowStart',clock.bucket-interval '23 hours','hourlyBuckets',24,
    'bucketLimit',1000000,'partialCurrentHour',true,
    'coverage',jsonb_build_object('preDatabaseDenials','not_recorded','uncategorizedRejections','not_recorded','releaseReadiness','not_assessed'),
    'signals',(select jsonb_agg(jsonb_build_object('category',category,'count',count,'lastSeenAt',last_seen_at,'saturated',saturated) order by position) from signals))
  from clock;
$$;

revoke execute on function public.fmat_rejection_record(text),public.fmat_rejection_snapshot() from public,anon,authenticated;
grant execute on function public.fmat_rejection_record(text),public.fmat_rejection_snapshot() to service_role;
