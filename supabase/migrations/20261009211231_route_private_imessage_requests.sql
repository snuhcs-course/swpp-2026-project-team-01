SET local check_function_bodies = off;

ALTER TABLE "fmat"."photon_inbox"
  ADD COLUMN "conversation_id" uuid;

ALTER TABLE "fmat"."photon_inbox"
  ADD COLUMN "execution_grant_id" uuid;

ALTER TABLE "fmat"."photon_links"
  ADD COLUMN "selected_request_id" uuid;

CREATE OR REPLACE FUNCTION fmat.host_request_model_page (
  p_host_id uuid,
  p_input   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare page jsonb; rows jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or p_input-array['search','status','beforeCreatedAt','beforeId']<>'{}'::jsonb
  or (p_input?'search' and jsonb_typeof(p_input->'search') is distinct from 'string')
  or (p_input?'status' and jsonb_typeof(p_input->'status') is distinct from 'string')
  or (p_input?'beforeCreatedAt' and jsonb_typeof(p_input->'beforeCreatedAt') is distinct from 'string')
  or (p_input?'beforeId' and jsonb_typeof(p_input->'beforeId') is distinct from 'string')
  then raise exception 'INVALID_INPUT'; end if;
 page:=fmat.host_request_page(p_host_id,p_input);
 select coalesce(jsonb_agg(jsonb_build_object(
  'requestId',item->'requestId','selectionCommand','request '||(item->>'requestId'),'revision',item->'revision','title',item->'title',
  'status',item->'status','closed',item->'closed','createdAt',item->'createdAt',
  'updatedAt',item->'updatedAt','proposalVersion',item->'proposalVersion'
 ) order by position),'[]'::jsonb) into rows
 from jsonb_array_elements(page->'requests') with ordinality as entry(item,position);
 return jsonb_build_object('requests',rows,'nextCursor',page->'nextCursor');
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_reply_prepare (
  p_grant uuid,
  p_scope uuid,
  p_input jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; m fmat.runtime_messages; g fmat.conversation_grants; valid boolean:=true; reply text;
begin
 select * into m from fmat.runtime_messages where id=(p_input->>'messageId')::uuid and grant_id=p_grant and conversation_id=p_scope;
 if not found then return; end if;
 select * into i from fmat.photon_inbox where runtime_message_id=m.id and processing_outcome='accepted';
 if not found then return; end if;
 select * into g from fmat.conversation_grants where id=p_grant;
 if g.credential->>'kind' is distinct from 'photon' or g.credential->>'inboxId' is distinct from i.id::text then raise exception 'FORBIDDEN'; end if;
 -- A replay returns the first frozen outcome; model retries cannot replace a
 -- text already queued or accepted by the provider.
 if exists(select 1 from fmat.photon_replies where inbox_id=i.id) then return; end if;
 begin perform public.fmat_conversation_check(p_grant,p_scope);
 exception when raise_exception then
  if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED') then valid:=false;else raise;end if;
 end;
 reply:=case when p_input->>'status'='completed' then nullif(btrim(p_input->>'reply'),'') else null end;
 if reply is null then reply:='I could not complete this reply. Your saved changes are preserved. Open Find Me a Time in your browser to continue.';end if;
 if length(reply)>4000 then raise exception 'INVALID_INPUT';end if;
 reply:=fmat.photon_scoped_reply(p_scope,reply);
 insert into fmat.photon_replies(inbox_id,project_id,text,revoked_at)
 values(i.id,i.project_id,case when valid then reply else null end,case when valid then null else clock_timestamp() end)
 on conflict(inbox_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_scoped_reply (
  p_scope uuid,
  p_text  text
)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare request_id uuid; prefix text;
begin
 select s.request_id into request_id from fmat.conversation_scopes s where s.id=p_scope and s.audience='host_private';
 if request_id is null then return p_text;end if;
 prefix:='Request '||request_id::text||E'\n\n';
 if length(prefix||p_text)<=4000 then return prefix||p_text;end if;
 return prefix||left(p_text,3900)||E'\nOpen your host workspace for the full reply.';
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
    if v_grant.actor_kind<>'host' or v_scope.audience not in ('host_setup','host_private') then raise exception 'UNAUTHORIZED'; end if;
    if not exists(select 1 from fmat.photon_inbox i where i.id=(v_grant.credential->>'inboxId')::uuid
     and ((i.conversation_id=v_scope.id and i.execution_grant_id=v_grant.id)
      or (i.conversation_id is null and i.execution_grant_id is null and v_scope.audience='host_setup')))
     then raise exception 'UNAUTHORIZED';end if;
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

CREATE OR REPLACE FUNCTION public.fmat_conversation_tool (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_operation       text,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_access jsonb; v_actor jsonb; v_input jsonb; v_result jsonb; v_request_id uuid;
begin
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  v_actor:=v_access->'actor'; v_request_id:=(v_access->>'requestId')::uuid;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  case p_operation
  when 'context_read' then
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
    return jsonb_build_object('audience',v_access->'audience','requestId',v_access->'requestId','readOnly',v_access->'readOnly');
  when 'host_requests_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_request_model_page((v_actor->>'id')::uuid,p_input);
  when 'setup_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.host_setup_operation('read',v_actor,'{}','assistant');
  when 'setup_analysis_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.calendar_scan_model_view((v_actor->>'id')::uuid);
  when 'setup_draft' then
    if v_access->>'audience'<>'host_setup' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_setup_operation('draft',v_actor,p_input,'assistant');
  when 'request_read' then
    if v_request_id is null then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    -- Host identity does not make a shared conversation private. Project for
    -- the audience at the database boundary before any model sees the result.
    v_result:=fmat.request_view(v_request_id,case when v_access->>'audience'='request_shared' then '{"kind":"guest"}'::jsonb else v_actor end);
    if v_actor->>'kind'='guest' then
      v_result:=v_result||jsonb_build_object('review',(select fmat.request_detail_review_view(r) from fmat.request_detail_reviews r
        where r.request_id=v_request_id and r.authority_key=v_actor->>'tokenHash' order by r.created_at desc,r.id desc limit 1));
    end if;
    return v_result;
  when 'private_note_save' then
    if v_access->>'audience'<>'host_private' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('text','expectedRevision','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(p_input->'text') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  when 'details_propose' then
    if v_access->>'audience'<>'request_shared' or v_actor->>'kind'<>'guest' then raise exception 'FORBIDDEN'; end if;
    if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
    return fmat.propose_request_details(v_actor,p_input);
  else
    -- Approval, agreement, confirmed settings, travel exceptions and worker or
    -- provider outcomes require separate authored application operations.
    raise exception 'FORBIDDEN';
  end case;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number'
    or (p_input->>'expectedRevision') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  v_input:=p_input||jsonb_build_object('requestId',v_request_id);
  v_result:=public.fmat_command(p_operation,v_actor,v_input);
  if v_access->>'audience'='request_shared' then
    -- Also scrub cached idempotency results; these may have been produced by
    -- the host's same command from a private application surface.
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_result from jsonb_each(v_result)
      where key=any(array['id','hostId','revision','status','details','candidates','proposal','requesterAgreed','hostApproved','contactVerified','calendarConnected','event','messages','nextAction','receipt']);
  end if;
  return v_result;
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
 target uuid; command text; notice text; navigation boolean; chosen fmat.requests; access jsonb;
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
   where cs.host_id=l0.host_id and cs.audience in ('host_setup','host_private') and rm.status='pending')
 order by i0.received_order limit 1 for update of j0 skip locked;
 if not found then return jsonb_build_object('outcome','idle'); end if;
 select * into strict i from fmat.photon_inbox where id=(j.payload->>'inboxId')::uuid;
 select * into strict l from fmat.photon_links where id=i.link_id;
 credential:=jsonb_build_object('kind','photon','linkId',l.id,'inboxId',i.id,'receiverId',i.receiver_id);
 begin
  command:=lower(btrim(i.text));
  navigation:=command='setup' or command~'^request([[:space:]]|$)';
  target:=case when navigation then null else l.selected_request_id end;
  -- Navigation uses the setup authority without appending to its transcript.
  -- The request target itself is locked before host authority when selecting.
  insert into fmat.conversation_scopes(host_id,request_id,audience)
   values(l.host_id,target,case when target is null then 'host_setup' else 'host_private' end) on conflict do nothing;
  select * into strict s from fmat.conversation_scopes where host_id=l.host_id
   and request_id is not distinct from target and audience=case when target is null then 'host_setup' else 'host_private' end;
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||s.id::text,0));
  if target is not null then perform 1 from fmat.requests where id=target for update;end if;
  if navigation and command~'^request[[:space:]]+[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   select * into chosen from fmat.requests where id=(regexp_replace(command,'^request[[:space:]]+',''))::uuid
    and host_id=l.host_id for update;
  end if;
  perform fmat.photon_execution_actor(credential);
  insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
   values(s.id,'host','photon:'||i.id::text,credential,i.received_at+interval '1 hour')
   on conflict(conversation_id,actor_kind,authority_key) do nothing;
  select * into strict g from fmat.conversation_grants where conversation_id=s.id and actor_kind='host' and authority_key='photon:'||i.id::text;
  update fmat.photon_inbox set conversation_id=s.id,execution_grant_id=g.id where id=i.id;
  access:=public.fmat_conversation_check(g.id,s.id);
  if navigation or (access->>'readOnly')::boolean then
   perform fmat.conversation_budget_charge('host',l.host_id);
   -- The quota lock may have waited; revalidate all time-based authority.
   perform public.fmat_conversation_check(g.id,s.id);
   if command='setup' then
    update fmat.photon_links set selected_request_id=null where id=l.id;
    notice:='You are back in host setup. Your next messages stay in setup. Ask to list your requests when you want to select a meeting.';
   elsif navigation then
    if chosen.id is not null and chosen.status not in ('booked','declined','withdrawn','expired')
     and (chosen.status='booking' or chosen.expires_at>clock_timestamp()) then
     update fmat.photon_links set selected_request_id=chosen.id where id=l.id;
     notice:='Selected request '||chosen.id::text||': '||to_jsonb(left(coalesce(chosen.details->>'purpose','Meeting request'),200))::text||
      E'.
Your next messages stay private to this request. Reply "setup" to return to setup. Selection is not approval.';
    else
     notice:='That request could not be selected. Your conversation is unchanged. Ask to list your requests and reply with an exact "request <reference>" choice, or reply "setup".';
    end if;
   else
    notice:=fmat.photon_scoped_reply(s.id,'This request is closed. Open your host workspace for its current status. Reply "setup", then ask to list another request.');
   end if;
   insert into fmat.photon_replies(inbox_id,project_id,text) values(i.id,i.project_id,notice) on conflict(inbox_id) do nothing;
  else
   accepted:=public.fmat_runtime_message('accept',g.id,s.id,jsonb_build_object('clientId',i.id,'text',i.text));
   update fmat.runtime_messages set next_dispatch_at=clock_timestamp() where id=(accepted->>'id')::uuid and status='pending';
  end if;
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

CREATE OR REPLACE FUNCTION public.fmat_photon_reply_delivery (
  p_operation  text,
  p_project_id uuid,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.photon_replies; i fmat.photon_inbox; m fmat.runtime_messages; valid boolean:=true; action text; grant_id uuid; scope_id uuid;
begin
 if p_operation='claim' then
  select r0.* into r from fmat.photon_replies r0 join fmat.photon_inbox i0 on i0.id=r0.inbox_id
  where r0.project_id=p_project_id and r0.revoked_at is null and r0.status in ('prepared','uncertain','accepted')
   and (r0.lease_until is null or r0.lease_until<=clock_timestamp())
   and (r0.checked_at is null or r0.checked_at<=clock_timestamp()-interval '30 seconds')
   -- Once acceptance is known, a later reply may send; unknown acceptance
   -- holds later replies so recovery never silently reverses their order.
   and not exists(select 1 from fmat.photon_replies prior join fmat.photon_inbox pi on pi.id=prior.inbox_id
    where pi.project_id=i0.project_id and pi.line=i0.line and pi.space_id=i0.space_id and pi.received_order<i0.received_order
     and prior.revoked_at is null and prior.status in ('prepared','uncertain'))
  order by coalesce(r0.checked_at,r0.created_at),i0.received_order limit 1;
  if not found then return jsonb_build_object('action','idle');end if;
 else
  select * into r from fmat.photon_replies where id=(p_input->>'replyId')::uuid and project_id=p_project_id;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 select * into strict i from fmat.photon_inbox where id=r.inbox_id;
 if i.runtime_message_id is not null then
  select * into strict m from fmat.runtime_messages where id=i.runtime_message_id;
  grant_id:=m.grant_id;scope_id:=m.conversation_id;
 else
  grant_id:=i.execution_grant_id;scope_id:=i.conversation_id;
 end if;
 if p_operation in ('claim','authorize') then
  -- Same host/scope/reply order as settlement and revocation; never acquire
  -- the reply lock before waiting on host authority.
  begin perform public.fmat_conversation_check(grant_id,scope_id);
  exception when raise_exception then
   if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED') then valid:=false;else raise;end if;
  end;
 end if;
 select * into r from fmat.photon_replies where id=r.id for update;
 if p_operation='claim' then
  if r.revoked_at is not null or r.status not in ('prepared','uncertain','accepted') or r.lease_until>clock_timestamp()
   or r.checked_at>clock_timestamp()-interval '30 seconds' then return jsonb_build_object('action','idle');end if;
  if not valid then
   update fmat.photon_replies set revoked_at=clock_timestamp(),text=null,lease_token=null,lease_until=null where id=r.id;
   return jsonb_build_object('action','suppressed');
  end if;
  action:=case when r.status='prepared' then 'send' else 'reconcile' end;
  update fmat.photon_replies set status=case when action='send' then 'uncertain' else status end,
   lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',checked_at=clock_timestamp()
   where id=r.id returning * into r;
  return jsonb_build_object('action',action,'replyId',r.id,'projectId',r.project_id,'leaseToken',r.lease_token,
   'phone',i.sender_id,'line',i.line,'spaceId',i.space_id,'text',case when action='send' then r.text else null end,'providerReference',r.provider_reference);
 end if;
 if r.lease_token is null or r.lease_token is distinct from (p_input->>'leaseToken')::uuid or r.lease_until<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='authorize' then
  if not valid or r.revoked_at is not null then raise exception 'FORBIDDEN';end if;
  return '{}'::jsonb;
 elsif p_operation='finish' then
  if p_input->>'status' is null or p_input->>'status' not in ('accepted','delivered','failed','uncertain','revoked') then raise exception 'INVALID_INPUT';end if;
  if r.provider_reference is not null and p_input->>'providerReference' is not null and r.provider_reference<>p_input->>'providerReference' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  update fmat.photon_replies set
   status=case when p_input->>'status'='revoked' then status when status='accepted' and p_input->>'status'='uncertain' then status else p_input->>'status' end,
   revoked_at=case when p_input->>'status'='revoked' then coalesce(revoked_at,clock_timestamp()) else revoked_at end,
   text=case when p_input->>'status' in ('delivered','failed','revoked') then null else text end,
   provider_reference=coalesce(p_input->>'providerReference',provider_reference),lease_token=null,lease_until=null where id=r.id;
  return '{}'::jsonb;
 end if;
 raise exception 'INVALID_INPUT';
end;
$function$;

ALTER TABLE "fmat"."photon_inbox"
  ADD CONSTRAINT "photon_inbox_context_pair" CHECK (((conversation_id IS NULL) = (execution_grant_id IS NULL)));

ALTER TABLE "fmat"."photon_inbox"
  ADD CONSTRAINT "photon_inbox_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES fmat.conversation_scopes(id);

ALTER TABLE "fmat"."photon_inbox"
  ADD CONSTRAINT "photon_inbox_execution_grant_id_fkey" FOREIGN KEY (execution_grant_id) REFERENCES fmat.conversation_grants(id);

ALTER TABLE "fmat"."photon_links"
  ADD CONSTRAINT "photon_links_selected_request_id_fkey" FOREIGN KEY (selected_request_id) REFERENCES fmat.requests(id) ON DELETE SET NULL;

CREATE INDEX photon_inbox_conversation_idx ON fmat.photon_inbox USING btree (conversation_id);

CREATE INDEX photon_inbox_execution_grant_idx ON fmat.photon_inbox USING btree (execution_grant_id);

CREATE INDEX photon_links_selected_request_idx ON fmat.photon_links USING btree (selected_request_id);

REVOKE ALL ON FUNCTION "fmat"."photon_scoped_reply"(uuid, text) FROM PUBLIC;
