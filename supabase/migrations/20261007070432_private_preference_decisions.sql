SET local check_function_bodies = off;

ALTER TABLE "fmat"."candidate_evaluations"
  DROP CONSTRAINT "candidate_evaluations_evidence_check";

CREATE TABLE "fmat"."preference_decisions" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"          uuid                     NOT NULL,
  "evaluation_id"       uuid                     NOT NULL,
  "host_id"             uuid                     NOT NULL,
  "session_id"          uuid                     NOT NULL,
  "idempotency_key"     uuid                     NOT NULL,
  "input"               jsonb                    NOT NULL,
  "result_revision"     integer                  NOT NULL,
  "context_basis"       text                     NOT NULL,
  "context_fingerprint" text                     NOT NULL,
  "preference_key"      text                     NOT NULL,
  "value"               jsonb                    NOT NULL,
  "created_at"          timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "revoked_at"          timestamp with time zone,
  "revoke_key"          uuid,
  "revoke_input"        jsonb,
  "revoke_revision"     integer,
  CONSTRAINT "preference_decisions_context_basis_check" CHECK ((context_basis ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "preference_decisions_context_fingerprint_check" CHECK ((context_fingerprint ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "preference_decisions_pkey" PRIMARY KEY (id),
  CONSTRAINT "preference_decisions_preference_key_check" CHECK ((preference_key = ANY (ARRAY['meeting_mode'::text, 'location'::text, 'additional'::text]))),
  CONSTRAINT "preference_decisions_request_id_idempotency_key_key" UNIQUE (request_id, idempotency_key),
  CONSTRAINT "preference_decisions_request_id_revoke_key_key" UNIQUE (request_id, revoke_key),
  CONSTRAINT "preference_decisions_value_check" CHECK (((jsonb_typeof(value) = 'object'::text) AND (octet_length((value)::text) <= 8192)))
);

ALTER TABLE "fmat"."preference_decisions"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.protect_preference_decision()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
 if (to_jsonb(new)-'revoked_at'-'revoke_key'-'revoke_input'-'revoke_revision') is distinct from (to_jsonb(old)-'revoked_at'-'revoke_key'-'revoke_input'-'revoke_revision')
  or old.revoked_at is not null then raise exception 'IMMUTABLE_PREFERENCE';end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_availability_evaluation (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_request fmat.requests; v_host fmat.hosts;
  v_host_connection fmat.calendar_connections; v_guest_connection fmat.calendar_connections; v_connection fmat.calendar_connections;
  v_basis text; v_travel_basis text; v_bookings jsonb; v_commitments jsonb; v_check uuid;
  v_evaluation fmat.candidate_evaluations; v_evidence jsonb; v_candidate jsonb; v_candidate_key text; v_status text; v_expires timestamptz; v_now timestamptz; v_private_context jsonb;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  -- Request -> host -> current account/session -> connections, like consent.
  select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_actor:=fmat.calendar_actor(p_credential);
  perform fmat.require_request(v_actor,v_request.id);
  select * into strict v_host from fmat.hosts where id=v_request.host_id for update;
  perform 1 from auth.users where id=v_host.id for share;
  if not exists(select 1 from auth.users where id=v_host.id and deleted_at is null and email_confirmed_at is not null and (banned_until is null or banned_until<=clock_timestamp())) then raise exception 'NOT_FOUND'; end if;
  if v_request.status in ('booked','declined','withdrawn','expired','booking') or v_request.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND'; end if;
  if (p_input->>'revision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
  if not fmat.host_ready(v_host) then raise exception 'RECONNECT_REQUIRED'; end if;
  select * into v_host_connection from fmat.calendar_connections where principal_kind='host' and principal_id=v_host.id and revoked_at is null for update;
  if v_host_connection.id is null then raise exception 'RECONNECT_REQUIRED'; end if;
  if v_request.availability_mode='calendar' then
    select * into v_guest_connection from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null and guest_authority_key=v_request.token_hash for update;
    if v_guest_connection.id is null or cardinality(v_guest_connection.selected_calendar_ids)=0 then raise exception 'RECONNECT_REQUIRED'; end if;
  end if;
  -- Wall-clock expiry must be checked again after any connection lock wait.
  if v_request.expires_at<=clock_timestamp() or (p_credential->>'kind'='guest' and v_request.token_expires_at<=clock_timestamp()) then raise exception 'NOT_FOUND'; end if;
  if p_credential->>'kind'='host' and ((p_credential->>'expiresAt')::timestamptz<=clock_timestamp() or exists(select 1 from auth.sessions where id=(p_credential->>'sessionId')::uuid and not_after<=clock_timestamp())) then raise exception 'UNAUTHORIZED'; end if;
  -- Include confirmed local writes even if the provider has not returned them
  -- yet. Booking dispatch still requires its own fresh check and reservation.
  select coalesce(jsonb_agg(jsonb_build_object('start',a.starts_at,'end',a.ends_at) order by a.starts_at,a.ends_at,a.id),'[]'::jsonb) into v_bookings
    from fmat.booking_attempts a where a.host_id=v_host.id and a.request_id<>v_request.id and a.phase='confirmed'
    and (a.calendar_id=any(v_host.conflict_calendar_ids) or a.calendar_id=v_host.booking_calendar_id)
    and exists(select 1 from jsonb_array_elements(coalesce(v_request.details->'windows','[]')) w
      where a.starts_at<(w->>'end')::timestamptz+make_interval(mins=>(v_host.rules->>'bufferMinutes')::integer)
      and a.ends_at>(w->>'start')::timestamptz-make_interval(mins=>(v_host.rules->>'bufferMinutes')::integer));
  -- Neighbor context also needs confirmed writes outside the requested slot.
  -- A bounded read never establishes the host's location beyond its coverage.
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'calendarId',a.calendar_id,'eventId',a.event_id,
      'version',a.payload_fingerprint,'interval',jsonb_build_object('start',a.starts_at,'end',a.ends_at),
      'location',a.payload->>'location') order by a.starts_at,a.ends_at,a.id),'[]'::jsonb) into v_commitments
    from (select b.* from fmat.booking_attempts b where b.host_id=v_host.id and b.request_id<>v_request.id and b.phase='confirmed'
      and (b.calendar_id=any(v_host.conflict_calendar_ids) or b.calendar_id=v_host.booking_calendar_id)
      and exists(select 1 from jsonb_array_elements(coalesce(v_request.details->'windows','[]')) w
        where b.starts_at<(w->>'end')::timestamptz+interval '31 days'
        and b.ends_at>(w->>'start')::timestamptz-interval '31 days') limit 10001) a;
  if jsonb_array_length(v_commitments)>10000 then raise exception 'PROVIDER_UNAVAILABLE'; end if;
  v_basis:=encode(sha256(convert_to(jsonb_build_object('revision',v_request.revision,'details',v_request.details,
    'rulesVersion',v_host.rules_version,'rules',v_host.rules,'hostConnection',v_host_connection.id,'hostGeneration',v_host_connection.generation,
    'hostCalendars',v_host.conflict_calendar_ids,'bookingCalendar',v_host.booking_calendar_id,'mode',v_request.availability_mode,
    'guestConnection',v_guest_connection.id,'guestGeneration',v_guest_connection.generation,'guestCalendars',v_guest_connection.selected_calendar_ids,
    'localBookings',v_bookings,'localCommitments',v_commitments,'privateSchedulingContext',v_request.private_scheduling_context)::text,'UTF8')),'hex');
  -- Manual travel decisions bind content, not the revision advanced by their
  -- own confirmation. The ordinary basis still fences every async mutation.
  v_travel_basis:=encode(sha256(convert_to(jsonb_build_object('details',v_request.details,
    'rulesVersion',v_host.rules_version,'rules',v_host.rules,'hostConnection',v_host_connection.id,'hostGeneration',v_host_connection.generation,
    'hostCalendars',v_host.conflict_calendar_ids,'bookingCalendar',v_host.booking_calendar_id,'mode',v_request.availability_mode,
    'guestConnection',v_guest_connection.id,'guestGeneration',v_guest_connection.generation,'guestCalendars',v_guest_connection.selected_calendar_ids,
    'localBookings',v_bookings,'localCommitments',v_commitments,'privateSchedulingContext',v_request.private_scheduling_context)::text,'UTF8')),'hex');
  if p_operation='current_context' then return jsonb_build_object('travelBasis',v_travel_basis);end if;
  if p_operation='start' then
    v_check:=(p_input->>'checkId')::uuid;
    if v_check is null then raise exception 'INVALID_INPUT'; end if;
    update fmat.requests set availability_check_id=v_check,availability_check_started_at=clock_timestamp() where id=v_request.id;
    return jsonb_build_object('preferenceDecisions',(select coalesce(jsonb_agg(p.value||jsonb_build_object('id',p.id,'contextFingerprint',p.context_fingerprint)),'[]'::jsonb) from fmat.preference_decisions p where p.request_id=v_request.id and p.context_basis=v_travel_basis and p.revoked_at is null),'travelBasis',v_travel_basis,'allowances',(select coalesce(jsonb_agg(a.value||jsonb_build_object('id',a.id,'contextFingerprint',a.context_fingerprint)),'[]'::jsonb) from fmat.travel_allowances a where a.request_id=v_request.id and a.travel_basis=v_travel_basis and a.revoked_at is null),'checkId',v_check,'basis',v_basis,'revision',v_request.revision,'rulesVersion',v_host.rules_version,
      'details',v_request.details,'rules',v_host.rules,'localBookings',v_bookings,'localCommitments',v_commitments,'mode',v_request.availability_mode,
      'host',jsonb_build_object('principalId',v_host.id,'providerSubject',v_host_connection.provider_subject,'encryptedCredential',v_host_connection.encrypted_credential,'calendarIds',v_host.conflict_calendar_ids),
      'guest',case when v_request.availability_mode='calendar' then jsonb_build_object('principalId',v_request.id,'providerSubject',v_guest_connection.provider_subject,'encryptedCredential',v_guest_connection.encrypted_credential,'calendarIds',v_guest_connection.selected_calendar_ids) else null end);
  end if;
  if p_operation='evidence_read' then
    select * into v_evaluation from fmat.candidate_evaluations where id=(p_input->>'evaluationId')::uuid and request_id=v_request.id;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_evaluation.basis is distinct from v_basis or v_evaluation.check_id is distinct from v_request.availability_check_id
      or v_evaluation.request_revision<>v_request.revision or v_evaluation.rules_version<>v_host.rules_version
      or v_request.availability_check_started_at is null or v_request.availability_check_started_at<clock_timestamp()-interval '5 minutes'
      or v_evaluation.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT'; end if;
    return jsonb_build_object('evaluationId',v_evaluation.id,'requestId',v_request.id,'revision',v_request.revision,'rulesVersion',v_host.rules_version,
      'status',v_evaluation.status,'expiresAt',v_evaluation.expires_at,'complete',false);
  end if;
  if (p_input->>'checkId')::uuid is distinct from v_request.availability_check_id or p_input->>'basis' is distinct from v_basis
    or v_request.availability_check_started_at is null or v_request.availability_check_started_at<clock_timestamp()-interval '5 minutes' then raise exception 'REVISION_CONFLICT'; end if;
  if p_operation='check' then return jsonb_build_object('current',true);
  elsif p_operation='evidence_save' then
    v_candidate:=p_input->'candidate';v_evidence:=p_input->'evidence';v_now:=clock_timestamp();
    if jsonb_typeof(v_candidate) is distinct from 'object' or jsonb_typeof(v_evidence) is distinct from 'object'
      or v_evidence->'candidate' is distinct from v_candidate or v_evidence->'complete' is distinct from 'false'::jsonb
      or not ((v_evidence->>'preferences'='pending') is true or (jsonb_typeof(v_evidence->'preferences')='object') is true) or octet_length(v_evidence::text)>65536
      or exists(select 1 from jsonb_object_keys(v_candidate) k where k not in ('start','end'))
      or exists(select 1 from jsonb_object_keys(v_evidence) k where k not in ('candidate','interval','contextFingerprint','travel','travelContext','preferences','complete'))
      or coalesce(v_evidence->>'interval','') not in ('fits','conflict','clarification')
      or coalesce(v_candidate->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(v_candidate->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (v_candidate->>'start')::timestamptz<=v_now or (v_candidate->>'end')::timestamptz<=(v_candidate->>'start')::timestamptz
      then raise exception 'INVALID_INPUT'; end if;
    -- Serialize precise instants as JSON strings; never round the application's
    -- nanosecond comparison into a PostgreSQL microsecond feasibility claim.
    if not(v_evidence ?& array['contextFingerprint','travel']) or (v_evidence->'travel'<>'null'::jsonb and
      (jsonb_typeof(v_evidence->'travel') is distinct from 'object' or coalesce(v_evidence->'travel'->>'status','') not in ('fits','conflict','clarification')
       or jsonb_typeof(v_evidence->'travel'->'legs') is distinct from 'array' or jsonb_array_length(v_evidence->'travel'->'legs')<>2
       or coalesce(v_evidence->>'contextFingerprint','') !~ '^[a-f0-9]{64}$')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(v_evidence->'preferences')='object' then
      if coalesce(v_evidence->'preferences'->>'contextFingerprint','') !~ '^[a-f0-9]{64}$'
       or coalesce(v_evidence->'preferences'->>'status','') not in ('satisfied','requires_confirmation')
       or jsonb_typeof(v_evidence->'preferences'->'checks') is distinct from 'array' or jsonb_array_length(v_evidence->'preferences'->'checks')<>3
       or (select count(distinct c->>'key') from jsonb_array_elements(v_evidence->'preferences'->'checks') c where c->>'key' in ('meeting_mode','location','additional'))<>3
       or exists(select 1 from jsonb_array_elements(v_evidence->'preferences'->'checks') c where coalesce(c->>'status','') not in ('satisfied','unresolved','exception'))
       or (v_evidence->'preferences'->>'status'='requires_confirmation') is distinct from exists(select 1 from jsonb_array_elements(v_evidence->'preferences'->'checks') c where c->>'status'='unresolved') then raise exception 'INVALID_INPUT';end if;
    end if;
    if v_evidence->>'interval'<>'fits' and v_evidence->'travel'<>'null'::jsonb then raise exception 'INVALID_INPUT'; end if;
    if v_request.host_availability_failed or (v_request.availability_mode='calendar' and v_request.availability_failed) then raise exception 'RECONNECT_REQUIRED'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'REVISION_CONFLICT'; end if;
    v_candidate_key:=encode(sha256(convert_to(v_candidate::text,'UTF8')),'hex');
    select * into v_evaluation from fmat.candidate_evaluations where request_id=v_request.id and check_id=v_request.availability_check_id and candidate_key=v_candidate_key;
    if found then
      if v_evaluation.evidence is distinct from v_evidence or v_evaluation.basis is distinct from v_basis then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if v_evaluation.expires_at<=v_now then raise exception 'REVISION_CONFLICT'; end if;
    else
      v_status:=case when v_evidence->>'interval'='conflict' or v_evidence->'travel'->>'status'='conflict' then 'conflict'
        when v_evidence->>'interval'='fits' and v_evidence->'travel'->>'status'='fits' and v_evidence->'preferences'->>'status'='satisfied' then 'checks_passed' else 'clarification' end;
      v_expires:=least(v_request.availability_check_started_at+interval '5 minutes',(v_candidate->>'start')::timestamptz);
      if v_expires<=v_now then raise exception 'REVISION_CONFLICT'; end if;
      v_private_context:=jsonb_build_object('travelBasis',v_travel_basis,'details',v_request.details,'rules',v_host.rules,'privateSchedulingContext',v_request.private_scheduling_context,
        'hostConnection',v_host_connection.id,'hostGeneration',v_host_connection.generation,'hostCalendars',v_host.conflict_calendar_ids,'bookingCalendar',v_host.booking_calendar_id,
        'availabilityMode',v_request.availability_mode,'guestConnection',v_guest_connection.id,'guestGeneration',v_guest_connection.generation,'guestCalendars',v_guest_connection.selected_calendar_ids,
        'localBookingsFingerprint',encode(sha256(convert_to(jsonb_build_object('busy',v_bookings,'commitments',v_commitments)::text,'UTF8')),'hex'));
      insert into fmat.candidate_evaluations(request_id,check_id,request_revision,rules_version,basis,candidate_key,candidate,status,evidence,private_context,evaluated_at,expires_at)
        values(v_request.id,v_request.availability_check_id,v_request.revision,v_host.rules_version,v_basis,v_candidate_key,v_candidate,v_status,v_evidence,v_private_context,v_now,v_expires)
        returning * into v_evaluation;
    end if;
    return jsonb_build_object('evaluationId',v_evaluation.id,'requestId',v_request.id,'revision',v_request.revision,'rulesVersion',v_host.rules_version,
      'status',v_evaluation.status,'expiresAt',v_evaluation.expires_at,'complete',false);
  elsif p_operation='refresh' then
    if p_input->>'party'='host' then v_connection:=v_host_connection;
    elsif p_input->>'party'='guest' then v_connection:=v_guest_connection;
    else raise exception 'INVALID_INPUT'; end if;
    if v_connection.id is null or p_input->>'previousCredential' is distinct from v_connection.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
    if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=v_connection.id;
    return jsonb_build_object('refreshed',true);
  elsif p_operation='failure' then
    if p_input->>'party' not in ('host','guest') or p_input->>'party' is null or (p_input->>'party'='guest' and v_request.availability_mode<>'calendar') then raise exception 'INVALID_INPUT'; end if;
    update fmat.requests set host_availability_failed=host_availability_failed or p_input->>'party'='host',
      availability_failed=availability_failed or p_input->>'party'='guest',revision=revision+1,
      candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
      status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,updated_at=clock_timestamp(),availability_check_id=null,availability_check_started_at=null
      where id=v_request.id returning * into v_request;
    insert into fmat.request_history(request_id,revision,operation,actor) values(v_request.id,v_request.revision,'availability_read_failed',v_actor-'tokenHash');
    perform fmat.audit('availability_read_failed',v_actor,v_request.id::text);
    return jsonb_build_object('paused',true);
  elsif p_operation='success' then
    update fmat.requests set host_availability_failed=false,availability_failed=false where id=v_request.id;
    return jsonb_build_object('checked',true,'revision',v_request.revision,'checkedAt',clock_timestamp());
  end if;
  raise exception 'FORBIDDEN';
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_preference_decision (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; a fmat.preference_decisions; e fmat.candidate_evaluations; actor jsonb; current_basis text; leg jsonb; v jsonb; result_id uuid; next_revision integer;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 -- Reuse the evaluator's authority, account, connection and locking checks.
 current_basis:=public.fmat_availability_evaluation('current_context',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision))->>'travelBasis';
 if p_operation='confirm' then
  select * into a from fmat.preference_decisions where request_id=r.id and idempotency_key=(p_input->>'idempotencyKey')::uuid;
  if found then
   if a.input<>p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if a.revoked_at is not null or a.context_basis<>current_basis or a.result_revision<>r.revision then raise exception 'REVISION_CONFLICT';end if;
   return jsonb_build_object('requestId',r.id,'revision',a.result_revision,'decisionId',a.id,'revoked',false,'complete',false);
  end if;
 end if;
 if p_operation='confirm' then
  perform public.fmat_availability_evaluation('evidence_read',p_credential,p_input);
  select * into strict e from fmat.candidate_evaluations where id=(p_input->>'evaluationId')::uuid and request_id=r.id;
  if p_input->'confirmed' is distinct from 'true'::jsonb or p_input->>'idempotencyKey' is null
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','evaluationId','confirmed','idempotencyKey','choice')) then raise exception 'INVALID_INPUT';end if;
  v:=p_input->'choice';
  if jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'key','') not in ('meeting_mode','location','additional')
   or v->>'classification' is distinct from 'preference' or coalesce(v->>'decision','') not in ('satisfied','exception')
   or (v->>'key'<>'additional' and v->>'decision'<>'exception')
   or length(trim(coalesce(v->>'reason',''))) not between 1 and 2000 or octet_length(v::text)>8192
   or exists(select 1 from jsonb_object_keys(v) k where k not in ('key','classification','decision','reason')) then raise exception 'INVALID_INPUT';end if;
  -- A preference decision never resolves hard interval or travel failures.
  if e.evidence->>'interval' is distinct from 'fits' or e.evidence->'travel'->>'status' is distinct from 'fits'
   or jsonb_typeof(e.evidence->'preferences') is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
  select c into leg from jsonb_array_elements(e.evidence->'preferences'->'checks') c where c->>'key'=v->>'key';
  if leg->>'status' is distinct from 'unresolved' then raise exception 'INVALID_INPUT';end if;
  if (select count(*) from fmat.preference_decisions where request_id=r.id)>=200 then raise exception 'CONVERSATION_LIMIT';end if;
  if (select count(*) from fmat.preference_decisions where request_id=r.id and context_basis=current_basis and revoked_at is null)>=30 then raise exception 'CONVERSATION_LIMIT';end if;
  next_revision:=r.revision+1;
  update fmat.preference_decisions set revoked_at=clock_timestamp() where request_id=r.id and context_fingerprint=e.evidence->'preferences'->>'contextFingerprint' and preference_key=v->>'key' and revoked_at is null;
  insert into fmat.preference_decisions(request_id,evaluation_id,host_id,session_id,idempotency_key,input,result_revision,context_basis,context_fingerprint,preference_key,value)
   values(r.id,e.id,r.host_id,(p_credential->>'sessionId')::uuid,(p_input->>'idempotencyKey')::uuid,p_input,next_revision,current_basis,e.evidence->'preferences'->>'contextFingerprint',v->>'key',v) returning id into result_id;
 elsif p_operation='revoke' then
  if p_input->>'idempotencyKey' is null or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','decisionId','idempotencyKey')) then raise exception 'INVALID_INPUT';end if;
  select * into a from fmat.preference_decisions where request_id=r.id and id=(p_input->>'decisionId')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  if a.revoke_key=(p_input->>'idempotencyKey')::uuid then
   if a.revoke_input<>p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if a.revoke_revision<>r.revision then raise exception 'REVISION_CONFLICT';end if;
   return jsonb_build_object('requestId',r.id,'revision',a.revoke_revision,'decisionId',a.id,'revoked',true,'complete',false);
  end if;
  if (p_input->>'revision')::integer is distinct from r.revision or a.revoked_at is not null then raise exception 'REVISION_CONFLICT';end if;
  next_revision:=r.revision+1;result_id:=a.id;
  update fmat.preference_decisions set revoked_at=clock_timestamp(),revoke_key=(p_input->>'idempotencyKey')::uuid,revoke_input=p_input,revoke_revision=next_revision where id=a.id;
 else raise exception 'FORBIDDEN';end if;
 update fmat.requests set revision=next_revision,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
  availability_check_id=null,availability_check_started_at=null,status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,updated_at=clock_timestamp() where id=r.id;
 insert into fmat.request_history(request_id,revision,operation,actor) values(r.id,next_revision,'preference_decision_'||p_operation,actor);
 perform fmat.audit('preference_decision_'||p_operation,actor,r.id::text);
 return jsonb_build_object('requestId',r.id,'revision',next_revision,'decisionId',result_id,'revoked',p_operation='revoke','complete',false);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_preference_decision"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."candidate_evaluations"
  ADD CONSTRAINT "candidate_evaluations_evidence_check"
    CHECK
    (((jsonb_typeof(evidence) = 'object'::text) AND (((evidence -> 'complete'::text) = 'false'::jsonb) IS TRUE) AND ((((evidence ->> 'preferences'::text) = 'pending'::text) OR
    (jsonb_typeof((evidence -> 'preferences'::text)) = 'object'::text)) IS TRUE) AND (octet_length((evidence)::text) <= 65536)));

ALTER TABLE "fmat"."preference_decisions"
  ADD CONSTRAINT "preference_decisions_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES fmat.candidate_evaluations(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."preference_decisions"
  ADD CONSTRAINT "preference_decisions_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id);

ALTER TABLE "fmat"."preference_decisions"
  ADD CONSTRAINT "preference_decisions_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id) ON DELETE CASCADE;

CREATE INDEX preference_decisions_evaluation_idx ON fmat.preference_decisions USING btree (evaluation_id);

CREATE INDEX preference_decisions_host_idx ON fmat.preference_decisions USING btree (host_id);

CREATE INDEX preference_decisions_request_context_idx ON fmat.preference_decisions USING btree (request_id, context_basis)
  WHERE (revoked_at IS NULL);

CREATE TRIGGER preference_decisions_immutable
  BEFORE UPDATE ON fmat.preference_decisions
  FOR EACH ROW
  EXECUTE FUNCTION fmat.protect_preference_decision();

REVOKE ALL ON FUNCTION "public"."fmat_preference_decision"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_preference_decision"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_preference_decision"(text, jsonb, jsonb) TO "service_role";
