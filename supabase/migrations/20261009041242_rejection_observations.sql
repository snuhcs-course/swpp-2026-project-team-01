SET local check_function_bodies = off;

CREATE TABLE "fmat"."rejection_counters" (
  "category"     text                     NOT NULL,
  "bucket_start" timestamp with time zone NOT NULL,
  "count"        integer                  NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  CONSTRAINT "rejection_counters_bucket_start_check" CHECK ((date_trunc('hour'::text, (bucket_start AT TIME ZONE 'UTC'::text)) = (bucket_start AT TIME ZONE 'UTC'::text))),
  CONSTRAINT "rejection_counters_category_check" CHECK ((category = ANY (ARRAY['authorization_denied'::text, 'stale_action'::text]))),
  CONSTRAINT "rejection_counters_check" CHECK (((last_seen_at >= bucket_start) AND (last_seen_at < (bucket_start + '01:00:00'::interval)))),
  CONSTRAINT "rejection_counters_count_check" CHECK (((count >= 1) AND (count <= 1000000))),
  CONSTRAINT "rejection_counters_pkey" PRIMARY KEY (category, bucket_start)
);

ALTER TABLE "fmat"."rejection_counters"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fmat_rejection_record (
  p_category text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  SET lock_timeout TO '50ms'
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_rejection_record"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_rejection_snapshot()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_rejection_snapshot"() FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fmat_rejection_record"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_rejection_record"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_rejection_record"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_rejection_snapshot"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_rejection_snapshot"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_rejection_snapshot"() TO "service_role";
