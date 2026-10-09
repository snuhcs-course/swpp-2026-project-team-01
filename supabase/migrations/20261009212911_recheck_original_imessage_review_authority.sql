SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.photon_proposal_review_check (
  p_inbox  uuid,
  p_review uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;
