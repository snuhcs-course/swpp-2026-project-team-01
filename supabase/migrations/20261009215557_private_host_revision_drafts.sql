SET local check_function_bodies = off;

CREATE TABLE "fmat"."host_revision_drafts" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"       uuid                     NOT NULL,
  "host_id"          uuid                     NOT NULL,
  "base_revision"    integer                  NOT NULL,
  "input"            jsonb                    NOT NULL,
  "before_details"   jsonb                    NOT NULL,
  "proposed_details" jsonb                    NOT NULL,
  "idempotency_key"  text                     NOT NULL,
  "status"           text                     NOT NULL DEFAULT 'pending'::text,
  "decision_key"     uuid,
  "result_revision"  integer,
  "created_at"       timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "decided_at"       timestamp with time zone,
  CONSTRAINT "host_revision_drafts_base_revision_check" CHECK ((base_revision > 0)),
  CONSTRAINT "host_revision_drafts_pkey" PRIMARY KEY (id),
  CONSTRAINT "host_revision_drafts_request_id_host_id_idempotency_key_key" UNIQUE (request_id, host_id, idempotency_key),
  CONSTRAINT "host_revision_drafts_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'dismissed'::text, 'superseded'::text])))
);

ALTER TABLE "fmat"."host_revision_drafts"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.host_revision_view (
  p_draft fmat.host_revision_drafts
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
 select jsonb_build_object('id',p_draft.id,'baseRevision',p_draft.base_revision,'patch',p_draft.input->'patch',
 'details',p_draft.proposed_details,'clarifications',p_draft.input->'clarifications','status',p_draft.status,'resultRevision',p_draft.result_revision);
$function$;

CREATE OR REPLACE FUNCTION fmat.propose_host_revision (
  p_actor   jsonb,
  p_request uuid,
  p_input   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests; draft fmat.host_revision_drafts; details jsonb;
begin
 if p_actor->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 r:=fmat.require_request(p_actor,p_request);
 if r.status in ('booking','booked','withdrawn','declined','expired') or r.expires_at<=clock_timestamp()
  or r.token_expires_at<=clock_timestamp() or r.token_revoked_at is not null then raise exception 'REQUEST_CLOSED';end if;
 if jsonb_typeof(p_input) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('patch','expectedRevision','clarifications','idempotencyKey'))
  or jsonb_typeof(p_input->'patch') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_input->'patch') k where k not in ('purpose','durationMinutes','timezone','windows','mode','location'))
  or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^[0-9]+$'
  or jsonb_typeof(p_input->'clarifications') is distinct from 'array' or jsonb_array_length(p_input->'clarifications')>10
  or exists(select 1 from jsonb_array_elements(p_input->'clarifications') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 500)
  or (p_input->'patch'='{}'::jsonb and p_input->'clarifications'='[]'::jsonb)
  or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string' or length(p_input->>'idempotencyKey') not between 1 and 200
  then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from jsonb_each(p_input->'patch') e where
  (key in ('purpose','timezone','mode','location') and jsonb_typeof(value)<>'string')
  or (key='durationMinutes' and value<>'null'::jsonb and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$')))
  then raise exception 'INVALID_INPUT';end if;
 select * into draft from fmat.host_revision_drafts where request_id=r.id and host_id=r.host_id and idempotency_key=p_input->>'idempotencyKey';
 if found then
  if draft.input is distinct from p_input-'idempotencyKey' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('revisionDraft',fmat.host_revision_view(draft));
 end if;
 if (p_input->>'expectedRevision')::integer<>r.revision then raise exception 'REVISION_CONFLICT';end if;
 details:=fmat.normalize_details(r.details||(p_input->'patch'));
 perform fmat.validate_request_review_windows(details);
 update fmat.host_revision_drafts set status='superseded',decided_at=clock_timestamp() where request_id=r.id and status='pending';
 insert into fmat.host_revision_drafts(request_id,host_id,base_revision,input,before_details,proposed_details,idempotency_key)
 values(r.id,r.host_id,r.revision,p_input-'idempotencyKey',r.details,details,p_input->>'idempotencyKey') returning * into draft;
 perform fmat.audit('host_revision_proposed',p_actor,r.id::text);
 return jsonb_build_object('revisionDraft',fmat.host_revision_view(draft));
end;
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
  when 'context_read' then
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
    return jsonb_build_object('audience',v_access->'audience','requestId',v_access->'requestId','readOnly',v_access->'readOnly');
  when 'host_requests_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_request_model_page((v_actor->>'id')::uuid,p_input);
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
    if v_access->>'audience'='host_private' and v_actor->>'kind'='host' then
      v_result:=v_result||jsonb_build_object('revisionDraft',(select fmat.host_revision_view(d) from fmat.host_revision_drafts d
        where d.request_id=v_request_id and d.host_id=(v_actor->>'id')::uuid order by d.created_at desc,d.id desc limit 1));
    end if;
    return v_result;
  when 'host_revision_propose' then
    if v_access->>'audience'<>'host_private' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN';end if;
    if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
    return fmat.propose_host_revision(v_actor,v_request_id,p_input);
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

ALTER TABLE "fmat"."host_revision_drafts"
  ADD CONSTRAINT "host_revision_drafts_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id);

ALTER TABLE "fmat"."host_revision_drafts"
  ADD CONSTRAINT "host_revision_drafts_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id) ON DELETE CASCADE;

CREATE INDEX host_revision_drafts_host_idx ON fmat.host_revision_drafts USING btree (host_id);

CREATE UNIQUE INDEX host_revision_drafts_pending_idx ON fmat.host_revision_drafts USING btree (request_id)
  WHERE (status = 'pending'::text);

REVOKE ALL ON FUNCTION "fmat"."host_revision_view"(fmat.host_revision_drafts) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."propose_host_revision"(jsonb, uuid, jsonb) FROM PUBLIC;
