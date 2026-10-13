SET local check_function_bodies = off;

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
 target uuid; command text; notice text; navigation boolean; decision boolean; revision_control boolean; setup_control boolean; setup_lease uuid; chosen fmat.requests; access jsonb;
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
  command:=lower(btrim(i.text,E' \t\r\n\f'||chr(11)));
  setup_control:=command='review setup' or command~'^review setup[[:space:]]' or command~'^confirm setup([[:space:]]|$)' or command~'^accept setup answers([[:space:]]|$)';
  decision:=command~'^(approve|decline)([[:space:]]|$)' or (l.selected_request_id is not null and command in ('yes','ok','okay','네','승인','거절'));
  revision_control:=command='changes' or command~'^(apply|dismiss)([[:space:]]|$)';
  navigation:=command='setup' or command~'^request([[:space:]]|$)';
  target:=case when navigation or setup_control then null else l.selected_request_id end;
  -- Request locks precede host/FK locks, including first-scope creation.
  if target is not null then perform 1 from fmat.requests where id=target for update;end if;
  if navigation and command~'^request[[:space:]]+[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   select * into chosen from fmat.requests where id=(regexp_replace(command,'^request[[:space:]]+',''))::uuid
    and host_id=l.host_id for update;
  end if;
  -- Navigation uses setup authority without appending to its transcript.
  insert into fmat.conversation_scopes(host_id,request_id,audience)
   values(l.host_id,target,case when target is null then 'host_setup' else 'host_private' end) on conflict do nothing;
  select * into strict s from fmat.conversation_scopes where host_id=l.host_id
   and request_id is not distinct from target and audience=case when target is null then 'host_setup' else 'host_private' end;
  -- Runtime admission normally takes this advisory lock before the request.
  -- Never wait for it while holding a request: roll back this inner attempt
  -- and let its existing runtime owner finish, then retry the same receipt.
  if not pg_try_advisory_xact_lock(hashtextextended('runtime:'||s.id::text,0)) then raise exception 'CONVERSATION_BUSY';end if;
  perform fmat.photon_execution_actor(credential);
  insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
   values(s.id,'host','photon:'||i.id::text,credential,i.received_at+interval '1 hour')
   on conflict(conversation_id,actor_kind,authority_key) do nothing;
  select * into strict g from fmat.conversation_grants where conversation_id=s.id and actor_kind='host' and authority_key='photon:'||i.id::text;
  update fmat.photon_inbox set conversation_id=s.id,execution_grant_id=g.id where id=i.id;
  access:=public.fmat_conversation_check(g.id,s.id);
  if setup_control then
   if not exists(select 1 from fmat.photon_setup_dispatches where inbox_id=i.id) then
    perform fmat.conversation_budget_charge('host',l.host_id);
    perform public.fmat_conversation_check(g.id,s.id);
    insert into fmat.photon_setup_dispatches(inbox_id,job_id) values(i.id,j.id);
   end if;
   setup_lease:=gen_random_uuid();
   update fmat.jobs set status='running',lease_token=setup_lease,
    lease_until=least(clock_timestamp()+interval '90 seconds',i.received_at+interval '1 hour'),
    worker_id='photon-setup',updated_at=clock_timestamp() where id=j.id;
   -- Commit the canonical grant and lease before external Calendar I/O. The
   -- input stays pending, so later messages on this private route cannot pass.
   return jsonb_build_object('outcome','setup','inboxId',i.id,'leaseToken',setup_lease,'text',i.text);
  elsif navigation or decision or revision_control or command='review' or (access->>'readOnly')::boolean then
   perform fmat.conversation_budget_charge('host',l.host_id);
   -- The quota lock may have waited; revalidate all time-based authority.
   perform public.fmat_conversation_check(g.id,s.id);
   if revision_control then
    notice:=fmat.photon_revision_command(i.id);
   elsif decision then
    notice:=fmat.photon_proposal_decide(i.id);
   elsif command='review' then
    notice:=case when target is null then 'Select a request first: ask to list your requests and send its exact request command.' else fmat.photon_proposal_review(i.id) end;
   elsif command='setup' then
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

