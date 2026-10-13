SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.wake_photon_contacts()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_url text;v_secret text;
begin
 if not exists(select 1 from fmat.photon_contact_shares where status in ('queued','dispatching')
  and available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp())) then return null;end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if v_url is null or v_secret is null then return null;end if;
 if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 v_url:=replace(v_url,'/api/internal/conversations/dispatch','/api/internal/photon/contacts');
 return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_photon_contact_snapshot (
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
 if p_sample_limit is null or p_sample_limit<0 or p_sample_limit>20 then raise exception 'INVALID_INPUT';end if;
 with categories as (
  select category,ordinal from unnest(array['aged_contact_shares','failed_contact_shares','uncertain_contact_shares']) with ordinality as c(category,ordinal)
 ), observations as materialized (
  select 'aged_contact_shares'::text category,id,created_at since from fmat.photon_contact_shares where status='queued' and created_at<=statement_timestamp()-interval '5 minutes'
  union all select 'failed_contact_shares',id,updated_at from fmat.photon_contact_shares where status='failed'
  union all select 'uncertain_contact_shares',id,dispatched_at from fmat.photon_contact_shares where status in ('dispatching','uncertain')
 ), ranked as (
  select *,row_number() over(partition by category order by since,id) rank from observations
 ), summaries as (
  select category,count(*) total,min(since) oldest,
   coalesce(jsonb_agg(jsonb_build_object('id',id,'since',since) order by since,id) filter(where rank<=p_sample_limit),'[]'::jsonb) samples
  from ranked group by category
 )
 select jsonb_build_object('version',1,'scope','photon_contacts','observedAt',statement_timestamp(),'ageThresholdSeconds',300,'sampleLimit',p_sample_limit,
  'coverage',jsonb_build_object('deviceDelivery','not_observed','contactSaving','not_observed','releaseReadiness','not_assessed'),
  'signals',jsonb_agg(jsonb_build_object('category',c.category,'count',coalesce(s.total,0),'oldestAt',s.oldest,'samples',coalesce(s.samples,'[]'::jsonb)) order by c.ordinal))
 into result from categories c left join summaries s using(category);
 return result;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_contact_snapshot"(integer) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "fmat"."wake_photon_contacts"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_photon_contact_snapshot"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_contact_snapshot"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_contact_snapshot"(integer) TO "service_role";

SELECT cron.schedule_in_database('fmat-photon-contacts', '* * * * *', 'select fmat.wake_photon_contacts();', 'postgres', NULL, true);
