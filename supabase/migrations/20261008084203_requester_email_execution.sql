SET local check_function_bodies = off;

ALTER TABLE "fmat"."agentmail_inbox"
  ADD COLUMN "link_id" uuid;

ALTER TABLE "fmat"."agentmail_inbox"
  ADD COLUMN "verified_text" text;

ALTER TABLE "fmat"."agentmail_inbox"
  ADD COLUMN "runtime_message_id" uuid;

ALTER TABLE "fmat"."agentmail_inbox"
  ADD COLUMN "processing_outcome" text;

CREATE OR REPLACE FUNCTION fmat.requester_email_execution_actor (
  credential jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.agentmail_inbox; l fmat.requester_email_links; r fmat.requests; registration fmat.agentmail_receivers; evidence fmat.requester_email_evidence; original fmat.agentmail_inbox;
begin
 if credential->>'kind' is distinct from 'requester_email' or credential-array['kind','receiptId','linkId','receiverId']<>'{}' then raise exception 'UNAUTHORIZED';end if;
 select * into i from fmat.agentmail_inbox where id=(credential->>'receiptId')::uuid;
 if not found then raise exception 'UNAUTHORIZED';end if;
 select * into registration from fmat.agentmail_receivers where inbox_id=i.inbox_id for share;
 select * into l from fmat.requester_email_links where id=i.link_id and id=(credential->>'linkId')::uuid;
 if not found then raise exception 'UNAUTHORIZED';end if;
 select * into r from fmat.requests where id=l.request_id for update;
 select * into l from fmat.requester_email_links where id=i.link_id for share;
 select * into evidence from fmat.requester_email_evidence where receipt_id=i.id and link_id=l.id;
 select * into original from fmat.agentmail_inbox where id=l.bound_receipt_id;
 if evidence.receipt_id is null or i.verified_text is null or l.state<>'linked' or not registration.enabled
  or registration.receiver_id is distinct from i.receiver_id or i.receiver_id is distinct from (credential->>'receiverId')::uuid
  or l.receiver_id is distinct from i.receiver_id or l.inbox_id<>i.inbox_id or l.thread_id<>i.thread_id
  or l.expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp() or r.token_expires_at<=clock_timestamp()
  or r.token_revoked_at is not null or r.token_hash<>l.token_hash or r.status not in ('gathering','negotiating','awaiting_approval')
  or r.contact_verified_email is null or r.contact_verified_email is distinct from r.details->>'requesterEmail'
  or lower(r.contact_verified_email)<>l.email or evidence.author_email<>l.email
  or i.received_at<l.bound_at or i.received_order<=original.received_order then raise exception 'UNAUTHORIZED';end if;
 return jsonb_build_object('kind','guest','requestId',r.id,'tokenHash',r.token_hash,'channel','email');
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.wake_requester_email()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare url text; secret text;
begin
 if not exists(select 1 from fmat.agentmail_inbox i join fmat.agentmail_receivers r on r.inbox_id=i.inbox_id and r.receiver_id=i.receiver_id
  join fmat.jobs j on j.kind='agentmail_ingress' and j.payload->>'receiptId'=i.id::text
  where r.enabled and i.processed_at is null and ((j.status='pending' and j.available_at<=clock_timestamp()) or (j.status='running' and j.lease_until<=clock_timestamp()))) then return null;end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if url is null or secret is null then return null;end if;
 if url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 return net.http_post(url:=replace(url,'/api/internal/conversations/dispatch','/api/internal/agentmail/dispatch'),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_check (
  p_grant_id        uuid,
  p_conversation_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_scope fmat.conversation_scopes; v_grant fmat.conversation_grants; v_writable boolean;
begin
  select * into v_grant from fmat.conversation_grants where id=p_grant_id and conversation_id=p_conversation_id;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
  select * into v_scope from fmat.conversation_scopes where id=v_grant.conversation_id;
  -- Match request-command lock order. Keep revocation and the eventual tool
  -- effect serialized in this transaction, including an idempotent replay.
  if v_grant.credential->>'kind'='requester_email' then
    v_actor:=fmat.requester_email_execution_actor(v_grant.credential);
    if v_grant.actor_kind<>'guest' or v_scope.audience<>'request_shared' or v_scope.request_id::text is distinct from v_actor->>'requestId' then raise exception 'UNAUTHORIZED';end if;
  end if;
  perform 1 from fmat.requests where id=v_scope.request_id for update;
  if v_grant.credential->>'kind'='photon' then
    -- Link authority is issued only by the durable private inbox processor,
    -- never by credential_actor or a browser-supplied credential.
    if v_grant.actor_kind<>'host' or v_scope.audience<>'host_setup' then raise exception 'UNAUTHORIZED'; end if;
    v_actor:=fmat.photon_execution_actor(v_grant.credential);
  end if;
  perform 1 from fmat.hosts where id=v_scope.host_id for share;
  if v_grant.actor_kind='host' then
    perform 1 from auth.users where id=(v_grant.credential->>'subject')::uuid for share;
    perform 1 from auth.sessions where id=(v_grant.credential->>'sessionId')::uuid for share;
  end if;
  select * into v_scope from fmat.conversation_scopes where id=p_conversation_id for share;
  select * into v_grant from fmat.conversation_grants where id=p_grant_id and conversation_id=p_conversation_id for share;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
  if v_grant.credential->>'kind'='requester_email' then v_actor:=fmat.requester_email_execution_actor(v_grant.credential);
  elsif v_grant.credential->>'kind'<>'photon' then v_actor:=fmat.credential_actor(v_grant.credential); end if;
  v_writable:=fmat.authorize_conversation(v_scope,v_actor);
  -- A transaction may have waited for another writer. Recheck time-based
  -- authority against wall time after locks, not its earlier transaction time.
  if v_grant.actor_kind='host' and exists(select 1 from auth.sessions
    where id=(v_grant.credential->>'sessionId')::uuid and not_after<=clock_timestamp()) then raise exception 'UNAUTHORIZED'; end if;
  if exists(select 1 from fmat.requests where id=v_scope.request_id and status<>'booking' and expires_at<=clock_timestamp()) then
    if v_grant.actor_kind='guest' then raise exception 'REQUEST_EXPIRED'; end if;
    v_writable:=false;
  end if;
  return fmat.conversation_projection(v_scope,v_grant,v_writable)||jsonb_build_object('actor',v_actor);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_requester_email_worker (
  p_operation   text,
  p_receiver_id uuid,
  p_inbox_id    text,
  p_lease       jsonb,
  p_input       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j fmat.jobs; i fmat.agentmail_inbox; l fmat.requester_email_links; r fmat.requests; registration fmat.agentmail_receivers;
 actor jsonb; result jsonb; credential jsonb; scope fmat.conversation_scopes; g fmat.conversation_grants; outcome text; publication record;
begin
 if p_operation is null or p_operation not in ('claim','read','prepare','dispatch','reject','retry') or jsonb_typeof(p_lease) is distinct from 'object'
  or jsonb_typeof(p_input) is distinct from 'object' or length(coalesce(p_lease->>'workerId','')) not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','worker','id',p_lease->>'workerId');
 if p_operation='claim' then
  if p_lease-array['workerId']<>'{}' or p_input<>'{}' then raise exception 'INVALID_INPUT';end if;
  select job.* into j from fmat.jobs job join fmat.agentmail_inbox item on item.id::text=job.payload->>'receiptId'
   where job.kind='agentmail_ingress' and item.inbox_id=p_inbox_id and item.receiver_id=p_receiver_id and item.processed_at is null
   and exists(select 1 from fmat.agentmail_receivers where inbox_id=p_inbox_id and receiver_id=p_receiver_id and enabled)
   and ((job.status='pending' and job.available_at<=clock_timestamp()) or (job.status='running' and job.lease_until<=clock_timestamp()))
   and not exists(select 1 from fmat.agentmail_inbox prior where prior.inbox_id=item.inbox_id and prior.receiver_id=item.receiver_id and prior.thread_id=item.thread_id and prior.received_order<item.received_order and prior.processed_at is null)
   order by item.received_order limit 1 for update of job skip locked;
  if not found then return jsonb_build_object('job',null);end if;
  update fmat.jobs set status='running',attempts=attempts+1,worker_id=actor->>'id',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where id=j.id returning * into j;
  return jsonb_build_object('job',jsonb_build_object('workerId',j.worker_id,'jobId',j.id,'leaseToken',j.lease_token));
 end if;
 if p_lease-array['workerId','jobId','leaseToken']<>'{}' then raise exception 'INVALID_INPUT';end if;
 select * into j from fmat.jobs where id=(p_lease->>'jobId')::uuid for update;
 if not found or j.kind<>'agentmail_ingress' or j.status<>'running' or j.worker_id is distinct from p_lease->>'workerId'
  or j.lease_token is distinct from (p_lease->>'leaseToken')::uuid or j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 select * into i from fmat.agentmail_inbox where id=(j.payload->>'receiptId')::uuid and inbox_id=p_inbox_id and receiver_id=p_receiver_id;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into registration from fmat.agentmail_receivers where inbox_id=p_inbox_id for share;
 if not found or not registration.enabled or registration.receiver_id is distinct from p_receiver_id then raise exception 'CONFIGURATION_UNAVAILABLE';end if;
 if p_operation='read' then
  if p_input<>'{}' then raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('receiptId',i.id,'prepared',i.verified_text is not null);
 end if;
 if p_operation in ('dispatch','reject','retry') and p_input<>'{}' then raise exception 'INVALID_INPUT';end if;
 if p_operation='retry' and j.attempts<j.max_attempts then
  return fmat.foundation_command('jobs_fail',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'errorCode','PROVIDER_UNAVAILABLE'));
 end if;
 if p_operation in ('retry','reject') or j.attempts>j.max_attempts then outcome:='rejected';
 elsif p_operation='prepare' then
  if p_input-array['mode','proof','text']<>'{}' or coalesce(p_input->>'mode','') not in ('bind','authorize') or jsonb_typeof(p_input->'proof') is distinct from 'object'
   or p_input->'proof'->>'receiptId' is distinct from i.id::text then raise exception 'INVALID_INPUT';end if;
  if p_input->>'mode'='bind' then
   if p_input ? 'text' then raise exception 'INVALID_INPUT';end if;
   result:=public.fmat_requester_email_receipt('bind',p_receiver_id,p_inbox_id,p_input->'proof');outcome:='linked';
  else
   if jsonb_typeof(p_input->'text') is distinct from 'string' or length(trim(p_input->>'text')) not between 1 and 10000
    or p_input->>'text' ~* 'FMAT-LINK' then raise exception 'INVALID_INPUT';end if;
   result:=public.fmat_requester_email_receipt('authorize',p_receiver_id,p_inbox_id,p_input->'proof');
   if i.verified_text is not null and (i.verified_text<>p_input->>'text' or i.link_id::text<>result->>'linkId') then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   select * into r from fmat.requests where id=(result->>'requestId')::uuid;
   insert into fmat.conversation_scopes(host_id,request_id,audience) values(r.host_id,r.id,'request_shared') on conflict do nothing;
   update fmat.agentmail_inbox set link_id=(result->>'linkId')::uuid,verified_text=p_input->>'text' where id=i.id;
   if j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
   return jsonb_build_object('outcome','prepared');
  end if;
 else
  if i.verified_text is null or i.link_id is null then raise exception 'INVALID_INPUT';end if;
  select * into l from fmat.requester_email_links where id=i.link_id;
  select * into scope from fmat.conversation_scopes where request_id=l.request_id and audience='request_shared';
  if not found then raise exception 'NOT_FOUND';end if;
  -- Preparation committed scope creation separately. Runtime lock always precedes request locking here.
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||scope.id::text,0));
  credential:=jsonb_build_object('kind','requester_email','receiptId',i.id,'linkId',i.link_id,'receiverId',i.receiver_id);
  begin
   perform fmat.requester_email_execution_actor(credential);
   insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
    values(scope.id,'guest','requester-email:'||i.id::text,credential,l.expires_at) on conflict do nothing;
   select * into strict g from fmat.conversation_grants where conversation_id=scope.id and actor_kind='guest' and authority_key='requester-email:'||i.id::text;
   result:=public.fmat_runtime_message('accept',g.id,scope.id,jsonb_build_object('clientId',i.id,'text',i.verified_text));
   update fmat.runtime_messages set next_dispatch_at=clock_timestamp() where id=(result->>'id')::uuid and status='pending';outcome:='accepted';
  exception when raise_exception then
   if sqlerrm='CONVERSATION_BUSY' then
    if j.attempts>=j.max_attempts then outcome:='limited';else return fmat.foundation_command('jobs_fail',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'errorCode','CONVERSATION_BUSY'));end if;
   elsif sqlerrm in ('UNAUTHORIZED','NOT_FOUND','FORBIDDEN','REQUEST_CLOSED','REQUEST_EXPIRED') then outcome:='rejected';
   elsif sqlerrm='CONVERSATION_LIMIT' then outcome:='limited';else raise;end if;
  end;
 end if;
 if j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 update fmat.agentmail_inbox set processed_at=clock_timestamp(),processing_outcome=outcome,runtime_message_id=case when outcome='accepted' then (result->>'id')::uuid else null end where id=i.id;
 perform fmat.foundation_command('jobs_complete',actor,jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'result',jsonb_build_object('outcome',outcome)));
 for publication in select message_id from fmat.queue_publications where job_id=j.id and acknowledged_at is null loop
  perform pgmq.archive('fmat_jobs',publication.message_id);
 end loop;
 update fmat.queue_publications set acknowledged_at=clock_timestamp() where job_id=j.id and acknowledged_at is null;
 return jsonb_build_object('outcome',outcome);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_requester_email_worker"(text, uuid, text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."agentmail_inbox"
  ADD CONSTRAINT "agentmail_inbox_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.requester_email_links(id);