CREATE OR REPLACE FUNCTION public.fmat_photon_setup_dispatch (
  p_operation  text,
  p_project_id uuid,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; j fmat.jobs; record fmat.photon_setup_dispatches;
 publication record; result jsonb; saved jsonb; notice text; outcome text:='accepted'; failure text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or not (p_input ?& array['inboxId','leaseToken']) then raise exception 'INVALID_INPUT';end if;
 if p_operation in ('operate','operate_answers') then
  if not (p_input ?& array['operation','input']) or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('inboxId','leaseToken','operation','input')) then raise exception 'INVALID_INPUT';end if;
 elsif p_operation='settle' then
  if jsonb_typeof(p_input->'result') is distinct from 'string' or p_input->>'result' not in ('answers_reviewed','answers_accepted','reviewed','confirmed','invalid','stale','calendar_required','browser_required','delivery_pending')
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('inboxId','leaseToken','result')) then raise exception 'INVALID_INPUT';end if;
 elsif p_operation='retry' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('inboxId','leaseToken')) then raise exception 'INVALID_INPUT';end if;
 else raise exception 'INVALID_INPUT';end if;
 select * into record from fmat.photon_setup_dispatches where inbox_id=(p_input->>'inboxId')::uuid;
 select * into j from fmat.jobs where id=record.job_id for update;
 select * into i from fmat.photon_inbox where id=record.inbox_id and project_id=p_project_id;
 if j.id is null or i.id is null or i.processed_at is not null or j.status<>'running'
  or j.lease_token is distinct from (p_input->>'leaseToken')::uuid or j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 begin
  perform public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 exception when raise_exception then
  if sqlerrm in ('UNAUTHORIZED','NOT_FOUND','HOST_NOT_ADMITTED') and p_operation='settle' then outcome:='revoked';else raise;end if;
 end;
 -- Current authority may have waited for a host/grant lock. Expired workers
 -- cannot mutate or settle, even if a replacement worker has not claimed yet.
 if j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 if p_operation in ('operate','operate_answers') then
  if p_operation='operate_answers' then
   if jsonb_typeof(p_input->'operation') is distinct from 'string' or p_input->>'operation' not in ('review','publish','accept') then raise exception 'INVALID_INPUT';end if;
   result:=public.fmat_photon_setup_answers(p_input->>'operation',i.id,p_input->'input');
  else
  if jsonb_typeof(p_input->'operation') is distinct from 'string' or p_input->>'operation' not in ('review','publish','begin_confirmation','refresh','finish_confirmation') then raise exception 'INVALID_INPUT';end if;
  result:=public.fmat_photon_setup(p_input->>'operation',i.id,p_input->'input');
  end if;
  if j.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
  return result;
 elsif p_operation='retry' then
  update fmat.jobs set status='pending',available_at=clock_timestamp()+interval '30 seconds',lease_token=null,lease_until=null,
   worker_id=null,last_error='PROVIDER_UNAVAILABLE',updated_at=clock_timestamp() where id=j.id;
  return jsonb_build_object('outcome','busy');
 end if;
 if outcome='accepted' then
  select c.result into saved from fmat.photon_setup_confirmations c where c.inbox_id=i.id;
  if saved is not null then
   notice:='Saved the settings from setup review '||(saved->>'reviewId')||'. This does not approve or book a meeting. Ask to check setup readiness before sharing your booking link.';
  elsif exists(select 1 from fmat.photon_setup_answer_acceptances a where a.inbox_id=i.id) then
   select a.result into saved from fmat.photon_setup_answer_acceptances a where a.inbox_id=i.id;
   notice:='Accepted the selected draft answers from review '||(saved->>'reviewId')||'. Settings have not been saved. Send "review setup" to review all current settings before a separate confirmation.';
  elsif exists(select 1 from fmat.photon_setup_answer_review_publications p join fmat.photon_setup_answer_reviews r on r.id=p.review_id where r.inbox_id=i.id) then
   notice:=null;
  elsif exists(select 1 from fmat.photon_setup_review_publications p join fmat.photon_setup_reviews r on r.id=p.review_id where r.inbox_id=i.id) then
   -- The complete summary already owns its exact durable outgoing identity.
   notice:=null;
  else
   failure:=p_input->>'result';
   if failure in ('answers_reviewed','answers_accepted','reviewed','confirmed') then raise exception 'REVISION_CONFLICT';end if;
   if lower(btrim(i.text,E' \t\r\n\f'||chr(11)))~'^(review|accept) setup answers([[:space:]]|$)' then
    notice:=case failure
     when 'invalid' then 'Send "review setup answers" to inspect extracted draft answers, then use the exact reference and selected keys shown there. No answers were accepted; settings have not been saved.'
     when 'stale' then 'That answer review is no longer current. Send "review setup answers" for a new review. No answers were accepted; settings have not been saved.'
     when 'delivery_pending' then 'Delivery of that answer review has not been verified. Wait for the complete review, then request a new answer review. No answers were accepted; settings have not been saved.'
     else 'A complete answer review is unavailable. Open your host workspace to review the draft and remaining steps. No answers were accepted; settings have not been saved.' end;
   else
   notice:=case failure
    when 'invalid' then 'To review settings, send "review setup". To save, reply with the exact "confirm setup <reference>" command from that review. Settings have not been saved.'
    when 'stale' then 'That setup review is no longer current. Send "review setup" for a new review, or open your host workspace. Settings have not been saved.'
    when 'calendar_required' then 'Calendar access needs attention. Open your host workspace to reconnect or select calendars, then request a new setup review. Settings have not been saved.'
    when 'delivery_pending' then 'Delivery of that setup review has not been verified. Wait for the complete review, then request a new review and confirm its exact reference. Settings have not been saved.'
    else 'A complete setup review is unavailable in this message. Open your host workspace to review every setting and any remaining steps. Settings have not been saved.' end;
   end if;
  end if;
  if notice is not null then
   insert into fmat.photon_replies(inbox_id,project_id,text) values(i.id,i.project_id,notice) on conflict(inbox_id) do nothing;
  end if;
 end if;
 update fmat.photon_inbox set processed_at=clock_timestamp(),processing_outcome=outcome where id=i.id;
 update fmat.jobs set status='complete',lease_token=null,lease_until=null,worker_id=null,last_error=null,
  result=jsonb_build_object('outcome',outcome),updated_at=clock_timestamp() where id=j.id;
 for publication in select message_id from fmat.queue_publications where job_id=j.id and acknowledged_at is null loop
  perform pgmq.archive('fmat_jobs',publication.message_id);
 end loop;
 update fmat.queue_publications set acknowledged_at=clock_timestamp() where job_id=j.id and acknowledged_at is null;
 return jsonb_build_object('outcome',outcome);
exception when invalid_text_representation then raise exception 'INVALID_INPUT';
end;
$function$;
