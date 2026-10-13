-- One immutable reply per accepted private input. Provider delivery is separate
-- from model completion; ambiguous acceptance never creates another send ID.
create table fmat.photon_replies (
 id uuid primary key default gen_random_uuid(),
 inbox_id uuid not null unique references fmat.photon_inbox(id),
 project_id uuid not null references fmat.photon_receivers(project_id),
 text text check(length(text) between 1 and 4000),
 status text not null default 'prepared' check(status in ('prepared','uncertain','accepted','delivered','failed')),
 provider_reference text check(length(provider_reference) between 1 and 512),
 lease_token uuid,
 lease_until timestamptz,
 checked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 check((lease_token is null)=(lease_until is null)),
 check(text is not null or revoked_at is not null or status in ('delivered','failed'))
);
create index photon_replies_due_idx on fmat.photon_replies(project_id,checked_at,created_at) where revoked_at is null and status in ('prepared','uncertain','accepted');
alter table fmat.photon_replies enable row level security;
revoke all on fmat.photon_replies from public,anon,authenticated,service_role;

create or replace function fmat.photon_reply_prepare(p_grant uuid,p_scope uuid,p_input jsonb)
returns void language plpgsql set search_path='' as $$
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
$$;
revoke all on function fmat.photon_reply_prepare(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.fmat_photon_reply_delivery(p_operation text,p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function public.fmat_photon_reply_delivery(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_photon_reply_delivery(text,uuid,jsonb) to service_role;

create or replace function fmat.wake_photon_replies()
returns bigint language plpgsql security definer set search_path='' as $$
declare v_url text;v_secret text;
begin
 if not exists(select 1 from fmat.photon_replies where revoked_at is null and status in ('prepared','uncertain','accepted')
  and (lease_until is null or lease_until<=clock_timestamp()) and (checked_at is null or checked_at<=clock_timestamp()-interval '30 seconds')) then return null;end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if v_url is null or v_secret is null then return null;end if;
 if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 v_url:=replace(v_url,'/api/internal/conversations/dispatch','/api/internal/photon/replies');
 return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$$;
revoke all on function fmat.wake_photon_replies() from public,anon,authenticated,service_role;
select cron.schedule('fmat-photon-replies','* * * * *','select fmat.wake_photon_replies();');
