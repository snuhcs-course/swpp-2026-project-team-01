SET local check_function_bodies = off;

CREATE TABLE "fmat"."conversation_budgets" (
  "name"              text                     NOT NULL,
  "minute_started_at" timestamp with time zone NOT NULL,
  "minute_used"       integer                  NOT NULL,
  "hour_started_at"   timestamp with time zone NOT NULL,
  "hour_used"         integer                  NOT NULL,
  CONSTRAINT "conversation_budgets_hour_used_check" CHECK ((hour_used >= 0)),
  CONSTRAINT "conversation_budgets_minute_used_check" CHECK ((minute_used >= 0)),
  CONSTRAINT "conversation_budgets_name_check" CHECK (((name = 'service'::text) OR (name ~ '^(host|guest):[a-f0-9-]{36}$'::text))),
  CONSTRAINT "conversation_budgets_pkey" PRIMARY KEY (name)
);

ALTER TABLE "fmat"."conversation_budgets"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.conversation_budget_charge (
  p_kind text,
  p_id   uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare key text; b fmat.conversation_budgets; checked_at timestamptz; minute_limit integer; hour_limit integer;
begin
 if p_kind is null or p_kind not in ('host','guest') or p_id is null then raise exception 'UNAUTHORIZED';end if;
 foreach key in array array['service',p_kind||':'||p_id::text] loop
  insert into fmat.conversation_budgets values(key,clock_timestamp(),0,clock_timestamp(),0) on conflict do nothing;
  perform 1 from fmat.conversation_budgets where name=key for update;
 end loop;
 checked_at:=clock_timestamp();
 foreach key in array array['service',p_kind||':'||p_id::text] loop
  select * into strict b from fmat.conversation_budgets where name=key;
  if b.minute_started_at+interval '1 minute'<=checked_at then b.minute_started_at:=checked_at;b.minute_used:=0;end if;
  if b.hour_started_at+interval '1 hour'<=checked_at then b.hour_started_at:=checked_at;b.hour_used:=0;end if;
  minute_limit:=case when key='service' then 200 else 20 end;
  hour_limit:=case when key='service' then 2000 else 100 end;
  if b.minute_used>=minute_limit or b.hour_used>=hour_limit then raise exception 'CONVERSATION_RATE_LIMIT';end if;
  update fmat.conversation_budgets set minute_started_at=b.minute_started_at,minute_used=b.minute_used+1,
   hour_started_at=b.hour_started_at,hour_used=b.hour_used+1 where name=key;
 end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_photon_dispatch (
  p_project_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; j fmat.jobs; l fmat.photon_links; s fmat.conversation_scopes;
 g fmat.conversation_grants; credential jsonb; accepted jsonb; outcome text; publication record;
begin
 select j0.* into j from fmat.jobs j0
 join fmat.photon_inbox i0 on j0.dedupe_key='photon-ingress:'||i0.id::text and j0.kind='photon_ingress'
 join fmat.photon_links l0 on l0.id=i0.link_id
 where i0.project_id=p_project_id and i0.processed_at is null
  and ((j0.status='pending' and j0.available_at<=clock_timestamp()) or (j0.status='running' and j0.lease_until<=clock_timestamp()))
  and not exists(select 1 from fmat.photon_inbox prior where prior.project_id=i0.project_id
   and prior.line=i0.line and prior.space_id=i0.space_id and prior.link_id is not null
   and prior.processed_at is null and prior.received_order<i0.received_order)
  and not exists(select 1 from fmat.conversation_scopes cs join fmat.runtime_messages rm on rm.conversation_id=cs.id
   where cs.host_id=l0.host_id and cs.audience='host_setup' and rm.status='pending')
 order by i0.received_order limit 1 for update of j0 skip locked;
 if not found then return jsonb_build_object('outcome','idle'); end if;
 select * into strict i from fmat.photon_inbox where id=(j.payload->>'inboxId')::uuid;
 select * into strict l from fmat.photon_links where id=i.link_id;
 credential:=jsonb_build_object('kind','photon','linkId',l.id,'inboxId',i.id,'receiverId',i.receiver_id);
 begin
  -- Open the canonical scope without giving the caller an execution grant.
  insert into fmat.conversation_scopes(host_id,request_id,audience) values(l.host_id,null,'host_setup') on conflict do nothing;
  select * into strict s from fmat.conversation_scopes where host_id=l.host_id and audience='host_setup';
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||s.id::text,0));
  perform fmat.photon_execution_actor(credential);
  insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
   values(s.id,'host','photon:'||i.id::text,credential,i.received_at+interval '1 hour')
   on conflict(conversation_id,actor_kind,authority_key) do nothing;
  select * into strict g from fmat.conversation_grants where conversation_id=s.id and actor_kind='host' and authority_key='photon:'||i.id::text;
  accepted:=public.fmat_runtime_message('accept',g.id,s.id,jsonb_build_object('clientId',i.id,'text',i.text));
  update fmat.runtime_messages set next_dispatch_at=clock_timestamp() where id=(accepted->>'id')::uuid and status='pending';
  outcome:='accepted';
 exception when raise_exception then
  if sqlerrm='CONVERSATION_RATE_LIMIT' then
   update fmat.jobs set status='pending',available_at=clock_timestamp()+interval '1 minute',
    lease_token=null,lease_until=null,worker_id=null,last_error='CONVERSATION_RATE_LIMIT',updated_at=clock_timestamp() where id=j.id;
   return jsonb_build_object('outcome','busy');
  elsif sqlerrm='CONVERSATION_BUSY' then return jsonb_build_object('outcome','busy');
  elsif sqlerrm in ('UNAUTHORIZED','NOT_FOUND','HOST_NOT_ADMITTED') then outcome:='revoked';
  elsif sqlerrm='CONVERSATION_LIMIT' then outcome:='limited';
  else raise; end if;
 end;
 update fmat.photon_inbox set processed_at=clock_timestamp(),processing_outcome=outcome,
  runtime_message_id=case when outcome='accepted' then (accepted->>'id')::uuid else null end where id=i.id;
 update fmat.jobs set status='complete',lease_token=null,lease_until=null,worker_id=null,last_error=null,
  result=jsonb_build_object('outcome',outcome),updated_at=clock_timestamp() where id=j.id;
 for publication in select message_id from fmat.queue_publications where job_id=j.id and acknowledged_at is null loop
  perform pgmq.archive('fmat_jobs',publication.message_id);
 end loop;
 update fmat.queue_publications set acknowledged_at=clock_timestamp() where job_id=j.id and acknowledged_at is null;
 return jsonb_build_object('outcome',outcome);
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
   if sqlerrm='CONVERSATION_RATE_LIMIT' then
    if j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
    update fmat.jobs set status='pending',available_at=clock_timestamp()+interval '1 minute',attempts=greatest(0,attempts-1),
     lease_token=null,lease_until=null,worker_id=null,last_error='CONVERSATION_RATE_LIMIT',updated_at=clock_timestamp() where id=j.id;
    return jsonb_build_object('retry',true);
   elsif sqlerrm='CONVERSATION_BUSY' then
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

