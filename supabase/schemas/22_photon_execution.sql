-- Historical receipts deliberately remain unbound. Never infer authority from
-- a link created after an input arrived or move a receipt to a replacement link.
alter table fmat.photon_inbox
  add column receiver_id uuid,
  add column link_id uuid references fmat.photon_links(id),
  add column runtime_message_id uuid references fmat.runtime_messages(id),
  add column processing_outcome text check(processing_outcome in ('accepted','revoked','limited'));
create index photon_inbox_link_idx on fmat.photon_inbox(link_id);
create index photon_inbox_runtime_idx on fmat.photon_inbox(runtime_message_id);

create or replace function fmat.photon_execution_actor(p_credential jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare i fmat.photon_inbox; l fmat.photon_links; h fmat.hosts; u auth.users; r fmat.photon_receivers;
begin
 if jsonb_typeof(p_credential) is distinct from 'object' or p_credential->>'kind' is distinct from 'photon'
  or p_credential-array['kind','linkId','inboxId','receiverId']<>'{}'::jsonb then raise exception 'UNAUTHORIZED'; end if;
 select * into i from fmat.photon_inbox where id=(p_credential->>'inboxId')::uuid;
 select * into l from fmat.photon_links where id=i.link_id and id=(p_credential->>'linkId')::uuid;
 if not found then raise exception 'UNAUTHORIZED'; end if;
 -- Same host/Auth/receiver/link order as unlink and browser setup. UPDATE up
 -- front avoids upgrading a shared host lock after another setup writer starts.
 select * into h from fmat.hosts where id=l.host_id for update;
 if not found or h.revoked_at is not null then raise exception 'UNAUTHORIZED'; end if;
 select * into u from auth.users where id=h.id for share;
 if not found or u.deleted_at is not null or u.email_confirmed_at is null
  or u.banned_until>clock_timestamp() or lower(u.email) is distinct from h.email then raise exception 'UNAUTHORIZED'; end if;
 select * into r from fmat.photon_receivers where project_id=i.project_id for share;
 select * into l from fmat.photon_links where id=i.link_id for share;
 if not found or l.revoked_at is not null or not r.enabled
  or r.receiver_id is distinct from i.receiver_id or i.receiver_id is distinct from (p_credential->>'receiverId')::uuid
  or l.project_id is distinct from i.project_id or l.phone is distinct from i.sender_id
  or l.line is distinct from i.line or l.space_id is distinct from i.space_id
  or i.occurred_at<l.linked_at or i.occurred_at>i.received_at+interval '5 minutes'
  or i.received_at+interval '1 hour'<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
 return jsonb_build_object('kind','host','id',h.id,'email',h.email,'channel','imessage');
end;
$$;
revoke all on function fmat.photon_execution_actor(jsonb) from public,anon,authenticated,service_role;

-- One receipt per transaction: no network call, no cross-host lock ordering,
-- and no gap between accepting runtime input and completing its transport job.
create or replace function public.fmat_photon_dispatch(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function public.fmat_photon_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.fmat_photon_dispatch(uuid) to service_role;

create or replace function fmat.wake_photon_inbox()
returns bigint language plpgsql security definer set search_path='' as $$
declare v_url text; v_secret text;
begin
 if not exists(select 1 from fmat.photon_inbox where processed_at is null and link_id is not null) then return null; end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if v_url is null or v_secret is null then return null; end if;
 if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION'; end if;
 v_url:=replace(v_url,'/api/internal/conversations/dispatch','/api/internal/photon/dispatch');
 return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$$;
revoke all on function fmat.wake_photon_inbox() from public,anon,authenticated,service_role;
select cron.schedule('fmat-photon-inbox','* * * * *','select fmat.wake_photon_inbox();');
