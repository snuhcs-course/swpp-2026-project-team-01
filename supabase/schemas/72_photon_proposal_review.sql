-- Application-authored review snapshots. Issuance is navigation, never approval.
create table fmat.photon_proposal_reviews (
 id uuid primary key default gen_random_uuid(),
 inbox_id uuid not null unique references fmat.photon_inbox(id),
 link_id uuid not null references fmat.photon_links(id),
 receiver_id uuid not null,
 request_id uuid not null references fmat.requests(id),
 revision integer not null check(revision>0),
 proposal_version integer not null,
 proposal jsonb not null check(jsonb_typeof(proposal)='object'),
 context_basis text not null check(context_basis ~ '^[a-f0-9]{64}$'),
 requester_agreed boolean not null,
 can_approve boolean not null,
 can_decline boolean not null,
 text text not null check(length(text)<=4000),
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(request_id,proposal_version) references fmat.proposals(request_id,version)
);
create index photon_proposal_reviews_link_idx on fmat.photon_proposal_reviews(link_id);
create index photon_proposal_reviews_request_idx on fmat.photon_proposal_reviews(request_id,proposal_version);
alter table fmat.photon_proposal_reviews enable row level security;
revoke all on fmat.photon_proposal_reviews from public,anon,authenticated,service_role;
create trigger photon_proposal_reviews_immutable before update on fmat.photon_proposal_reviews for each row execute function fmat.reject_candidate_evaluation_update();

create or replace function fmat.photon_proposal_state(p_inbox uuid)
returns jsonb language plpgsql set search_path='' as $$
declare i fmat.photon_inbox; r fmat.requests; access jsonb; proposal jsonb; lifecycle jsonb;
 basis text; blocker text:='none'; agreed boolean; deadline timestamptz;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found then raise exception 'UNAUTHORIZED';end if;
 access:=public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 if access->>'audience' is distinct from 'host_private' or not exists(select 1 from fmat.conversation_grants g
  where g.id=i.execution_grant_id and g.credential->>'kind'='photon' and g.credential->>'inboxId'=i.id::text) then raise exception 'FORBIDDEN';end if;
 select * into strict r from fmat.requests where id=(access->>'requestId')::uuid for update;
 lifecycle:=fmat.request_lifecycle_view(r.id,'host');
 select details into proposal from fmat.proposals where request_id=r.id and version=r.current_proposal_version;
 if (lifecycle->>'closed')::boolean then blocker:='closed';proposal:=null;
 elsif lifecycle->>'status'='booking' then blocker:='booking_pending';
 elsif proposal is null then blocker:='proposal_required';
 else
  begin
   basis:=fmat.evaluate_availability('current_context',jsonb_build_object('kind','photon_review','grantId',i.execution_grant_id,'conversationId',i.conversation_id),
    jsonb_build_object('requestId',r.id,'revision',r.revision),null)->>'travelBasis';
  exception when raise_exception then if sqlerrm='RECONNECT_REQUIRED' then blocker:='reconnect_required';else raise;end if;end;
  if blocker='none' then
   if not exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=basis)
     or (proposal->>'start')::timestamptz<=clock_timestamp() or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() then blocker:='proposal_stale';
   elsif r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then blocker:='reconnect_required';
   elsif r.requester_agreed_version is distinct from r.current_proposal_version then blocker:='agreement_required';
   elsif r.contact_verified_email is distinct from lower(proposal->>'requesterEmail') then blocker:='contact_verification_required';end if;
  end if;
 end if;
 -- Revalidate after all connection/host lock waits, not transaction-start time.
 perform public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 agreed:=proposal is not null and coalesce(r.requester_agreed_version=r.current_proposal_version,false) and blocker not in ('proposal_stale','reconnect_required');
 deadline:=least(clock_timestamp()+interval '10 minutes',i.received_at+interval '1 hour',r.expires_at,r.token_expires_at,(proposal->>'start')::timestamptz);
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'proposalVersion',r.current_proposal_version,'proposal',proposal,
  'contextBasis',basis,'requesterAgreed',agreed,'canApprove',blocker='none','canDecline',(lifecycle->>'canDecline')::boolean,
  'blocker',blocker,'expiresAt',deadline);
end;
$$;
revoke all on function fmat.photon_proposal_state(uuid) from public,anon,authenticated,service_role;

