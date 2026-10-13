SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.decide_host_revision (
  p_actor     jsonb,
  p_request   uuid,
  p_operation text,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r fmat.requests; draft fmat.host_revision_drafts; decision uuid;
begin
 if p_actor->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 if p_operation is null or p_operation not in ('apply','dismiss') or jsonb_typeof(p_input) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('reviewId','expectedRevision','confirmed','idempotencyKey'))
  or p_input->'confirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^[0-9]+$'
  or p_input->>'reviewId' is null or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT';end if;
 r:=fmat.require_request(p_actor,p_request);
 decision:=(p_input->>'idempotencyKey')::uuid;
 select * into draft from fmat.host_revision_drafts where id=(p_input->>'reviewId')::uuid and request_id=r.id and host_id=r.host_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if (p_input->>'expectedRevision')::integer<>draft.base_revision then raise exception 'REVISION_CONFLICT';end if;
 if draft.decision_key is not null then
  if draft.decision_key<>decision or draft.status<>(case when p_operation='apply' then 'applied' else 'dismissed' end) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 else
  if draft.status<>'pending' then raise exception 'REVISION_CONFLICT';end if;
  if r.status in ('booking','booked','withdrawn','declined','expired') or r.expires_at<=clock_timestamp()
   or r.token_expires_at<=clock_timestamp() or r.token_revoked_at is not null then raise exception 'REQUEST_CLOSED';end if;
  if p_operation='apply' then
   if r.revision<>draft.base_revision or r.details is distinct from draft.before_details then raise exception 'REVISION_CONFLICT';end if;
   if draft.input->'clarifications'<>'[]'::jsonb or draft.input->'patch'='{}'::jsonb then raise exception 'INVALID_INPUT';end if;
   perform fmat.validate_request_review_windows(draft.proposed_details);
   -- Reuse the domain's invalidation and actor/version audit. This changes
   -- shared constraints, never publishes unchecked availability or agreement.
   perform public.fmat_command('details_update',p_actor,jsonb_build_object('requestId',r.id,'expectedRevision',r.revision,
    'details',draft.proposed_details,'idempotencyKey','host-review:'||draft.id::text));
   select * into strict r from fmat.requests where id=r.id;
  end if;
  update fmat.host_revision_drafts set status=case when p_operation='apply' then 'applied' else 'dismissed' end,
   decision_key=decision,result_revision=r.revision,decided_at=clock_timestamp() where id=draft.id returning * into draft;
  perform fmat.audit('host_revision_'||p_operation,p_actor,r.id::text);
 end if;
 return jsonb_build_object('revision',r.revision,'details',r.details,'review',fmat.host_revision_view(draft));
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_host_revision_review (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requests; actor jsonb; draft fmat.host_revision_drafts; result jsonb;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 if p_operation is null or p_operation not in ('read','apply','dismiss') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
  select * into draft from fmat.host_revision_drafts where request_id=r.id and host_id=r.host_id order by created_at desc,id desc limit 1;
  result:=jsonb_build_object('revision',r.revision,'details',r.details,'review',case when draft.id is null then null else fmat.host_revision_view(draft) end);
 else
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','input')) or not(p_input?'input') then raise exception 'INVALID_INPUT';end if;
  result:=fmat.decide_host_revision(actor,r.id,p_operation,p_input->'input');
 end if;
 -- The request/review/domain locks can wait; expiration uses wall clock.
 if (p_credential->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'UNAUTHORIZED';end if;
 perform fmat.calendar_actor(p_credential);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_host_revision_review"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "fmat"."decide_host_revision"(jsonb, uuid, text, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_host_revision_review"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_host_revision_review"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_host_revision_review"(text, jsonb, jsonb) TO "service_role";
