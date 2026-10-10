-- Caller has locked and authorized the exact current request/proposal. These
-- private write primitives are shared by browser and authored channel commands.
create or replace function fmat.commit_host_approval(p_request fmat.requests,p_actor jsonb,p_source text)
returns jsonb language plpgsql set search_path='' as $$
declare r fmat.requests:=p_request; actor jsonb:=p_actor; approval uuid; attempt uuid; operation text;
begin
 if p_source is null or p_source not in ('authenticated_web','verified_imessage') or p_actor->>'kind' is distinct from 'host' or p_actor->>'id' is distinct from r.host_id::text then raise exception 'FORBIDDEN';end if;
 operation:=case when p_source='authenticated_web' then 'web_host_approve' else 'imessage_host_approve' end;
   update fmat.requests set host_approved_version=current_proposal_version,status='booking',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
   insert into fmat.host_approvals(request_id,proposal_version,host_id,source,approved_revision) values(r.id,r.current_proposal_version,r.host_id,p_source,r.revision) returning id into approval;
   attempt:=fmat.prepare_booking(r,approval);
   insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,operation,actor,r.current_proposal_version);
   perform fmat.audit(operation,actor,r.id::text,jsonb_build_object('approvalId',approval,'attemptId',attempt));
 return jsonb_build_object('approvalId',approval,'attemptId',attempt,'revision',r.revision);
end;
$$;
revoke all on function fmat.commit_host_approval(fmat.requests,jsonb,text) from public,anon,authenticated,service_role;

create or replace function fmat.commit_request_closure(p_request fmat.requests,p_actor jsonb,p_scope text,p_operation text,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare r fmat.requests:=p_request; actor jsonb:=p_actor; scope text:=p_scope; state jsonb;
begin
 if p_operation not in ('withdraw','decline') or (p_operation='decline' and actor->>'kind' is distinct from 'host')
  or (p_operation='withdraw' and actor->>'kind' is distinct from 'guest') then raise exception 'FORBIDDEN';end if;
 state:=fmat.request_lifecycle_view(r.id,actor->>'kind');
 if (state->>'closed')::boolean then raise exception 'REQUEST_CLOSED';end if;
 if not (state->>(case when p_operation='decline' then 'canDecline' else 'canWithdraw' end))::boolean then raise exception 'BOOKING_PENDING';end if;
 if (p_input->>'revision')::integer is distinct from r.revision then raise exception 'REVISION_CONFLICT';end if;
 update fmat.booking_attempts set phase='blocked',reason='request_'||p_operation||'_before_dispatch',updated_at=clock_timestamp()
  where request_id=r.id and phase='prepared';
 delete from fmat.host_reservations where attempt_id in(select id from fmat.booking_attempts where request_id=r.id and phase='blocked');
 update fmat.requests set status=case when p_operation='withdraw' then 'withdrawn' else 'declined' end,
  token_revoked_at=clock_timestamp(),candidates='[]',candidate_publication_id=null,current_proposal_version=null,
  requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
  availability_check_id=null,availability_check_started_at=null,revision=revision+1,updated_at=clock_timestamp()
  where id=r.id returning * into r;
 insert into fmat.request_closures(request_id,actor_scope,key,operation,input,result_revision) values(r.id,scope,(p_input->>'idempotencyKey')::uuid,p_operation,p_input,r.revision);
 insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'request_'||p_operation,actor,null);
 perform fmat.audit('request_'||p_operation,actor,r.id::text);
 return fmat.request_lifecycle_view(r.id,actor->>'kind');
end;
$$;
revoke all on function fmat.commit_request_closure(fmat.requests,jsonb,text,text,jsonb) from public,anon,authenticated,service_role;

create table fmat.photon_proposal_decisions (
 review_id uuid primary key references fmat.photon_proposal_reviews(id),
 inbox_id uuid not null unique references fmat.photon_inbox(id),
 request_id uuid not null references fmat.requests(id),
 host_id uuid not null references fmat.hosts(id),
 link_id uuid not null references fmat.photon_links(id),
 operation text not null check(operation in ('approve','decline')),
 approval_id uuid unique references fmat.host_approvals(id),
 result_revision integer not null check(result_revision>0),
 created_at timestamptz not null default clock_timestamp(),
 check((operation='approve')=(approval_id is not null))
);
create index photon_proposal_decisions_request_idx on fmat.photon_proposal_decisions(request_id);
create index photon_proposal_decisions_host_idx on fmat.photon_proposal_decisions(host_id);
create index photon_proposal_decisions_link_idx on fmat.photon_proposal_decisions(link_id);
alter table fmat.photon_proposal_decisions enable row level security;
revoke all on fmat.photon_proposal_decisions from public,anon,authenticated,service_role;
create trigger photon_proposal_decisions_immutable before update on fmat.photon_proposal_decisions for each row execute function fmat.reject_candidate_evaluation_update();

