SET local check_function_bodies = off;

CREATE TABLE "fmat"."candidate_publications" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"      uuid                     NOT NULL,
  "ranking_id"      uuid                     NOT NULL,
  "check_id"        uuid                     NOT NULL,
  "context_basis"   text                     NOT NULL,
  "result_revision" integer                  NOT NULL,
  "candidates"      jsonb                    NOT NULL,
  "resolution"      text                     NOT NULL,
  "truncated"       boolean                  NOT NULL,
  "expires_at"      timestamp with time zone NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "candidate_publications_candidates_check" CHECK (((jsonb_typeof(candidates) = 'array'::text) AND (jsonb_array_length(candidates) <= 30))),
  CONSTRAINT "candidate_publications_context_basis_check" CHECK ((context_basis ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "candidate_publications_pkey" PRIMARY KEY (id),
  CONSTRAINT "candidate_publications_ranking_id_key" UNIQUE (ranking_id),
  CONSTRAINT "candidate_publications_resolution_check" CHECK ((resolution = ANY (ARRAY['available'::text, 'clarification'::text, 'no_candidates'::text]))),
  CONSTRAINT "candidate_publications_result_revision_check" CHECK ((result_revision > 0))
);

ALTER TABLE "fmat"."candidate_publications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."proposal_evidence" (
  "request_id"       uuid    NOT NULL,
  "proposal_version" integer NOT NULL,
  "publication_id"   uuid    NOT NULL,
  "evaluation_id"    uuid    NOT NULL,
  "context_basis"    text    NOT NULL,
  CONSTRAINT "proposal_evidence_pkey" PRIMARY KEY (request_id, proposal_version)
);

ALTER TABLE "fmat"."proposal_evidence"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."scheduling_decisions" (
  "request_id"      uuid    NOT NULL,
  "actor_scope"     text    NOT NULL,
  "key"             uuid    NOT NULL,
  "operation"       text    NOT NULL,
  "input"           jsonb   NOT NULL,
  "result_revision" integer NOT NULL,
  CONSTRAINT "scheduling_decisions_operation_check" CHECK ((operation = ANY (ARRAY['select'::text, 'agree'::text]))),
  CONSTRAINT "scheduling_decisions_pkey" PRIMARY KEY (request_id, actor_scope, key)
);

ALTER TABLE "fmat"."scheduling_decisions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "fmat"."candidate_rankings"
  ADD COLUMN "basis" text;

ALTER TABLE "fmat"."requests"
  ADD COLUMN "candidate_publication_id" uuid;

CREATE OR REPLACE FUNCTION fmat.request_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests; v_host fmat.hosts; v_details jsonb; v_id uuid; v_start timestamptz; v_end timestamptz; v_proposal jsonb; v_version integer;
  v_challenge fmat.contact_challenges; v_replay fmat.idempotency; v_scope text; v_hash text; v_encrypted text; v_purpose text; v_mode text; v_location text;
