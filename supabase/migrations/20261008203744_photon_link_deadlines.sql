SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fmat_photon_link (
  p_operation  text,
  p_credential jsonb,
  p_project_id uuid,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor jsonb; host uuid; c fmat.photon_link_challenges; a fmat.photon_link_attempts; l fmat.photon_links; outcome text;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN'; end if;
 actor:=fmat.calendar_actor(p_credential);host:=(actor->>'id')::uuid;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 if p_operation='read' then return fmat.photon_link_view(host,p_project_id,p_input->>'browserHash',p_credential->>'sessionId'); end if;
 if p_operation in ('start','start_replay') then
  if coalesce(p_input->>'phone','')!~'^\+[1-9][0-9]{7,14}$' or coalesce(p_input->>'browserHash','')!~'^[a-f0-9]{64}$' or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT'; end if;
  select * into c from fmat.photon_link_challenges where host_id=host and request_key=(p_input->>'idempotencyKey')::uuid;
  if found then
   if c.phone<>p_input->>'phone' or c.browser_hash<>p_input->>'browserHash' or c.project_id is distinct from p_project_id or c.credential->>'sessionId' is distinct from p_credential->>'sessionId' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return fmat.photon_link_view(host,p_project_id,p_input->>'browserHash',p_credential->>'sessionId');
  end if;
  if p_operation='start_replay' then return null; end if;
  perform 1 from fmat.photon_receivers where project_id=p_project_id and enabled for share;
  if not found then raise exception 'CONFIGURATION_UNAVAILABLE'; end if;
  if exists(select 1 from fmat.photon_links where host_id=host and revoked_at is null) then raise exception 'LINK_CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('photon-link:'||p_project_id::text||':'||(p_input->>'phone'),0));
  -- Authority rows are already locked, but their deadlines keep advancing.
  actor:=fmat.calendar_actor(p_credential);
  if exists(select 1 from fmat.photon_link_challenges where (host_id=host or (project_id=p_project_id and phone=p_input->>'phone')) and created_at>clock_timestamp()-interval '1 minute')
   or (select count(*) from fmat.photon_link_challenges where host_id=host and created_at>clock_timestamp()-interval '1 hour')>=5
   or (select count(*) from fmat.photon_link_challenges where project_id=p_project_id and phone=p_input->>'phone' and created_at>clock_timestamp()-interval '1 hour')>=5 then raise exception 'IMESSAGE_LIMIT'; end if;
  if coalesce(p_input->>'codeHash','')!~'^[a-f0-9]{64}$' or length(coalesce(p_input->>'encryptedCode','')) not between 30 and 1024
   or coalesce(p_input->>'line','')='' or p_input->>'spaceId' is distinct from 'any;-;'||(p_input->>'phone') then raise exception 'INVALID_INPUT'; end if;
  update fmat.photon_link_challenges set revoked_at=clock_timestamp(),encrypted_code=null where host_id=host and consumed_at is null and revoked_at is null;
  insert into fmat.photon_link_challenges(id,host_id,project_id,credential,browser_hash,phone,line,space_id,code_hash,encrypted_code,request_key)
   values((p_input->>'challengeId')::uuid,host,p_project_id,p_credential,p_input->>'browserHash',p_input->>'phone',p_input->>'line',p_input->>'spaceId',p_input->>'codeHash',p_input->>'encryptedCode',(p_input->>'idempotencyKey')::uuid) returning * into c;
  insert into fmat.photon_link_preferences(host_id,skipped) values(host,false) on conflict(host_id) do update set skipped=false;
  -- This row is also the durable outbound intent. Its lease and scheduled
  -- sweep own recovery; no second queue/job lifecycle can trigger a resend.
 elsif p_operation='verify' then
  if coalesce(p_input->>'codeHash','')!~'^[a-f0-9]{64}$' or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT'; end if;
  perform 1 from fmat.photon_receivers where project_id=p_project_id and enabled for share;
  if not found then raise exception 'CONFIGURATION_UNAVAILABLE'; end if;
  select * into c from fmat.photon_link_challenges where id=(p_input->>'challengeId')::uuid and host_id=host and project_id=p_project_id for update;
  if not found or c.browser_hash is distinct from p_input->>'browserHash' or c.credential->>'sessionId' is distinct from p_credential->>'sessionId'
   or c.revoked_at is not null then raise exception 'CHALLENGE_INVALID'; end if;
  actor:=fmat.calendar_actor(p_credential);
  select * into a from fmat.photon_link_attempts where challenge_id=c.id and key=(p_input->>'idempotencyKey')::uuid;
  if found then
   if a.code_hash is distinct from p_input->>'codeHash' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   if a.outcome='linked' and not exists(select 1 from fmat.photon_links where challenge_id=c.id and revoked_at is null) then raise exception 'CHALLENGE_INVALID'; end if;
   return fmat.photon_link_view(host,p_project_id,p_input->>'browserHash',p_credential->>'sessionId')||jsonb_build_object('outcome',a.outcome);
  end if;
  if not fmat.photon_handoff_challenge_valid(c.id) or c.expires_at<=clock_timestamp() or c.consumed_at is not null or c.failed_attempts>=5 or c.delivery_status not in ('uncertain','accepted','delivered') then raise exception 'CHALLENGE_INVALID'; end if;
  if c.code_hash is distinct from p_input->>'codeHash' then
   update fmat.photon_link_challenges set failed_attempts=failed_attempts+1,encrypted_code=case when failed_attempts=4 then null else encrypted_code end where id=c.id;outcome:='invalid_code';
  else
   perform pg_advisory_xact_lock(hashtextextended('photon-link:'||c.project_id::text||':'||c.phone,0));
   actor:=fmat.calendar_actor(p_credential);
   if c.expires_at<=clock_timestamp() or not fmat.photon_handoff_challenge_valid(c.id) then raise exception 'CHALLENGE_INVALID'; end if;
   if exists(select 1 from fmat.photon_links where revoked_at is null and (host_id=host or (project_id=c.project_id and phone=c.phone))) then raise exception 'LINK_CONFLICT'; end if;
   insert into fmat.photon_links(host_id,project_id,phone,line,space_id,challenge_id) values(host,c.project_id,c.phone,c.line,c.space_id,c.id) returning * into l;
   update fmat.photon_link_challenges set consumed_at=clock_timestamp(),encrypted_code=null where id=c.id;
   perform fmat.audit('photon_link',actor,l.id::text);outcome:='linked';
  end if;
  insert into fmat.photon_link_attempts(challenge_id,key,code_hash,outcome) values(c.id,(p_input->>'idempotencyKey')::uuid,p_input->>'codeHash',outcome);
 elsif p_operation in ('cancel','skip') then
  update fmat.photon_link_challenges set revoked_at=clock_timestamp(),encrypted_code=null where host_id=host and consumed_at is null and revoked_at is null
   and (p_operation='skip' or id=(p_input->>'challengeId')::uuid);
  if p_operation='skip' then insert into fmat.photon_link_preferences(host_id,skipped) values(host,true) on conflict(host_id) do update set skipped=true; end if;
 elsif p_operation='unlink' then
  update fmat.photon_links set revoked_at=clock_timestamp() where id=(p_input->>'linkId')::uuid and host_id=host and revoked_at is null returning * into l;
  if found then perform fmat.audit('photon_unlink',actor,l.id::text); end if;
 else raise exception 'INVALID_INPUT'; end if;
 return fmat.photon_link_view(host,p_project_id,p_input->>'browserHash',p_credential->>'sessionId')||case when outcome is null then '{}'::jsonb else jsonb_build_object('outcome',outcome) end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_photon_link_delivery (
  p_operation  text,
  p_project_id uuid,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare c fmat.photon_link_challenges; actor jsonb; valid boolean; action text; result jsonb:='[]'; candidate uuid;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 if p_operation='claim' then
  -- Select oldest-due work first, then lock its hosts in consistent order.
  for candidate in select due.id from (select id,host_id from fmat.photon_link_challenges where project_id=p_project_id and consumed_at is null and revoked_at is null
   and (lease_until is null or lease_until<clock_timestamp()) and delivery_status in ('prepared','uncertain','accepted')
   and (checked_at is null or checked_at<clock_timestamp()-interval '30 seconds') order by checked_at nulls first,created_at,id limit 5) due order by due.host_id,due.id loop
   select * into c from fmat.photon_link_challenges where id=candidate;
   valid:=true;
   begin
    actor:=fmat.calendar_actor(c.credential);
   exception when raise_exception then
    if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','HOST_NOT_ADMITTED','NOT_FOUND') then valid:=false; else raise; end if;
   end;
   select * into c from fmat.photon_link_challenges where id=candidate for update skip locked;
   if not found or c.consumed_at is not null or c.revoked_at is not null or (c.lease_until is not null and c.lease_until>clock_timestamp())
    or c.delivery_status not in ('prepared','uncertain','accepted')
    or (c.checked_at is not null and c.checked_at>=clock_timestamp()-interval '30 seconds') then continue; end if;
   if not valid or not fmat.photon_handoff_challenge_valid(c.id) or c.expires_at<=clock_timestamp() or c.failed_attempts>=5 or not exists(select 1 from fmat.photon_receivers where project_id=p_project_id and enabled) then
    update fmat.photon_link_challenges set revoked_at=clock_timestamp(),encrypted_code=null,delivery_status='revoked' where id=c.id;continue;
   end if;
   action:=case when c.delivery_status='prepared' then 'send' else 'reconcile' end;
   update fmat.photon_link_challenges set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',checked_at=clock_timestamp(),
    delivery_status=case when action='send' then 'uncertain' else delivery_status end where id=c.id returning * into c;
   result:=result||jsonb_build_array(jsonb_build_object('challengeId',c.id,'hostId',c.host_id,'projectId',c.project_id,'phone',c.phone,'line',c.line,'spaceId',c.space_id,
    'encryptedCode',case when action='send' then c.encrypted_code else null end,'providerReference',c.provider_reference,'leaseToken',c.lease_token,'action',action));
  end loop;return result;
 end if;
 select * into c from fmat.photon_link_challenges where id=(p_input->>'challengeId')::uuid and project_id=p_project_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_operation='authorize' then
  actor:=fmat.calendar_actor(c.credential);
  perform 1 from fmat.photon_receivers where project_id=p_project_id and enabled for share;
  if not found then raise exception 'FORBIDDEN'; end if;
 end if;
 select * into c from fmat.photon_link_challenges where id=c.id for update;
 if c.lease_token is null or c.lease_until is null or c.lease_token is distinct from (p_input->>'leaseToken')::uuid or c.lease_until<=clock_timestamp() then raise exception 'REVISION_CONFLICT'; end if;
 if p_operation='authorize' then
  actor:=fmat.calendar_actor(c.credential);
  if not fmat.photon_handoff_challenge_valid(c.id) or c.consumed_at is not null or c.revoked_at is not null or c.expires_at<=clock_timestamp() or c.failed_attempts>=5 then raise exception 'FORBIDDEN'; end if;
  return '{}'::jsonb;
 elsif p_operation='finish' then
  if p_input->>'status' is null or p_input->>'status' not in ('accepted','delivered','failed','uncertain') then raise exception 'INVALID_INPUT'; end if;
  update fmat.photon_link_challenges set delivery_status=case when revoked_at is not null then 'revoked' when delivery_status='accepted' and p_input->>'status'='uncertain' then 'accepted' else p_input->>'status' end,
   provider_reference=coalesce(p_input->>'providerReference',provider_reference),lease_until=null,lease_token=null,
   encrypted_code=case when p_input->>'status' in ('failed','delivered') then null else encrypted_code end where id=c.id;
  return '{}'::jsonb;
 end if;
 raise exception 'INVALID_INPUT';
end;
$function$;