-- Durable decisions survive browser logout or channel unlink after commitment.
-- New decisions still need current receipt/review authority. Booking execution
-- separately rechecks host, request, proposal, calendars and fresh feasibility.
create or replace view fmat.approval_attributions with(security_invoker=true) as
 select d.approval_id,d.request_id,d.host_id,d.result_revision
 from fmat.web_approval_decisions d join fmat.host_approvals a on a.id=d.approval_id
 where a.source='authenticated_web' and a.request_id=d.request_id and a.host_id=d.host_id and a.approved_revision=d.result_revision
 union all
 select d.approval_id,d.request_id,d.host_id,d.result_revision
 from fmat.photon_proposal_decisions d join fmat.host_approvals a on a.id=d.approval_id
 join fmat.photon_proposal_reviews r on r.id=d.review_id join fmat.photon_inbox i on i.id=d.inbox_id
 where d.operation='approve' and a.source='verified_imessage' and a.request_id=d.request_id and a.host_id=d.host_id
  and a.approved_revision=d.result_revision and r.request_id=d.request_id and r.proposal_version=a.proposal_version
  and r.revision+1=d.result_revision and r.can_approve and r.requester_agreed and d.created_at<=r.expires_at
  and r.link_id=d.link_id and i.link_id=d.link_id and i.receiver_id=r.receiver_id;
revoke all on fmat.approval_attributions from public,anon,authenticated,service_role;

create or replace function fmat.photon_proposal_decide(p_inbox uuid)
returns text language plpgsql set search_path='' as $$
declare i fmat.photon_inbox; access jsonb; state jsonb; r fmat.requests; review fmat.photon_proposal_reviews;
 prior fmat.photon_proposal_decisions; command text; operation text; ref uuid; approval uuid; result jsonb; reply text;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found then raise exception 'UNAUTHORIZED';end if;
 access:=public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 if not exists(select 1 from fmat.conversation_grants where id=i.execution_grant_id and credential->>'kind'='photon'
   and credential->>'inboxId'=i.id::text) then raise exception 'FORBIDDEN';end if;
 command:=lower(btrim(i.text));
 if access->>'audience' is distinct from 'host_private' then return 'Select a request and send "review" before making a proposal decision.';end if;
 if command !~ '^(approve|decline)[[:space:]]+[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  return fmat.photon_scoped_reply(i.conversation_id,'No decision was recorded. Send "review", read the complete proposal, then use its exact approve or decline command.');
 end if;
 -- Accept any whitespace in the authored command boundary, never prose.
 operation:=substring(command from '^(approve|decline)');
 ref:=regexp_replace(command,'^(approve|decline)[[:space:]]+','')::uuid;
 select * into strict r from fmat.requests where id=(access->>'requestId')::uuid for update;
 select * into review from fmat.photon_proposal_reviews where id=ref;
 if review.id is null or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id or review.request_id is distinct from r.id then raise exception 'REVISION_CONFLICT';end if;
 select * into prior from fmat.photon_proposal_decisions where review_id=ref;
 if prior.review_id is not null then
  if prior.operation<>operation or prior.link_id is distinct from i.link_id or prior.host_id::text is distinct from access->'actor'->>'id' then raise exception 'REVISION_CONFLICT';end if;
  return fmat.photon_scoped_reply(i.conversation_id,'Your '||operation||' decision was already recorded. Current request status: '||(fmat.request_lifecycle_view(r.id,'host')->>'status')||'.');
 end if;
 -- A reference is attributable only after the original authored text crossed
 -- the provider boundary. Its nonce is never available to the model.
 if not exists(select 1 from fmat.photon_replies where inbox_id=review.inbox_id and status in ('accepted','delivered','uncertain')) then raise exception 'REVISION_CONFLICT';end if;
 state:=fmat.photon_proposal_review_check(i.id,ref);
 if operation='approve' then
  if not (state->>'canApprove')::boolean then raise exception 'REVISION_CONFLICT';end if;
  result:=fmat.commit_host_approval(r,access->'actor','verified_imessage');
  approval:=(result->>'approvalId')::uuid;
  reply:='Approval recorded for proposal '||review.proposal_version||'. Booking is pending; an event is not yet confirmed. Open your host workspace for the current outcome.';
 else
  if not (state->>'canDecline')::boolean then raise exception 'BOOKING_PENDING';end if;
  perform 1 from fmat.booking_attempts where request_id=r.id order by id for update;
  -- Recheck the decision deadline and both grants after possible waits.
  perform fmat.photon_proposal_review_check(i.id,ref);
  result:=fmat.commit_request_closure(r,access->'actor','photon:'||i.link_id::text,'decline',
   jsonb_build_object('requestId',r.id,'revision',r.revision,'confirmed',true,'idempotencyKey',i.id));
  reply:='Declined proposal '||review.proposal_version||'. This request is closed and no booking was created by this decision.';
 end if;
 insert into fmat.photon_proposal_decisions(review_id,inbox_id,request_id,host_id,link_id,operation,approval_id,result_revision)
 values(ref,i.id,r.id,r.host_id,i.link_id,operation,approval,(result->>'revision')::integer);
 if review.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 perform public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 perform public.fmat_conversation_check(source.execution_grant_id,source.conversation_id) from fmat.photon_inbox source where source.id=review.inbox_id;
 return fmat.photon_scoped_reply(i.conversation_id,reply);
exception when raise_exception then
 -- This block rolls back all partial domain effects before the authored reply.
 if sqlerrm in ('REVISION_CONFLICT','REQUEST_CLOSED','BOOKING_PENDING','RECONNECT_REQUIRED','FEASIBILITY_STALE','CONTACT_NOT_VERIFIED','HOST_BUSY') then
  return fmat.photon_scoped_reply(i.conversation_id,'No new decision was recorded. This review is unavailable or has changed. Send "review" again, or open your host workspace for the current status.');
 else raise;end if;
end;
$$;
revoke all on function fmat.photon_proposal_decide(uuid) from public,anon,authenticated,service_role;