create or replace function fmat.photon_proposal_review(p_inbox uuid)
returns text language plpgsql set search_path='' as $$
declare i fmat.photon_inbox; state jsonb; p jsonb; prior fmat.photon_proposal_reviews; review_id uuid:=gen_random_uuid(); body text;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found or lower(btrim(i.text)) is distinct from 'review' then raise exception 'FORBIDDEN';end if;
 state:=fmat.photon_proposal_state(i.id);
 select * into prior from fmat.photon_proposal_reviews where inbox_id=i.id;
 -- A retry retains the exact authored text and deadline; never rebases a review.
 if prior.id is not null then return prior.text;end if;
 p:=state->'proposal';
 if p is null or p='null'::jsonb then
  return fmat.photon_scoped_reply(i.conversation_id,'There is no open proposal to review. Open your host workspace for the current request status.');
 end if;
 body:='Request '||(state->>'requestId')||E'\nProposal '||(state->>'proposalVersion')||', request revision '||(state->>'revision')||E'\n';
 body:=body||'Start: '||coalesce(p->>'start','')||E'\nEnd: '||coalesce(p->>'end','')||E'\nTimezone: '||coalesce(p->>'timezone','')||E'\n';
 -- JSON quoting keeps user-entered newlines and instruction-like text visibly
 -- within field values. Never truncate details before issuing decision context.
 body:=body||'Mode: '||coalesce(to_jsonb(p->>'mode')::text,'null')||E'\nLocation: '||coalesce(to_jsonb(p->>'location')::text,'null')||E'\n';
 body:=body||'Requester: '||coalesce(to_jsonb(p->>'requesterName')::text,'null')||E'\nContact: '||coalesce(to_jsonb(p->>'requesterEmail')::text,'null')||E'\nPurpose: '||coalesce(to_jsonb(p->>'purpose')::text,'null')||E'\n';
 body:=body||'Requester agreement: '||case when (state->>'requesterAgreed')::boolean then 'current' else 'not current' end||E'\n';
 if state->>'blocker' not in ('none','agreement_required','contact_verification_required') then
  body:=body||'Review unavailable: '||(state->>'blocker')||E'.\nOpen your host workspace to refresh the proposal.';
  if length(body)>4000 then return fmat.photon_scoped_reply(i.conversation_id,'This proposal is too long for a complete message. Open your host workspace to review every detail.');end if;
  return body;
 end if;
 body:=body||'Review reference: '||review_id::text||E'\nValid until: '||to_char((state->>'expiresAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||E'\n';
 body:=body||case when (state->>'canApprove')::boolean then 'To approve this exact proposal, reply: approve '||review_id::text||E'\n' else 'Approval is unavailable until requester agreement and contact verification are current.'||E'\n' end;
 body:=body||case when (state->>'canDecline')::boolean then 'To decline, reply: decline '||review_id::text||E'\n' else '' end||'Review alone does not approve or book. You can also decide in your host workspace.';
 if length(body)>4000 then return fmat.photon_scoped_reply(i.conversation_id,'This proposal is too long for a complete message. Open your host workspace to review every detail.');end if;
 if (state->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 insert into fmat.photon_proposal_reviews(id,inbox_id,link_id,receiver_id,request_id,revision,proposal_version,proposal,context_basis,requester_agreed,can_approve,can_decline,text,expires_at)
 values(review_id,i.id,i.link_id,i.receiver_id,(state->>'requestId')::uuid,(state->>'revision')::integer,(state->>'proposalVersion')::integer,p,state->>'contextBasis',
  (state->>'requesterAgreed')::boolean,(state->>'canApprove')::boolean,(state->>'canDecline')::boolean,body,(state->>'expiresAt')::timestamptz);
 return body;
end;
$$;
revoke all on function fmat.photon_proposal_review(uuid) from public,anon,authenticated,service_role;

-- Private precondition for the subsequent explicit decision command. A saved
-- reference alone carries no authority, and no model tool exposes this helper.
create or replace function fmat.photon_proposal_review_check(p_inbox uuid,p_review uuid)
returns jsonb language plpgsql set search_path='' as $$
declare i fmat.photon_inbox; review fmat.photon_proposal_reviews; state jsonb;
begin
 state:=fmat.photon_proposal_state(p_inbox);
 select * into strict i from fmat.photon_inbox where id=p_inbox;
 select * into review from fmat.photon_proposal_reviews where id=p_review;
 if review.id is null or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id
  or review.request_id::text is distinct from state->>'requestId' or review.revision is distinct from (state->>'revision')::integer
  or review.proposal_version is distinct from (state->>'proposalVersion')::integer or review.proposal is distinct from state->'proposal'
  or review.context_basis is distinct from state->>'contextBasis' or review.requester_agreed is distinct from (state->>'requesterAgreed')::boolean
  or review.can_approve is distinct from (state->>'canApprove')::boolean or review.can_decline is distinct from (state->>'canDecline')::boolean
  or review.expires_at<=clock_timestamp() or state->>'blocker' not in ('none','agreement_required','contact_verification_required')
 then raise exception 'REVISION_CONFLICT';end if;
 -- Both the new decision receipt and original review receipt must remain authorized.
 perform public.fmat_conversation_check(source.execution_grant_id,source.conversation_id) from fmat.photon_inbox source where source.id=review.inbox_id;
 return state||jsonb_build_object('reviewId',review.id,'expiresAt',review.expires_at);
end;
$$;
revoke all on function fmat.photon_proposal_review_check(uuid,uuid) from public,anon,authenticated,service_role;