begin
  if p_operation in ('candidates_save','proposal_create','proposal_revise','requester_agree','manual_allowance_save','preference_exception_save')
    or (p_operation='mutation_replay' and p_input->>'operation' in ('proposal_create','proposal_revise','manual_allowance_save','preference_exception_save')) then raise exception 'FORBIDDEN';end if;
  perform fmat.request_authorize(p_operation,p_actor,p_input);
  if p_operation='mutation_replay' then
    if jsonb_typeof(p_input->'clientInput') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input->'clientInput') k where k not in ('requestId','expectedRevision','start','end','mode','location','edge','durationMinutes','confirmed','proposalVersion','reason','idempotencyKey','patch','reviewedRevision')) then raise exception 'INVALID_INPUT'; end if;
    if p_input->'clientInput'->>'requestId' is distinct from p_input->>'requestId' then raise exception 'INVALID_INPUT'; end if;
    v_scope:=p_actor->>'kind'||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash');
    select * into v_replay from fmat.idempotency where actor_scope=v_scope and operation=p_input->>'operation' and key=p_input->>'idempotencyKey';
    if not found or v_replay.result is null then return jsonb_build_object('found',false); end if;
    if p_input->>'operation'='details_update' then
      if v_replay.input->'clientInput' is distinct from p_input->'clientInput' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    elsif ((case when p_input->>'operation'='manual_allowance_save' then v_replay.input->'clientInput' else v_replay.input end) @> (p_input->'clientInput')) is not true then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('found',true,'result',v_replay.result);
  end if;
  if p_operation='request_create' then
    select * into v_host from fmat.hosts where handle=p_input->>'handle' for share;
    if not found or not fmat.host_ready(v_host) then raise exception 'NOT_FOUND'; end if;
    if coalesce(p_input->>'tokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
    v_details:=fmat.normalize_details(p_input->'details');
    insert into fmat.requests(host_id,details,token_hash,status,expires_at) values(v_host.id,v_details,p_input->>'tokenHash',case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end,fmat.request_expiry(v_details,now())) returning * into v_request;
    perform fmat.audit(p_operation,p_actor,v_request.id::text);
    return fmat.request_view(v_request.id,'{"kind":"guest"}');
  elsif p_operation='requests_list' then
    return jsonb_build_object('requests',(select coalesce(jsonb_agg(fmat.request_view(id,p_actor) order by created_at desc),'[]'::jsonb) from fmat.requests where host_id=fmat.require_host(p_actor,true)));
  elsif p_operation='request_expire' then return jsonb_build_object('expired',fmat.expire_requests()); end if;
  select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_operation='request_read' then return fmat.request_view(v_request.id,p_actor); end if;
  if p_operation in ('contact_recover','contact_redeem') then
    if v_request.status in ('booked','withdrawn','declined','expired') or v_request.expires_at<=now() then raise exception 'NOT_FOUND'; end if;
  else
    if v_request.status in ('booked','withdrawn','declined','expired') then raise exception 'REQUEST_CLOSED'; end if;
    if v_request.expires_at<=now() and v_request.status<>'booking' then raise exception 'REQUEST_EXPIRED'; end if;
  end if;
  select * into v_host from fmat.hosts where id=v_request.host_id;
  if p_operation='evaluation_read' then
    if not fmat.host_ready(v_host) then raise exception 'RECONNECT_REQUIRED'; end if;
    return jsonb_build_object('requestId',v_request.id,'hostId',v_request.host_id,'revision',v_request.revision,'details',v_request.details,'rules',v_host.rules,'rulesVersion',v_host.rules_version,'privateSchedulingContext',v_request.private_scheduling_context,
      'requesterAvailabilityMode',v_request.availability_mode,'requesterAvailabilityFailed',v_request.availability_failed,'requesterConnection',exists(select 1 from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null));
  end if;
  if p_operation not in ('contact_recover','contact_redeem') then
    if (p_input->>'expectedRevision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
    if v_request.status='booking' and p_operation<>'requester_withdraw' then raise exception 'BOOKING_PENDING'; end if;
  end if;
  case p_operation
  when 'preference_exception_save' then
    if p_input->>'confirmed' is distinct from 'true' or length(trim(coalesce(p_input->>'reason',''))) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
    if v_request.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_CONFLICT'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'STALE_EVALUATION'; end if;
    select details into strict v_proposal from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version;
    update fmat.requests set private_scheduling_context=jsonb_set(private_scheduling_context,'{preferenceException}',jsonb_build_object('proposalVersion',current_proposal_version,'rulesVersion',v_host.rules_version,'proposalDetails',v_proposal,'hostId',p_actor->>'id','confirmedAt',now(),'reason',trim(p_input->>'reason'))) where id=v_request.id;
  when 'model_claim' then
    if v_request.model_calls>=8 then return jsonb_build_object('allowed',false); end if;
    update fmat.requests set model_calls=model_calls+1 where id=v_request.id;
    return jsonb_build_object('allowed',true);
  when 'assistant_message_save' then
    if length(trim(coalesce(p_input->>'text',''))) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.request_messages(request_id,role,audience,text,actor) values(v_request.id,'assistant','shared',trim(p_input->>'text'),p_actor);
  when 'private_context_save','manual_allowance_save' then
    if p_operation='private_context_save' then
      if jsonb_typeof(p_input->'physicalContext') is distinct from 'array' or jsonb_array_length(p_input->'physicalContext')>10
        or length(coalesce(p_input->>'candidatePhysicalLocation',''))>2000 then raise exception 'INVALID_INPUT'; end if;
      for v_details in select value from jsonb_array_elements(p_input->'physicalContext') loop
        if length(coalesce(v_details->>'location','')) not between 1 and 2000 or coalesce(v_details->>'at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'INVALID_INPUT'; end if;
      end loop;
      update fmat.requests set private_scheduling_context=jsonb_build_object('physicalContext',p_input->'physicalContext','candidatePhysicalLocation',p_input->>'candidatePhysicalLocation','manualTravelAllowances','[]'::jsonb) where id=v_request.id;
    else
      v_details:=p_input->'allowance';
      if p_input->>'confirmed' is distinct from 'true' or (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version
        or v_details->>'hostId' is distinct from p_actor->>'id' or coalesce((v_details->>'durationMinutes')::integer,0) not between 1 and 1440
        or (v_details->'context'->>'rulesVersion')::integer is distinct from v_host.rules_version
        or coalesce(v_details->'context'->'slot'->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or coalesce(v_details->'context'->'slot'->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or jsonb_array_length(coalesce(v_request.private_scheduling_context->'manualTravelAllowances','[]'::jsonb))>=20 then raise exception 'INVALID_INPUT'; end if;
      update fmat.requests set private_scheduling_context=jsonb_set(private_scheduling_context,'{manualTravelAllowances}',coalesce(private_scheduling_context->'manualTravelAllowances','[]'::jsonb)||jsonb_build_array(v_details)) where id=v_request.id;
    end if;
    update fmat.requests set candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status='negotiating' where id=v_request.id;
  when 'message_add','private_note_save' then
    if length(trim(coalesce(p_input->>'text',''))) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.request_messages(request_id,role,audience,text,actor) values(v_request.id,case when p_actor->>'kind'='guest' then 'requester' else 'host' end,
      case when p_operation='private_note_save' then 'host' else 'shared' end,trim(p_input->>'text'),p_actor-'tokenHash');
    if p_operation='private_note_save' then update fmat.requests set private_notes=trim(p_input->>'text') where id=v_request.id; end if;
  when 'details_update','extraction_save' then
    if p_operation='extraction_save' and (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'STALE_EVALUATION'; end if;
    v_details:=fmat.normalize_details(p_input->'details');
    update fmat.requests set details=v_details,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
      status=case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end,expires_at=fmat.request_expiry(v_details,created_at),
      contact_verified_email=case when v_details->>'requesterEmail'=details->>'requesterEmail' then contact_verified_email else null end where id=v_request.id;
    update fmat.contact_challenges set consumed_at=now() where request_id=v_request.id and consumed_at is null and email<>v_details->>'requesterEmail';
  when 'candidates_save' then
    if v_request.host_availability_failed then raise exception 'RECONNECT_REQUIRED'; end if;
    if v_request.availability_mode='calendar' and (v_request.availability_failed or not exists(select 1 from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null and guest_authority_key=v_request.token_hash and cardinality(selected_calendar_ids)>0)) then raise exception 'RECONNECT_REQUIRED'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version or not fmat.host_ready(v_host) then raise exception 'STALE_EVALUATION'; end if;
    if jsonb_typeof(p_input->'candidates') is distinct from 'array' or jsonb_array_length(p_input->'candidates')>300 or jsonb_typeof(coalesce(p_input->'privateDiagnostics','[]'::jsonb)) is distinct from 'array' or jsonb_typeof(coalesce(p_input->'privateTravelChecks','[]'::jsonb)) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    for v_details in select value from jsonb_array_elements(p_input->'candidates') loop
      if coalesce(v_details->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(v_details->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or (v_details->>'start')::timestamptz<=now() or (v_details->>'end')::timestamptz-(v_details->>'start')::timestamptz<>make_interval(mins=>(v_request.details->>'durationMinutes')::integer)
        or not exists(select 1 from jsonb_array_elements(v_request.details->'windows') w where (w->>'start')::timestamptz<=(v_details->>'start')::timestamptz and (w->>'end')::timestamptz>=(v_details->>'end')::timestamptz) then raise exception 'INVALID_INPUT'; end if;
    end loop;
    update fmat.requests set candidates=(select coalesce(jsonb_agg(jsonb_build_object('start',c->>'start','end',c->>'end')),'[]'::jsonb) from jsonb_array_elements(p_input->'candidates') c),private_diagnostics=coalesce(p_input->'privateDiagnostics','[]'::jsonb)||case when p_input->>'unresolved'='true' then jsonb_build_array(jsonb_build_object('code','evaluation_unresolved')) else '[]'::jsonb end,private_travel_checks=coalesce(p_input->'privateTravelChecks','[]'::jsonb),evaluated_rules_version=v_host.rules_version,evaluated_at=now() where id=v_request.id;
    if v_request.current_proposal_version is not null and not exists(select 1 from fmat.proposals p,jsonb_array_elements(p_input->'candidates') c where p.request_id=v_request.id and p.version=v_request.current_proposal_version and (p.details->>'start')::timestamptz=(c->>'start')::timestamptz and (p.details->>'end')::timestamptz=(c->>'end')::timestamptz) then
      update fmat.requests set current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=v_request.id;
    end if;
  when 'proposal_create','proposal_revise' then
    if v_request.host_availability_failed or (v_request.availability_mode='calendar' and v_request.availability_failed) then raise exception 'RECONNECT_REQUIRED'; end if;
    if not fmat.details_complete(v_request.details) then raise exception 'DETAILS_REQUIRED'; end if;
    if p_operation='proposal_create' and (v_request.evaluated_rules_version is distinct from v_host.rules_version or v_request.evaluated_at is null or v_request.evaluated_at<now()-interval '5 minutes') then raise exception 'STALE_EVALUATION'; end if;
    v_start:=(p_input->>'start')::timestamptz; v_end:=(p_input->>'end')::timestamptz;
    if p_operation='proposal_create' and not exists(select 1 from jsonb_array_elements(v_request.candidates) c where (c->>'start')::timestamptz=v_start and (c->>'end')::timestamptz=v_end) then raise exception 'CANDIDATE_INVALID'; end if;
    v_mode:=coalesce(p_input->>'mode',v_request.details->>'mode'); v_location:=coalesce(p_input->>'location',v_request.details->>'location');
    if p_operation='proposal_revise' then
      v_details:=p_input->'validatedEvidence';
      if (v_details->>'rulesVersion')::integer is distinct from v_host.rules_version or (v_details->>'requestRevision')::integer is distinct from v_request.revision
        or (v_details->>'start')::timestamptz is distinct from v_start or (v_details->>'end')::timestamptz is distinct from v_end
        or v_details->>'mode' is distinct from v_mode or v_details->>'location' is distinct from v_location then raise exception 'STALE_EVALUATION'; end if;
      v_details:=fmat.normalize_details(v_request.details||jsonb_build_object('mode',v_mode,'location',v_location));
      if not fmat.details_complete(v_details) then raise exception 'DETAILS_REQUIRED'; end if;
      if v_end-v_start<>make_interval(mins=>(v_details->>'durationMinutes')::integer) or v_start<=now()
        or not exists(select 1 from jsonb_array_elements(v_details->'windows') w where (w->>'start')::timestamptz<=v_start and (w->>'end')::timestamptz>=v_end) then raise exception 'CANDIDATE_INVALID'; end if;
      update fmat.requests set details=v_details,candidates=jsonb_build_array(jsonb_build_object('start',v_start,'end',v_end)),evaluated_rules_version=v_host.rules_version,evaluated_at=now() where id=v_request.id;
    elsif v_mode is distinct from v_request.details->>'mode' or v_location is distinct from v_request.details->>'location' then raise exception 'STALE_EVALUATION'; end if;
    select coalesce(max(version),0)+1 into v_version from fmat.proposals where request_id=v_request.id;
    v_proposal:=jsonb_build_object('version',v_version,'start',v_start,'end',v_end,'timezone',v_request.details->>'timezone','mode',v_mode,'location',v_location,
      'requesterName',v_request.details->>'requesterName','requesterEmail',v_request.details->>'requesterEmail','purpose',v_request.details->>'purpose');
    insert into fmat.proposals(request_id,version,details,rules_version) values(v_request.id,v_version,v_proposal,v_host.rules_version);
    update fmat.requests set current_proposal_version=v_version,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=v_request.id;
  when 'requester_agree' then
    if v_request.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_CONFLICT'; end if;
    if not exists(select 1 from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version and rules_version=v_host.rules_version) then raise exception 'STALE_EVALUATION'; end if;
    update fmat.requests set requester_agreed_version=current_proposal_version,status='awaiting_approval' where id=v_request.id;
  when 'requester_withdraw' then
    if v_request.status='booking' and not fmat.withdraw_allowed(v_request.id) then raise exception 'BOOKING_PENDING'; end if;
    update fmat.requests set status='withdrawn',token_revoked_at=now(),requester_agreed_version=null,host_approved_version=null where id=v_request.id;
  when 'host_decline' then update fmat.requests set status='declined',token_revoked_at=now(),host_approved_version=null where id=v_request.id;
  when 'request_calendar_disconnect' then
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=now(),updated_at=now() where principal_kind='guest' and principal_id=v_request.id;
    update fmat.requests set candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status='negotiating' where id=v_request.id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,now()),encrypted_verifier=null where actor->>'kind'='guest' and actor->>'requestId'=v_request.id::text and saved_at is null;
  when 'contact_start','contact_recover' then
    if p_operation='contact_recover' and lower(trim(coalesce(p_input->>'email',''))) is distinct from v_request.details->>'requesterEmail' then raise exception 'NOT_FOUND'; end if;
    if coalesce(v_request.details->>'requesterEmail','')='' then raise exception 'DETAILS_REQUIRED'; end if;
    v_purpose:=case when p_operation='contact_start' then 'verification' else 'recovery' end;
    v_hash:=case when p_operation='contact_start' then p_input->>'codeHash' else p_input->>'tokenHash' end;
    v_encrypted:=case when p_operation='contact_start' then p_input->>'encryptedCode' else p_input->>'encryptedToken' end;
    if coalesce(v_hash,'') !~ '^[0-9a-f]{64}$' or length(coalesce(v_encrypted,''))<20 then raise exception 'INVALID_INPUT'; end if;
    if exists(select 1 from fmat.contact_challenges where request_id=v_request.id and purpose=v_purpose and created_at>now()-interval '1 minute') then raise exception 'RATE_LIMITED'; end if;
    update fmat.contact_challenges set consumed_at=now() where request_id=v_request.id and purpose=v_purpose and consumed_at is null;
    insert into fmat.contact_challenges(request_id,email,purpose,secret_hash) values(v_request.id,v_request.details->>'requesterEmail',v_purpose,v_hash) returning id into v_id;
    insert into fmat.outbox(dedupe_key,audience,recipient,payload) values('contact:'||v_id::text,'requester',jsonb_build_object('email',v_request.details->>'requesterEmail'),
      jsonb_build_object('kind','contact_'||v_purpose,'requestId',v_request.id,'challengeId',v_id,'encryptedSecret',v_encrypted)) returning id into v_id;
    perform fmat.enqueue_job('contact_delivery','contact-delivery:'||v_id::text,jsonb_build_object('outboxId',v_id));
    if p_operation='contact_recover' then return jsonb_build_object('status','pending'); end if;
  when 'contact_confirm','contact_redeem' then
    v_purpose:=case when p_operation='contact_confirm' then 'verification' else 'recovery' end;
    v_hash:=case when p_operation='contact_confirm' then p_input->>'codeHash' else p_input->>'tokenHash' end;
    select * into v_challenge from fmat.contact_challenges where request_id=v_request.id and purpose=v_purpose and secret_hash=v_hash and consumed_at is null order by created_at desc limit 1 for update;
    if not found or v_challenge.expires_at<=now() or v_challenge.email is distinct from v_request.details->>'requesterEmail' then raise exception 'CONTACT_INVALID'; end if;
    update fmat.contact_challenges set consumed_at=now() where id=v_challenge.id;
    update fmat.requests set contact_verified_email=v_challenge.email where id=v_request.id;
    if p_operation='contact_redeem' then
      if coalesce(p_input->>'newTokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
      update fmat.requests set token_hash=p_input->>'newTokenHash',token_expires_at=now()+interval '30 days',token_revoked_at=null where id=v_request.id;
    end if;
  else raise exception 'UNKNOWN_OPERATION'; end case;
  update fmat.requests set revision=revision+1,updated_at=now() where id=v_request.id returning * into v_request;
  insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(v_request.id,v_request.revision,p_operation,p_actor-'tokenHash',v_request.current_proposal_version);
  perform fmat.audit(p_operation,p_actor,v_request.id::text,jsonb_build_object('revision',v_request.revision,'proposalVersion',v_request.current_proposal_version));
  return fmat.request_view(v_request.id,case when p_actor->>'kind'='host' then p_actor else '{"kind":"guest"}'::jsonb end);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.scheduling_view (
  p_request_id uuid,
  p_context    text,
  p_reconnect  boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests; p fmat.candidate_publications; proposal jsonb; bound boolean:=false; current boolean:=false; availability text;
begin
 select * into strict r from fmat.requests where id=p_request_id;
 select * into p from fmat.candidate_publications where id=r.candidate_publication_id and request_id=r.id;
 current:=p.id is not null and p.context_basis=p_context and p.expires_at>clock_timestamp() and p.check_id=r.availability_check_id and r.availability_check_started_at>clock_timestamp()-interval '5 minutes' and not r.host_availability_failed and not(r.availability_mode='calendar' and r.availability_failed);
 select details into proposal from fmat.proposals where request_id=r.id and version=r.current_proposal_version;
 bound:=exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=p_context);
 availability:=case when p_reconnect then 'reconnect_required' when p.id is null then 'not_evaluated' when not current then 'stale' else p.resolution end;
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'status',r.status,'detailsComplete',fmat.details_complete(r.details),'availability',availability,
 'publication',case when current then jsonb_build_object('id',p.id,'expiresAt',p.expires_at,'truncated',p.truncated,'candidates',p.candidates) else null end,
 'proposal',proposal,'requesterAgreed',bound and coalesce(r.requester_agreed_version=r.current_proposal_version,false),
 'canAgree',coalesce(bound and proposal is not null and not p_reconnect and not r.host_availability_failed and not(r.availability_mode='calendar' and r.availability_failed),false));
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_candidate_ranking (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; e fmat.candidate_evaluations; saved fmat.candidate_rankings;
 candidates jsonb:='[]'; ids jsonb:='[]'; manifest jsonb:='[]'; fingerprint text; expires timestamptz; result jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or p_operation not in ('read','save') then raise exception 'INVALID_INPUT';end if;
 -- Reuse request -> host -> session -> connections lock order and all current
 -- authority/failure/context fences before inspecting any candidate evidence.
 perform public.fmat_availability_evaluation('check',p_credential,p_input);
 select * into strict r from fmat.requests where id=(p_input->>'requestId')::uuid;
 if r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then raise exception 'RECONNECT_REQUIRED';end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','checkId','basis','fingerprint','orderedIds')) then raise exception 'INVALID_INPUT';end if;
 expires:=least(r.availability_check_started_at+interval '5 minutes',r.expires_at);
 if (select count(*) from fmat.candidate_evaluations where request_id=r.id and check_id=r.availability_check_id)>30 then raise exception 'INVALID_INPUT';end if;
 for e in select * from fmat.candidate_evaluations where request_id=r.id and check_id=r.availability_check_id order by id loop
  perform public.fmat_availability_evaluation('evidence_read',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision,'evaluationId',e.id));
  manifest:=manifest||jsonb_build_array(jsonb_build_object('id',e.id,'status',e.status,'expiresAt',e.expires_at));
  expires:=least(expires,e.expires_at);
  if e.status='checks_passed' then
   -- Historical pending evidence cannot enter the model even if mislabeled.
   if (e.evidence->>'interval'='fits' and e.evidence->'travel'->>'status'='fits' and e.evidence->'preferences'->>'status'='satisfied') is not true then raise exception 'INVALID_INPUT';end if;
   candidates:=candidates||jsonb_build_array(jsonb_build_object('id',e.id,'interval',e.candidate));ids:=ids||to_jsonb(e.id);
  end if;
 end loop;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('basis',p_input->>'basis','checkId',r.availability_check_id,'manifest',manifest)::text,'UTF8')),'hex');
 select * into saved from fmat.candidate_rankings where request_id=r.id and check_id=r.availability_check_id;
 if saved.id is not null and (saved.fingerprint<>fingerprint or saved.expires_at<=clock_timestamp()) then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='save' then
  if p_input->>'fingerprint' is distinct from fingerprint then raise exception 'REVISION_CONFLICT';end if;
  if jsonb_typeof(p_input->'orderedIds') is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
  if jsonb_array_length(p_input->'orderedIds')<>jsonb_array_length(ids)
   or exists(select 1 from jsonb_array_elements(p_input->'orderedIds') x where jsonb_typeof(x)<>'string' or not(ids @> jsonb_build_array(x)))
   or (select count(distinct x) from jsonb_array_elements(p_input->'orderedIds') x)<>jsonb_array_length(ids) then raise exception 'INVALID_INPUT';end if;
  if saved.id is not null then
   if saved.ordered_ids is distinct from p_input->'orderedIds' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  else
   if expires<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
   insert into fmat.candidate_rankings(request_id,check_id,request_revision,basis,fingerprint,ordered_ids,expires_at)
    values(r.id,r.availability_check_id,r.revision,p_input->>'basis',fingerprint,p_input->'orderedIds',expires) returning * into saved;
  end if;
 end if;
 if saved.id is not null then result:=jsonb_build_object('rankingId',saved.id,'requestId',r.id,'revision',r.revision,'checkId',r.availability_check_id,'orderedIds',saved.ordered_ids,'expiresAt',saved.expires_at,'complete',false);end if;
 if p_operation='read' then return jsonb_build_object('fingerprint',fingerprint,'input',jsonb_build_object('timezone',r.details->>'timezone','candidates',candidates),'saved',result);end if;
 return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_scope text; v_key text; v_record fmat.idempotency; v_result jsonb; v_identity_input jsonb;
begin
  if p_operation in ('candidates_save','proposal_create','proposal_revise','requester_agree','manual_allowance_save','preference_exception_save')
    or (p_operation='mutation_replay' and p_input->>'operation' in ('proposal_create','proposal_revise','manual_allowance_save','preference_exception_save')) then raise exception 'FORBIDDEN';end if;
  if jsonb_typeof(p_actor) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object' or p_actor->>'kind' is null or p_actor->>'kind' not in ('host','guest','worker','operator','public') then raise exception 'INVALID_INPUT'; end if;
  perform fmat.authorize_command(p_operation,p_actor,p_input);
  if p_operation like 'jobs_%' or p_operation in ('oauth_consume','credential_save','token_update','oauth_cleanup','host_public','setup_read','calendar_read','requests_list','request_read','connection_read','evaluation_read','candidates_save','extraction_save','assistant_message_save','model_claim','request_expire','mutation_replay','delivery_load','delivery_dispatch','delivery_record','booking_load','booking_dispatch','booking_record_outcome','setup_conversation_read','setup_channel_authorize','setup_turn_lookup','setup_bridge_resume','setup_bridge_checkpoint','setup_provider_outbound_claim','setup_provider_outbound_authorize') then return fmat.dispatch_command(p_operation,p_actor,p_input); end if;
  v_key:=p_input->>'idempotencyKey';
  if v_key is null or length(v_key) not between 1 and 200 then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  v_scope:=coalesce(p_actor->>'kind','')||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash',p_actor->>'email','public');
  v_identity_input:=case
    when p_operation='oauth_start' then jsonb_build_object('context',p_input->'context','idempotencyKey',v_key)
    when p_operation='contact_start' then p_input-'encryptedCode'
    when p_operation='contact_recover' then p_input-'encryptedToken'
    when p_operation='manual_allowance_save' then jsonb_set(p_input,'{allowance}',(p_input->'allowance')-'confirmedAt')
    when p_operation='setup_turn_append' then jsonb_build_object('text',p_input->'text','channel',p_input->'channel','expectedRevision',p_input->'expectedRevision','clientTurnId',p_input->'clientTurnId','providerMessageId',p_input->'providerMessageId','provider',p_input->'provider','senderId',p_input->'senderId','privateConversationId',p_input->'privateConversationId','isGroup',p_input->'isGroup','idempotencyKey',v_key)
    else p_input end;
  insert into fmat.idempotency(actor_scope,operation,key,input) values(v_scope,p_operation,v_key,v_identity_input) on conflict do nothing;
  select * into strict v_record from fmat.idempotency where actor_scope=v_scope and operation=p_operation and key=v_key for update;
  if v_record.input<>v_identity_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_record.result is not null then
    if p_operation='oauth_start' and not exists(select 1 from fmat.oauth_exchanges where id=(v_record.result->>'exchangeId')::uuid and consumed_at is null and expires_at>now()) then raise exception 'OAUTH_STATE_INVALID'; end if;
    if p_operation='request_create' and not exists(select 1 from fmat.requests r join fmat.hosts h on h.id=r.host_id where r.id=(v_record.result->>'id')::uuid and r.token_hash=p_input->>'tokenHash' and r.token_revoked_at is null and r.expires_at>now() and fmat.host_ready(h)) then raise exception 'REQUEST_CLOSED'; end if;
    if p_operation='contact_redeem' and not exists(select 1 from fmat.requests where id=(p_input->>'requestId')::uuid and token_hash=p_input->>'newTokenHash' and token_revoked_at is null and expires_at>now()) then raise exception 'CONTACT_INVALID'; end if;
    return v_record.result;
  end if;
  v_result:=fmat.dispatch_command(p_operation,p_actor,p_input);
  update fmat.idempotency set result=v_result where actor_scope=v_scope and operation=p_operation and key=v_key;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_scheduling (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; actor jsonb; context text; reconnect boolean:=false; pub fmat.candidate_publications; ranking fmat.candidate_rankings; e fmat.candidate_evaluations;
 snapshot jsonb; v_candidates jsonb:='[]'; c jsonb; proposal jsonb; version integer; decision fmat.scheduling_decisions; scope text; resolution text;
begin
 if p_operation is null or p_operation not in ('read','publish','select','agree') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 if r.status in ('booking','booked','withdrawn','declined','expired') or r.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND';end if;
 -- The current-context helper also checks live account/session, host readiness,
 -- guest consent and lock-wait expiry, in the evaluator's lock order.
 begin
  context:=public.fmat_availability_evaluation('current_context',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision))->>'travelBasis';
 exception when raise_exception then
  if p_operation='read' and sqlerrm='RECONNECT_REQUIRED' then reconnect:=true;else raise;end if;
 end;
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
  return fmat.scheduling_view(r.id,context,reconnect);
 end if;
 if p_operation='publish' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','rankingId','truncated')) or jsonb_typeof(p_input->'truncated') is distinct from 'boolean' then raise exception 'INVALID_INPUT';end if;
  select * into pub from fmat.candidate_publications where ranking_id=(p_input->>'rankingId')::uuid and request_id=r.id;
  if pub.id is not null then
   if pub.context_basis is distinct from context or pub.id is distinct from r.candidate_publication_id or pub.result_revision<>r.revision or pub.check_id is distinct from r.availability_check_id or pub.expires_at<=clock_timestamp() or r.availability_check_started_at is null or r.availability_check_started_at<=clock_timestamp()-interval '5 minutes' then raise exception 'REVISION_CONFLICT';end if;
   if pub.truncated is distinct from (p_input->>'truncated')::boolean or (p_input->>'revision')::integer is distinct from pub.result_revision-1 then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return fmat.scheduling_view(r.id,context);
  end if;
 else
  if p_input->'confirmed' is distinct from 'true'::jsonb or (p_operation='agree' and actor->>'kind'<>'guest') then raise exception 'FORBIDDEN';end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','publicationId','candidateId','proposalVersion','confirmed','idempotencyKey')) then raise exception 'INVALID_INPUT';end if;
  scope:=case when actor->>'kind'='guest' then 'guest:'||(actor->>'tokenHash') else 'host:'||(p_credential->>'subject')||':'||(p_credential->>'sessionId') end;
  if p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT';end if;
  select * into decision from fmat.scheduling_decisions where request_id=r.id and actor_scope=scope and key=(p_input->>'idempotencyKey')::uuid;
  if decision.key is not null then
   if decision.operation<>p_operation or decision.input is distinct from p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if decision.result_revision<>r.revision or not exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=context) then raise exception 'REVISION_CONFLICT';end if;
   return fmat.scheduling_view(r.id,context);
  end if;
 end if;
 if (p_input->>'revision')::integer is distinct from r.revision then raise exception 'REVISION_CONFLICT';end if;
 if r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then raise exception 'RECONNECT_REQUIRED';end if;
 if not fmat.details_complete(r.details) then raise exception 'INVALID_INPUT';end if;
 if p_operation='publish' then
  select * into ranking from fmat.candidate_rankings where id=(p_input->>'rankingId')::uuid and request_id=r.id;
  if not found then raise exception 'NOT_FOUND';end if;
  -- Empty time samples have no evidence rows. Recompute their basis from the
  -- current attempt using the explicit basis retained on the ranking below.
  snapshot:=public.fmat_candidate_ranking('read',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision,'checkId',ranking.check_id,'basis',ranking.basis));
  if snapshot->'saved'->>'rankingId' is distinct from ranking.id::text then raise exception 'REVISION_CONFLICT';end if;
  for c in select value from jsonb_array_elements(ranking.ordered_ids) loop
   select * into strict e from fmat.candidate_evaluations where id=(c#>>'{}')::uuid and request_id=r.id;
   v_candidates:=v_candidates||jsonb_build_array(jsonb_build_object('id',e.id,'interval',e.candidate));
  end loop;
  resolution:=case when jsonb_array_length(v_candidates)>0 then 'available' when exists(select 1 from fmat.candidate_evaluations where request_id=r.id and check_id=ranking.check_id and status='clarification') then 'clarification' else 'no_candidates' end;
  insert into fmat.candidate_publications(request_id,ranking_id,check_id,context_basis,result_revision,candidates,resolution,truncated,expires_at)
   values(r.id,ranking.id,ranking.check_id,context,r.revision+1,v_candidates,resolution,(p_input->>'truncated')::boolean,ranking.expires_at) returning * into pub;
  update fmat.requests set candidate_publication_id=pub.id,candidates=(select coalesce(jsonb_agg(value->'interval'),'[]') from jsonb_array_elements(v_candidates)),
   current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_rules_version=(select rules_version from fmat.hosts where id=r.host_id),evaluated_at=clock_timestamp(),status='negotiating' where id=r.id;
 elsif p_operation='select' then
  select * into pub from fmat.candidate_publications where id=(p_input->>'publicationId')::uuid and request_id=r.id;
  if pub.id is null or pub.id is distinct from r.candidate_publication_id or pub.context_basis is distinct from context or pub.check_id is distinct from r.availability_check_id or pub.expires_at<=clock_timestamp() or r.availability_check_started_at is null or r.availability_check_started_at<=clock_timestamp()-interval '5 minutes' then raise exception 'REVISION_CONFLICT';end if;
  select value into c from jsonb_array_elements(pub.candidates) where value->>'id'=p_input->>'candidateId';if c is null then raise exception 'INVALID_INPUT';end if;
  select * into strict e from fmat.candidate_evaluations where id=(c->>'id')::uuid and request_id=r.id;
  select coalesce(max(p.version),0)+1 into version from fmat.proposals p where request_id=r.id;
  proposal:=jsonb_build_object('version',version,'start',c->'interval'->>'start','end',c->'interval'->>'end','timezone',r.details->>'timezone','mode',r.details->>'mode','location',r.details->>'location','requesterName',r.details->>'requesterName','requesterEmail',r.details->>'requesterEmail','purpose',r.details->>'purpose');
  insert into fmat.proposals(request_id,version,details,rules_version) values(r.id,version,proposal,e.rules_version);
  insert into fmat.proposal_evidence(request_id,proposal_version,publication_id,evaluation_id,context_basis) values(r.id,version,pub.id,e.id,context);
  update fmat.requests set current_proposal_version=version,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=r.id;
 elsif p_operation='agree' then
  if r.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from r.current_proposal_version
   or not exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=context) then raise exception 'REVISION_CONFLICT';end if;
  update fmat.requests set requester_agreed_version=current_proposal_version,host_approved_version=null,status='awaiting_approval' where id=r.id;
 end if;
 update fmat.requests set revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
 if p_operation in ('select','agree') then insert into fmat.scheduling_decisions(request_id,actor_scope,key,operation,input,result_revision) values(r.id,scope,(p_input->>'idempotencyKey')::uuid,p_operation,p_input,r.revision);end if;
 insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'scheduling_'||p_operation,actor-'tokenHash',r.current_proposal_version);
 perform fmat.audit('scheduling_'||p_operation,actor,r.id::text);
 return fmat.scheduling_view(r.id,context);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_scheduling"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."candidate_publications"
  ADD CONSTRAINT "candidate_publications_ranking_id_fkey" FOREIGN KEY (ranking_id) REFERENCES fmat.candidate_rankings(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."candidate_publications"
  ADD CONSTRAINT "candidate_publications_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."candidate_rankings"
  ADD CONSTRAINT "candidate_rankings_basis_check" CHECK ((basis ~ '^[a-f0-9]{64}$'::text));

ALTER TABLE "fmat"."proposal_evidence"
  ADD CONSTRAINT "proposal_evidence_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES fmat.candidate_evaluations(id);

ALTER TABLE "fmat"."proposal_evidence"
  ADD CONSTRAINT "proposal_evidence_publication_id_fkey" FOREIGN KEY (publication_id) REFERENCES fmat.candidate_publications(id);

ALTER TABLE "fmat"."proposal_evidence"
  ADD CONSTRAINT "proposal_evidence_request_id_proposal_version_fkey" FOREIGN KEY (request_id, proposal_version) REFERENCES fmat.proposals(request_id, VERSION);

ALTER TABLE "fmat"."requests"
  ADD CONSTRAINT "requests_candidate_publication_id_fkey" FOREIGN KEY (candidate_publication_id) REFERENCES fmat.candidate_publications(id);

ALTER TABLE "fmat"."scheduling_decisions"
  ADD CONSTRAINT "scheduling_decisions_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id) ON DELETE CASCADE;

CREATE INDEX candidate_publications_request_idx ON fmat.candidate_publications USING btree (request_id, created_at DESC);

CREATE INDEX proposal_evidence_evaluation_idx ON fmat.proposal_evidence USING btree (evaluation_id);

CREATE INDEX proposal_evidence_publication_idx ON fmat.proposal_evidence USING btree (publication_id);

CREATE INDEX requests_candidate_publication_idx ON fmat.requests USING btree (candidate_publication_id)
  WHERE (candidate_publication_id IS NOT NULL);

CREATE TRIGGER candidate_publications_immutable
  BEFORE UPDATE ON fmat.candidate_publications
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

CREATE TRIGGER proposal_evidence_immutable
  BEFORE UPDATE ON fmat.proposal_evidence
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

CREATE TRIGGER scheduling_decisions_immutable
  BEFORE UPDATE ON fmat.scheduling_decisions
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "public"."fmat_scheduling"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_scheduling"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_scheduling"(text, jsonb, jsonb) TO "service_role";
