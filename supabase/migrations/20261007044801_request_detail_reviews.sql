SET local check_function_bodies = off;

CREATE TABLE "fmat"."request_detail_reviews" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"       uuid                     NOT NULL,
  "authority_key"    text                     NOT NULL,
  "base_revision"    integer                  NOT NULL,
  "input"            jsonb                    NOT NULL,
  "proposed_details" jsonb                    NOT NULL,
  "idempotency_key"  text                     NOT NULL,
  "status"           text                     NOT NULL DEFAULT 'pending'::text,
  "decision_key"     uuid,
  "result_revision"  integer,
  "created_at"       timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "decided_at"       timestamp with time zone,
  CONSTRAINT "request_detail_reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "request_detail_reviews_request_id_authority_key_idempotency_key" UNIQUE (request_id, authority_key, idempotency_key),
  CONSTRAINT "request_detail_reviews_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'dismissed'::text, 'superseded'::text])))
);

ALTER TABLE "fmat"."request_detail_reviews"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.propose_request_details (
  p_actor jsonb,
  p_input jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests; v_review fmat.request_detail_reviews; v_details jsonb; v_key text;
begin
  if p_actor->>'kind' is distinct from 'guest' then raise exception 'FORBIDDEN'; end if;
  v_request:=fmat.require_request(p_actor,(p_actor->>'requestId')::uuid);
  if v_request.status in ('booking','booked','withdrawn','declined','expired') or v_request.expires_at<=clock_timestamp() or v_request.token_expires_at<=clock_timestamp() then raise exception 'REQUEST_CLOSED'; end if;
  if jsonb_typeof(p_input) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('patch','expectedRevision','clarifications','idempotencyKey'))
    or jsonb_typeof(p_input->'patch') is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_input->'patch') k where k not in ('requesterName','requesterEmail','purpose','durationMinutes','timezone','windows','mode','location'))
    or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'clarifications') is distinct from 'array' or jsonb_array_length(p_input->'clarifications')>10
    or exists(select 1 from jsonb_array_elements(p_input->'clarifications') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 500)
    or (p_input->'patch'='{}'::jsonb and p_input->'clarifications'='[]'::jsonb)
    or length(coalesce(p_input->>'idempotencyKey','')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from jsonb_each(p_input->'patch') e where
    (key in ('requesterName','requesterEmail','purpose','timezone','mode','location') and jsonb_typeof(value)<>'string')
    or (key='durationMinutes' and value<>'null'::jsonb and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$')))
    then raise exception 'INVALID_INPUT'; end if;
  v_key:=p_input->>'idempotencyKey';
  select * into v_review from fmat.request_detail_reviews where request_id=v_request.id and authority_key=p_actor->>'tokenHash' and idempotency_key=v_key;
  if found then
    if v_review.input is distinct from p_input-'idempotencyKey' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('review',fmat.request_detail_review_view(v_review));
  end if;
  if (p_input->>'expectedRevision')::integer<>v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
  v_details:=fmat.normalize_details(v_request.details||(p_input->'patch'));
  update fmat.request_detail_reviews set status='superseded',decided_at=clock_timestamp() where request_id=v_request.id and status='pending';
  insert into fmat.request_detail_reviews(request_id,authority_key,base_revision,input,proposed_details,idempotency_key)
    values(v_request.id,p_actor->>'tokenHash',v_request.revision,p_input-'idempotencyKey',v_details,v_key) returning * into v_review;
  perform fmat.audit('request_details_proposed',p_actor,v_request.id::text);
  return jsonb_build_object('review',fmat.request_detail_review_view(v_review));
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.request_detail_review_view (
  p_review fmat.request_detail_reviews
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('id',p_review.id,'baseRevision',p_review.base_revision,'patch',p_review.input->'patch',
    'details',p_review.proposed_details,'clarifications',p_review.input->'clarifications','status',p_review.status,
    'resultRevision',p_review.result_revision);
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_tool (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_operation       text,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_access jsonb; v_actor jsonb; v_input jsonb; v_result jsonb; v_request_id uuid;
begin
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  v_actor:=v_access->'actor'; v_request_id:=(v_access->>'requestId')::uuid;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  case p_operation
  when 'setup_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.host_setup_operation('read',v_actor,'{}','assistant');
  when 'setup_analysis_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.calendar_scan_model_view((v_actor->>'id')::uuid);
  when 'setup_draft' then
    if v_access->>'audience'<>'host_setup' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_setup_operation('draft',v_actor,p_input,'assistant');
  when 'request_read' then
    if v_request_id is null then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    -- Host identity does not make a shared conversation private. Project for
    -- the audience at the database boundary before any model sees the result.
    v_result:=fmat.request_view(v_request_id,case when v_access->>'audience'='request_shared' then '{"kind":"guest"}'::jsonb else v_actor end);
    if v_actor->>'kind'='guest' then
      v_result:=v_result||jsonb_build_object('review',(select fmat.request_detail_review_view(r) from fmat.request_detail_reviews r
        where r.request_id=v_request_id and r.authority_key=v_actor->>'tokenHash' order by r.created_at desc,r.id desc limit 1));
    end if;
    return v_result;
  when 'private_note_save' then
    if v_access->>'audience'<>'host_private' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('text','expectedRevision','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(p_input->'text') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  when 'details_propose' then
    if v_access->>'audience'<>'request_shared' or v_actor->>'kind'<>'guest' then raise exception 'FORBIDDEN'; end if;
    if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
    return fmat.propose_request_details(v_actor,p_input);
  else
    -- Approval, agreement, confirmed settings, travel exceptions and worker or
    -- provider outcomes require separate authored application operations.
    raise exception 'FORBIDDEN';
  end case;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number'
    or (p_input->>'expectedRevision') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  v_input:=p_input||jsonb_build_object('requestId',v_request_id);
  v_result:=public.fmat_command(p_operation,v_actor,v_input);
  if v_access->>'audience'='request_shared' then
    -- Also scrub cached idempotency results; these may have been produced by
    -- the host's same command from a private application surface.
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_result from jsonb_each(v_result)
      where key=any(array['id','hostId','revision','status','details','candidates','proposal','requesterAgreed','hostApproved','contactVerified','calendarConnected','event','messages','nextAction','receipt']);
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_request_detail_review (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_request fmat.requests; v_review fmat.request_detail_reviews; v_result jsonb; v_decision uuid;
begin
  if p_credential->>'kind' is distinct from 'guest' then raise exception 'FORBIDDEN'; end if;
  -- Locks the request and current host before deriving authority, matching
  -- Calendar and conversation operations. Recheck wall-clock expiry here too.
  v_actor:=fmat.calendar_actor(p_credential);
  select * into strict v_request from fmat.requests where id=(v_actor->>'requestId')::uuid;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  if p_operation='read' then
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    select * into v_review from fmat.request_detail_reviews where request_id=v_request.id and authority_key=p_credential->>'tokenHash' order by created_at desc,id desc limit 1;
  elsif p_operation in ('apply','dismiss') then
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('reviewId','expectedRevision','confirmed','idempotencyKey'))
      or p_input->'confirmed' is distinct from 'true'::jsonb
      or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^[0-9]+$'
      or p_input->>'reviewId' is null or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT'; end if;
    v_decision:=(p_input->>'idempotencyKey')::uuid;
    select * into v_review from fmat.request_detail_reviews where id=(p_input->>'reviewId')::uuid and request_id=v_request.id and authority_key=p_credential->>'tokenHash' for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if (p_input->>'expectedRevision')::integer<>v_review.base_revision then raise exception 'REVISION_CONFLICT'; end if;
    if v_review.decision_key is not null then
      if v_review.decision_key<>v_decision or v_review.status<>(case when p_operation='apply' then 'applied' else 'dismissed' end) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    else
      if v_review.status<>'pending' or (p_operation='apply' and v_request.revision<>v_review.base_revision) then raise exception 'REVISION_CONFLICT'; end if;
      if p_operation='apply' then
        if v_review.input->'clarifications'<>'[]'::jsonb or v_review.input->'patch'='{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
        -- Reuse domain invalidation, verified-contact reset and audit/history.
        -- This does not replace a failed Calendar with manual availability.
        v_result:=public.fmat_command('details_update',v_actor,jsonb_build_object('requestId',v_request.id,'expectedRevision',v_review.base_revision,
          'details',v_review.proposed_details,'idempotencyKey','review:'||v_review.id::text));
        select * into strict v_request from fmat.requests where id=v_request.id;
      end if;
      update fmat.request_detail_reviews set status=case when p_operation='apply' then 'applied' else 'dismissed' end,
        decision_key=v_decision,result_revision=v_request.revision,decided_at=clock_timestamp() where id=v_review.id returning * into v_review;
      perform fmat.audit('request_details_'||p_operation,v_actor,v_request.id::text);
    end if;
  else raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('revision',v_request.revision,'details',v_request.details,
    'review',case when v_review.id is null then null else fmat.request_detail_review_view(v_review) end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_request_detail_review"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."request_detail_reviews"
  ADD CONSTRAINT "request_detail_reviews_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX request_detail_reviews_pending_idx ON fmat.request_detail_reviews USING btree (request_id)
  WHERE (status = 'pending'::text);

REVOKE ALL ON FUNCTION "fmat"."propose_request_details"(jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."request_detail_review_view"(fmat.request_detail_reviews) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_request_detail_review"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_request_detail_review"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_request_detail_review"(text, jsonb, jsonb) TO "service_role";
