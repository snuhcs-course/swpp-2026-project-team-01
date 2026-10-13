SET local check_function_bodies = off;

CREATE TABLE "fmat"."photon_revision_decisions" (
  "review_id"       uuid                     NOT NULL,
  "inbox_id"        uuid                     NOT NULL,
  "operation"       text                     NOT NULL,
  "result_revision" integer                  NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_revision_decisions_inbox_id_key" UNIQUE (inbox_id),
  CONSTRAINT "photon_revision_decisions_operation_check" CHECK ((operation = ANY (ARRAY['apply'::text, 'dismiss'::text]))),
  CONSTRAINT "photon_revision_decisions_pkey" PRIMARY KEY (review_id)
);

ALTER TABLE "fmat"."photon_revision_decisions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."photon_revision_reviews" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "inbox_id"         uuid                     NOT NULL,
  "draft_id"         uuid                     NOT NULL,
  "request_id"       uuid                     NOT NULL,
  "link_id"          uuid                     NOT NULL,
  "receiver_id"      uuid                     NOT NULL,
  "revision"         integer                  NOT NULL,
  "before_details"   jsonb                    NOT NULL,
  "proposed_details" jsonb                    NOT NULL,
  "text"             text                     NOT NULL,
  "expires_at"       timestamp with time zone NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_revision_reviews_inbox_id_key" UNIQUE (inbox_id),
  CONSTRAINT "photon_revision_reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "photon_revision_reviews_text_check" CHECK ((length(text) <= 4000))
);

ALTER TABLE "fmat"."photon_revision_reviews"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.photon_revision_command (
  p_inbox uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
 target uuid; command text; notice text; navigation boolean; decision boolean; revision_control boolean; chosen fmat.requests; access jsonb;
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
  decision:=command~'^(approve|decline)([[:space:]]|$)' or (l.selected_request_id is not null and command in ('yes','ok','okay','네','승인','거절'));
  revision_control:=command='changes' or command~'^(apply|dismiss)([[:space:]]|$)';
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
  if navigation or decision or revision_control or command='review' or (access->>'readOnly')::boolean then
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

ALTER TABLE "fmat"."photon_revision_decisions"
  ADD CONSTRAINT "photon_revision_decisions_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.photon_inbox(id);

ALTER TABLE "fmat"."photon_revision_reviews"
  ADD CONSTRAINT "photon_revision_reviews_draft_id_fkey" FOREIGN KEY (draft_id) REFERENCES fmat.host_revision_drafts(id);

ALTER TABLE "fmat"."photon_revision_reviews"
  ADD CONSTRAINT "photon_revision_reviews_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.photon_inbox(id);

ALTER TABLE "fmat"."photon_revision_reviews"
  ADD CONSTRAINT "photon_revision_reviews_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.photon_links(id);

ALTER TABLE "fmat"."photon_revision_decisions"
  ADD CONSTRAINT "photon_revision_decisions_review_id_fkey" FOREIGN KEY (review_id) REFERENCES fmat.photon_revision_reviews(id);

ALTER TABLE "fmat"."photon_revision_reviews"
  ADD CONSTRAINT "photon_revision_reviews_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE INDEX photon_revision_reviews_draft_idx ON fmat.photon_revision_reviews USING btree (draft_id);

CREATE INDEX photon_revision_reviews_link_idx ON fmat.photon_revision_reviews USING btree (link_id);

CREATE INDEX photon_revision_reviews_request_idx ON fmat.photon_revision_reviews USING btree (request_id);

CREATE TRIGGER photon_revision_decisions_immutable
  BEFORE UPDATE ON fmat.photon_revision_decisions
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

CREATE TRIGGER photon_revision_reviews_immutable
  BEFORE UPDATE ON fmat.photon_revision_reviews
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "fmat"."photon_revision_command"(uuid) FROM PUBLIC;
