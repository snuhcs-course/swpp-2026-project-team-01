SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

ALTER TABLE "fmat"."oauth_authorizations"
  DROP CONSTRAINT "oauth_authorizations_state_check";

ALTER TABLE "fmat"."oauth_clients"
  DROP CONSTRAINT "oauth_clients_name_check";

CREATE OR REPLACE FUNCTION public.fmat_operational_snapshot (
  p_sample_limit integer DEFAULT 10
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result jsonb;
begin
 if p_sample_limit is null or p_sample_limit<0 or p_sample_limit>20 then raise exception 'INVALID_INPUT'; end if;
 with categories as (
  select category,ordinal from unnest(array[
   'overdue_jobs','expired_job_leases','dead_jobs','pending_runtime','failed_runtime',
   'held_reservations','uncertain_bookings','failed_delivery','uncertain_delivery',
   'failed_photon_replies','uncertain_photon_replies','uncertain_email_replies','mismatched_decisions'
  ]) with ordinality as c(category,ordinal)
 ), observations as materialized (
  select 'overdue_jobs'::text category,id,available_at since from fmat.jobs where status='pending' and available_at<=statement_timestamp()-interval '5 minutes'
  union all select 'expired_job_leases',id,lease_until from fmat.jobs where status='running' and lease_until<=statement_timestamp()
  union all select 'dead_jobs',id,updated_at from fmat.jobs where status='dead'
  union all select 'pending_runtime',id,created_at from fmat.runtime_messages where status='pending' and created_at<=statement_timestamp()-interval '5 minutes'
  union all select 'failed_runtime',id,created_at from fmat.runtime_messages where status='failed'
  union all select 'held_reservations',attempt_id,created_at from fmat.host_reservations
  union all select 'uncertain_bookings',id,coalesce(dispatched_at,created_at) from fmat.booking_attempts where phase in ('dispatched','uncertain','conflict')
  union all select 'failed_delivery',id,updated_at from fmat.outbox where status='failed'
  union all select 'uncertain_delivery',id,updated_at from fmat.outbox where status='uncertain'
  union all select 'failed_photon_replies',id,created_at from fmat.photon_replies where status='failed'
  union all select 'uncertain_photon_replies',id,coalesce(checked_at,created_at) from fmat.photon_replies where status='uncertain' and revoked_at is null
  union all select 'uncertain_email_replies',id,coalesce(first_attempt_at,created_at) from fmat.requester_email_replies where status='uncertain' and suppressed_at is null
  union all select 'mismatched_decisions',id,updated_at from fmat.requests
   where status in ('negotiating','awaiting_approval','booking') and current_proposal_version is not null
    and ((requester_agreed_version is not null and requester_agreed_version<>current_proposal_version)
      or (host_approved_version is not null and host_approved_version<>current_proposal_version))
 ), ranked as (
  select *,row_number() over(partition by category order by since,id) rank from observations
 ), summaries as (
  select category,count(*) total,min(since) oldest,
   coalesce(jsonb_agg(jsonb_build_object('id',id,'since',since) order by since,id) filter(where rank<=p_sample_limit),'[]'::jsonb) samples
  from ranked group by category
 )
 select jsonb_build_object('version',1,'observedAt',statement_timestamp(),'ageThresholdSeconds',300,'sampleLimit',p_sample_limit,
  'coverage',jsonb_build_object('authorizationDenialEvents','not_recorded','rejectedStaleActionEvents','not_recorded','releaseReadiness','not_assessed'),
  'signals',jsonb_agg(jsonb_build_object('category',c.category,'count',coalesce(s.total,0),'oldestAt',s.oldest,'samples',coalesce(s.samples,'[]'::jsonb)) order by c.ordinal))
 into result from categories c left join summaries s using(category);
 return result;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_operational_snapshot"(integer) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."oauth_authorizations"
  ADD CONSTRAINT "oauth_authorizations_state_check" CHECK ((((length(state) >= 1) AND (length(state) <= 1024)) AND (state !~ '[[:cntrl:]]'::text)));

ALTER TABLE "fmat"."oauth_clients"
  ADD CONSTRAINT "oauth_clients_name_check" CHECK ((((length(name) >= 1) AND (length(name) <= 120)) AND (name !~ '[[:cntrl:]]'::text)));

REVOKE ALL ON FUNCTION "public"."fmat_operational_snapshot"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_operational_snapshot"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_operational_snapshot"(integer) TO "service_role";