CREATE OR REPLACE FUNCTION public.fmat_runtime_message (
  p_operation       text,
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_access jsonb; v_message fmat.runtime_messages; v_scope fmat.conversation_scopes; v_session text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  if p_operation='settle' then
    -- A runtime may record completion after the originating grant expires.
    -- Reply preparation separately requires current private-channel authority.
    select * into v_scope from fmat.conversation_scopes where id=p_conversation_id;
    if v_scope.runtime_session_id is null or v_scope.runtime_session_id is distinct from p_input->>'sessionId' then raise exception 'FORBIDDEN'; end if;
    if p_input->>'status' is null or p_input->>'status' not in ('completed','failed') then raise exception 'INVALID_INPUT'; end if;
    -- Commit an eligible private reply in the same transaction as completion.
    -- A failed write leaves the input pending for checkpoint-based recovery.
    perform fmat.photon_reply_prepare(p_grant_id,p_conversation_id,p_input);
    perform fmat.requester_email_reply_prepare(p_grant_id,p_conversation_id,p_input);
    update fmat.runtime_messages set status=p_input->>'status',settled_at=clock_timestamp()
      where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id and status='pending';
    return jsonb_build_object('recorded',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  -- Serialize accept/bind against other participants on this shared scope.
  select * into v_scope from fmat.conversation_scopes where id=p_conversation_id for update;
  if p_operation='inspect' then
    return jsonb_build_object('sessionId',v_scope.runtime_session_id,'messages',(
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'status',status,'createdAt',created_at,
        'mine',grant_id=p_grant_id) order by created_at,id),'[]'::jsonb) from fmat.runtime_messages where conversation_id=p_conversation_id));
  end if;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if p_operation='accept' then
    if coalesce(p_input->>'clientId','')='' or jsonb_typeof(p_input->'text') is distinct from 'string'
      or length(trim(p_input->>'text')) not between 1 and 10000
      or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('clientId','text')) then raise exception 'INVALID_INPUT'; end if;
    select * into v_message from fmat.runtime_messages where conversation_id=p_conversation_id and grant_id=p_grant_id and client_id=(p_input->>'clientId')::uuid;
    if found then
      if v_message.text is distinct from p_input->>'text' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    else
      if exists(select 1 from fmat.runtime_messages where conversation_id=p_conversation_id and status='pending') then raise exception 'CONVERSATION_BUSY'; end if;
      -- Bounded inbox/checkpoint growth; the runtime has independent token caps.
      if (select count(*) from fmat.runtime_messages where conversation_id=p_conversation_id)>=200 then raise exception 'CONVERSATION_LIMIT'; end if;
      perform fmat.conversation_budget_charge(v_access->>'actorKind',
        case when v_access->>'actorKind'='host' then v_scope.host_id else v_scope.request_id end);
      -- Quota contention may outlast a grant, Auth session or request deadline.
      v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
      if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
      insert into fmat.runtime_messages(conversation_id,grant_id,client_id,text)
        values(p_conversation_id,p_grant_id,(p_input->>'clientId')::uuid,p_input->>'text') returning * into v_message;
    end if;
  elsif p_operation='deliver' then
    select * into v_message from fmat.runtime_messages where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_session:=p_input->>'sessionId';
    if length(coalesce(v_session,'')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
    if v_scope.runtime_session_id is not null and v_scope.runtime_session_id<>v_session then raise exception 'FORBIDDEN'; end if;
    update fmat.conversation_scopes set runtime_session_id=v_session where id=p_conversation_id and runtime_session_id is null;
  else raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('id',v_message.id,'status',v_message.status,'text',v_message.text);
end;
$function$;

REVOKE ALL ON FUNCTION "fmat"."conversation_budget_charge"(text, uuid) FROM PUBLIC;
