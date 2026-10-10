SET local check_function_bodies = off;

CREATE TABLE "fmat"."web_approval_decisions" (
  "request_id"      uuid                     NOT NULL,
  "host_id"         uuid                     NOT NULL,
  "session_id"      uuid                     NOT NULL,
  "key"             uuid                     NOT NULL,
  "input"           jsonb                    NOT NULL,
  "approval_id"     uuid                     NOT NULL,
  "result_revision" integer                  NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "web_approval_decisions_approval_id_key" UNIQUE (approval_id),
  CONSTRAINT "web_approval_decisions_pkey" PRIMARY KEY (request_id, host_id, session_id, key),
  CONSTRAINT "web_approval_decisions_result_revision_check" CHECK ((result_revision > 0))
);

ALTER TABLE "fmat"."web_approval_decisions"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fmat_booking_approval (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; actor jsonb; proposal jsonb; context text; blocker text:='none'; approved boolean:=false; agreed boolean:=false;
 prior fmat.web_approval_decisions; approval uuid; attempt uuid; result jsonb; state text;
begin
 if p_operation is null or p_operation not in ('read','approve') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
 else
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','proposalVersion','confirmed','idempotencyKey'))
   or p_input->'confirmed' is distinct from 'true'::jsonb or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT';end if;
  select * into prior from fmat.web_approval_decisions where request_id=r.id and host_id=r.host_id and session_id=(p_credential->>'sessionId')::uuid and key=(p_input->>'idempotencyKey')::uuid;
  if prior.approval_id is not null and prior.input is distinct from p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 end if;
 state:=fmat.request_lifecycle_view(r.id,'host')->>'status';
 select details into proposal from fmat.proposals where request_id=r.id and version=r.current_proposal_version;
 approved:=coalesce(r.host_approved_version=r.current_proposal_version,false) and exists(select 1 from fmat.web_approval_decisions d join fmat.host_approvals a on a.id=d.approval_id where d.request_id=r.id and a.proposal_version=r.current_proposal_version);
 if state in ('booked','withdrawn','declined','expired') then blocker:='closed';proposal:=null;
 elsif state='booking' then blocker:='booking_pending';
 elsif proposal is null then blocker:='proposal_required';
 else
  begin context:=public.fmat_availability_evaluation('current_context',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision))->>'travelBasis';
  exception when raise_exception then if sqlerrm='RECONNECT_REQUIRED' then blocker:='reconnect_required';else raise;end if;end;
  if blocker='none' then
   if not exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=context)
    or (proposal->>'start')::timestamptz<=clock_timestamp() or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() then blocker:='proposal_stale';
   elsif r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then blocker:='reconnect_required';
   elsif r.requester_agreed_version is distinct from r.current_proposal_version then blocker:='agreement_required';
   elsif r.contact_verified_email is distinct from lower(proposal->>'requesterEmail') then blocker:='contact_verification_required';end if;
  end if;
 end if;
 agreed:=proposal is not null and coalesce(r.requester_agreed_version=r.current_proposal_version,false) and blocker not in ('proposal_stale','reconnect_required');
 if p_operation='approve' then
  if prior.approval_id is not null then
   if prior.result_revision<>r.revision or not approved or state<>'booking' then raise exception 'REVISION_CONFLICT';end if;
  else
   if (p_input->>'revision')::integer is distinct from r.revision or (p_input->>'proposalVersion')::integer is distinct from r.current_proposal_version then raise exception 'REVISION_CONFLICT';end if;
   if blocker='booking_pending' then raise exception 'BOOKING_PENDING';end if;
   if blocker='closed' then raise exception 'REQUEST_CLOSED';end if;
   if blocker='reconnect_required' then raise exception 'RECONNECT_REQUIRED';end if;
   if blocker='contact_verification_required' then raise exception 'CONTACT_NOT_VERIFIED';end if;
   if blocker<>'none' then raise exception 'REVISION_CONFLICT';end if;
   -- Authority/context helpers hold request, host, current Auth session and
   -- connection locks. Check wall-clock validity once more before the write.
   if r.expires_at<=clock_timestamp() then raise exception 'REQUEST_CLOSED';end if;
   if (p_credential->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'UNAUTHORIZED';end if;
   update fmat.requests set host_approved_version=current_proposal_version,status='booking',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
   insert into fmat.host_approvals(request_id,proposal_version,host_id,source,approved_revision) values(r.id,r.current_proposal_version,r.host_id,'authenticated_web',r.revision) returning id into approval;
   attempt:=fmat.prepare_booking(r,approval);
   insert into fmat.web_approval_decisions(request_id,host_id,session_id,key,input,approval_id,result_revision) values(r.id,r.host_id,(p_credential->>'sessionId')::uuid,(p_input->>'idempotencyKey')::uuid,p_input,approval,r.revision);
   insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'web_host_approve',actor,r.current_proposal_version);
   perform fmat.audit('web_host_approve',actor,r.id::text,jsonb_build_object('approvalId',approval,'attemptId',attempt));
   approved:=true;state:='booking';blocker:='booking_pending';
  end if;
 end if;
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'status',state,'proposal',proposal,'requesterAgreed',agreed,'approved',approved,'canApprove',blocker='none','blocker',blocker);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_booking_approval"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."web_approval_decisions"
  ADD CONSTRAINT "web_approval_decisions_approval_id_fkey" FOREIGN KEY (approval_id) REFERENCES fmat.host_approvals(id);

ALTER TABLE "fmat"."web_approval_decisions"
  ADD CONSTRAINT "web_approval_decisions_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id);

ALTER TABLE "fmat"."web_approval_decisions"
  ADD CONSTRAINT "web_approval_decisions_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE INDEX web_approval_decisions_host_idx ON fmat.web_approval_decisions USING btree (host_id);

CREATE TRIGGER web_approval_decisions_immutable
  BEFORE UPDATE ON fmat.web_approval_decisions
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "public"."fmat_booking_approval"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_booking_approval"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_booking_approval"(text, jsonb, jsonb) TO "service_role";
