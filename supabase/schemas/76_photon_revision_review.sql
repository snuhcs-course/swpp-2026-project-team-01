-- Authored channel challenges are separate from model-visible draft IDs.
create table fmat.photon_revision_reviews (
 id uuid primary key default gen_random_uuid(),
 inbox_id uuid not null unique references fmat.photon_inbox(id),
 draft_id uuid not null references fmat.host_revision_drafts(id),
 request_id uuid not null references fmat.requests(id),
 link_id uuid not null references fmat.photon_links(id),
 receiver_id uuid not null,
 revision integer not null,
 before_details jsonb not null,
 proposed_details jsonb not null,
 text text not null check(length(text)<=4000),
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index photon_revision_reviews_draft_idx on fmat.photon_revision_reviews(draft_id);
create index photon_revision_reviews_request_idx on fmat.photon_revision_reviews(request_id);
create index photon_revision_reviews_link_idx on fmat.photon_revision_reviews(link_id);
alter table fmat.photon_revision_reviews enable row level security;
revoke all on fmat.photon_revision_reviews from public,anon,authenticated,service_role;
create trigger photon_revision_reviews_immutable before update on fmat.photon_revision_reviews for each row execute function fmat.reject_candidate_evaluation_update();
create table fmat.photon_revision_decisions (
 review_id uuid primary key references fmat.photon_revision_reviews(id),
 inbox_id uuid not null unique references fmat.photon_inbox(id),
 operation text not null check(operation in ('apply','dismiss')),
 result_revision integer not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table fmat.photon_revision_decisions enable row level security;
revoke all on fmat.photon_revision_decisions from public,anon,authenticated,service_role;
create trigger photon_revision_decisions_immutable before update on fmat.photon_revision_decisions for each row execute function fmat.reject_candidate_evaluation_update();

create or replace function fmat.photon_revision_command(p_inbox uuid)
returns text language plpgsql set search_path='' as $$
declare i fmat.photon_inbox; access jsonb; r fmat.requests; draft fmat.host_revision_drafts; review fmat.photon_revision_reviews;
 prior fmat.photon_revision_decisions; command text; operation text; ref uuid; body text; deadline timestamptz; result jsonb;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found then raise exception 'UNAUTHORIZED';end if;
 access:=public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 if not exists(select 1 from fmat.conversation_grants where id=i.execution_grant_id and credential->>'kind'='photon' and credential->>'inboxId'=i.id::text) then raise exception 'FORBIDDEN';end if;
 if access->>'audience' is distinct from 'host_private' then return 'Select a request before reviewing its proposed changes.';end if;
 select * into strict r from fmat.requests where id=(access->>'requestId')::uuid for update;
 command:=lower(btrim(i.text));
 if command='changes' then
  select * into review from fmat.photon_revision_reviews where inbox_id=i.id;
  if found then return review.text;end if;
  select * into draft from fmat.host_revision_drafts where request_id=r.id and host_id=r.host_id and status='pending';
  if draft.id is null then return fmat.photon_scoped_reply(i.conversation_id,'There are no pending private changes. Discuss the changes you want with your assistant first.');end if;
  if r.status in ('booking','booked','withdrawn','declined','expired') or r.expires_at<=clock_timestamp() or r.token_expires_at<=clock_timestamp() or r.token_revoked_at is not null
   or draft.base_revision<>r.revision or draft.before_details is distinct from r.details then raise exception 'REVISION_CONFLICT';end if;
  if draft.input->'clarifications'<>'[]'::jsonb or draft.input->'patch'='{}'::jsonb then
   return fmat.photon_scoped_reply(i.conversation_id,'These changes still need clarification. Continue the private discussion or open your host workspace to review or dismiss the draft.');end if;
  deadline:=least(clock_timestamp()+interval '10 minutes',i.received_at+interval '1 hour',r.expires_at,r.token_expires_at);
  ref:=gen_random_uuid();
  -- JSON renders all shared fields, with free-text newlines quoted as data.
  -- No private note, rationale, diagnostic or calendar event is included.
  body:='Request '||r.id::text||E'\nProposed shared changes, request revision '||r.revision||E'\nCurrent details: '||draft.before_details::text||E'\nProposed details: '||draft.proposed_details::text||E'\n';
  body:=body||'Sharing clears the old proposal, requester agreement and host approval. A newly checked proposal needs fresh agreement and separate approval; no meeting is booked.'||E'\nValid until: '||to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||E'\n';
  body:=body||'To share these exact details, reply: apply changes '||ref::text||E'\nTo discard this private draft, reply: dismiss changes '||ref::text;
  if length(body)>4000 then return fmat.photon_scoped_reply(i.conversation_id,'These changes are too long for a complete message. Open your host workspace to review every changed value before sharing.');end if;
  if deadline<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
  perform public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
  insert into fmat.photon_revision_reviews(id,inbox_id,draft_id,request_id,link_id,receiver_id,revision,before_details,proposed_details,text,expires_at)
   values(ref,i.id,draft.id,r.id,i.link_id,i.receiver_id,r.revision,draft.before_details,draft.proposed_details,body,deadline);
  return body;
 end if;
 if command !~ '^(apply|dismiss)[[:space:]]+changes[[:space:]]+[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  return fmat.photon_scoped_reply(i.conversation_id,'No changes were shared or dismissed. Send "changes", review every value, and use its exact command.');end if;
 operation:=substring(command from '^(apply|dismiss)');ref:=regexp_replace(command,'^(apply|dismiss)[[:space:]]+changes[[:space:]]+','')::uuid;
 select * into review from fmat.photon_revision_reviews where id=ref;
 if review.id is null or review.request_id<>r.id or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id then raise exception 'REVISION_CONFLICT';end if;
 select * into prior from fmat.photon_revision_decisions where review_id=ref;
 if found then
  if prior.operation<>operation then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return fmat.photon_scoped_reply(i.conversation_id,'Your '||operation||' changes decision was already recorded. Current request status: '||(fmat.request_lifecycle_view(r.id,'host')->>'status')||'.');
 end if;
 select * into draft from fmat.host_revision_drafts where id=review.draft_id for update;
 if draft.host_id<>r.host_id or draft.request_id<>r.id or draft.status<>'pending' or draft.base_revision<>r.revision
  or review.revision<>r.revision or review.before_details is distinct from r.details or review.before_details is distinct from draft.before_details
  or review.proposed_details is distinct from draft.proposed_details or review.expires_at<=clock_timestamp()
  or not exists(select 1 from fmat.photon_replies where inbox_id=review.inbox_id and status in ('accepted','delivered','uncertain')) then raise exception 'REVISION_CONFLICT';end if;
 perform public.fmat_conversation_check(source.execution_grant_id,source.conversation_id) from fmat.photon_inbox source where source.id=review.inbox_id;
 result:=fmat.decide_host_revision(access->'actor',r.id,operation,jsonb_build_object('reviewId',draft.id,'expectedRevision',review.revision,'confirmed',true,'idempotencyKey',review.id));
 insert into fmat.photon_revision_decisions(review_id,inbox_id,operation,result_revision) values(review.id,i.id,operation,(result->>'revision')::integer);
 if review.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 perform public.fmat_conversation_check(i.execution_grant_id,i.conversation_id);
 perform public.fmat_conversation_check(source.execution_grant_id,source.conversation_id) from fmat.photon_inbox source where source.id=review.inbox_id;
 return fmat.photon_scoped_reply(i.conversation_id,case when operation='apply' then 'Revised details shared. The old proposal and decisions are cleared. Choose a newly checked proposal in your workspace for requester agreement, then approve it separately. No meeting is booked.' else 'Private changes dismissed. Saved shared details are unchanged.' end);
exception when raise_exception then
 if sqlerrm in ('REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','REQUEST_CLOSED','REQUEST_EXPIRED','INVALID_INPUT') then
  return fmat.photon_scoped_reply(i.conversation_id,'No new changes decision was recorded. The draft or review is unavailable or changed. Send "changes" again or open your host workspace.');
 else raise;end if;
end;
$$;
revoke all on function fmat.photon_revision_command(uuid) from public,anon,authenticated,service_role;
