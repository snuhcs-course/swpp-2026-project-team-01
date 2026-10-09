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
