SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.wake_invitation_delivery()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare url text; secret text;
begin
 if not exists(select 1 from fmat.jobs j join fmat.invitation_deliveries d on d.invitation_id::text=j.payload->>'invitationId' where j.kind='invitation_delivery' and d.mode='cloudflare'
  and ((j.status='pending' and j.available_at<=clock_timestamp()) or (j.status='running' and j.lease_until<=clock_timestamp()))) then return null;end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if url is null or secret is null then return null;end if;
 if url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 return net.http_post(url:=replace(url,'/api/internal/conversations/dispatch','/api/internal/invitations/delivery'),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}',timeout_milliseconds:=120000);
end$function$;

REVOKE ALL ON FUNCTION "fmat"."wake_invitation_delivery"() FROM PUBLIC;

SELECT cron.schedule_in_database('fmat-invitation-delivery', '* * * * *', 'select fmat.wake_invitation_delivery();', 'postgres', NULL, true);
