SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.wake_photon_handoffs()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_url text;v_secret text;
begin
 if not exists(select 1 from fmat.photon_inbox i join fmat.photon_receivers r on r.project_id=i.project_id
  where r.enabled and i.link_id is null and i.processed_at is null)
  and not exists(select 1 from fmat.photon_handoffs h join fmat.photon_receivers r on r.project_id=h.project_id
   where r.enabled and h.revoked_at is null and h.status in ('prepared','uncertain','accepted')
    and (h.lease_until is null or h.lease_until<=clock_timestamp()) and (h.checked_at is null or h.checked_at<=clock_timestamp()-interval '30 seconds')) then return null;end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if v_url is null or v_secret is null then return null;end if;
 if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 v_url:=replace(v_url,'/api/internal/conversations/dispatch','/api/internal/photon/handoffs');
 return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$function$;

REVOKE ALL ON FUNCTION "fmat"."wake_photon_handoffs"() FROM PUBLIC;

SELECT cron.schedule_in_database('fmat-photon-handoffs', '* * * * *', 'select fmat.wake_photon_handoffs();', 'postgres', NULL, true);
