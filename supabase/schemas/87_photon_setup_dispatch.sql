-- The marker charges input quota once across worker restarts. Job leases own
-- the external-I/O continuation; ordinary inputs remain in the existing path.
create table fmat.photon_setup_dispatches (
 inbox_id uuid primary key references fmat.photon_inbox(id),
 job_id uuid not null unique references fmat.jobs(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table fmat.photon_setup_dispatches enable row level security;
revoke all on fmat.photon_setup_dispatches from public,anon,authenticated,service_role;

create or replace function public.fmat_photon_setup_dispatch(p_operation text,p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function public.fmat_photon_setup_dispatch(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_photon_setup_dispatch(text,uuid,jsonb) to service_role;