ALTER TABLE "fmat"."agentmail_inbox"
  ADD CONSTRAINT "agentmail_inbox_processing_outcome_check" CHECK ((processing_outcome = ANY (ARRAY['linked'::text, 'accepted'::text, 'rejected'::text, 'limited'::text])));

ALTER TABLE "fmat"."agentmail_inbox"
  ADD CONSTRAINT "agentmail_inbox_runtime_message_id_fkey" FOREIGN KEY (runtime_message_id) REFERENCES fmat.runtime_messages(id);

ALTER TABLE "fmat"."agentmail_inbox"
  ADD CONSTRAINT "agentmail_inbox_verified_text_check" CHECK (((length(verified_text) >= 1) AND (length(verified_text) <= 10000)));

CREATE INDEX agentmail_inbox_link_idx ON fmat.agentmail_inbox USING btree (link_id);

CREATE INDEX agentmail_inbox_runtime_idx ON fmat.agentmail_inbox USING btree (runtime_message_id);

REVOKE ALL ON FUNCTION "fmat"."requester_email_execution_actor"(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."wake_requester_email"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_requester_email_worker"(text, uuid, text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_email_worker"(text, uuid, text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_email_worker"(text, uuid, text, jsonb, jsonb) TO "service_role";

SELECT cron.schedule_in_database('fmat-requester-email', '* * * * *', 'select fmat.wake_requester_email();', 'postgres', NULL, true);
