SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.photon_proposal_decide (
  p_inbox uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;
