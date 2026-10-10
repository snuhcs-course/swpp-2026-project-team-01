SET local check_function_bodies = off;

CREATE TABLE "fmat"."model_budgets" (
  "name"              text                     NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "reserved_cents"    integer                  NOT NULL,
  CONSTRAINT "model_budgets_name_check" CHECK (((name = 'service'::text) OR (name ~ '^(host|guest):[a-f0-9-]{36}$'::text))),
  CONSTRAINT "model_budgets_pkey" PRIMARY KEY (name),
  CONSTRAINT "model_budgets_reserved_cents_check" CHECK ((reserved_cents >= 0))
);

ALTER TABLE "fmat"."model_budgets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."model_work_attempts" (
  "name"     text    NOT NULL,
  "attempts" integer NOT NULL,
  CONSTRAINT "model_work_attempts_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 8))),
  CONSTRAINT "model_work_attempts_name_check" CHECK ((name ~ '^(conversation|ranking):[a-f0-9-]{36}$'::text)),
  CONSTRAINT "model_work_attempts_pkey" PRIMARY KEY (name)
);

ALTER TABLE "fmat"."model_work_attempts"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.model_budget_reserve (
  p_kind      text,
  p_principal uuid,
  p_work_kind text,
  p_work      uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare key text; work_key text; b fmat.model_budgets; checked_at timestamptz; used integer; ceiling integer;
begin
 if p_kind is null or p_kind not in ('host','guest') or p_principal is null
  or p_work_kind is null or p_work_kind not in ('conversation','ranking') or p_work is null then raise exception 'UNAUTHORIZED';end if;
 -- Callers acquire every authority lock before this shared ordering. Never
 -- refund an uncertain attempt or recreate an expired work counter.
 foreach key in array array['service',p_kind||':'||p_principal::text] loop
  insert into fmat.model_budgets values(key,clock_timestamp(),0) on conflict do nothing;
  perform 1 from fmat.model_budgets where name=key for update;
 end loop;
 work_key:=p_work_kind||':'||p_work::text;
 insert into fmat.model_work_attempts values(work_key,0) on conflict do nothing;
 select attempts into strict used from fmat.model_work_attempts where name=work_key for update;
 if used>=(case when p_work_kind='conversation' then 8 else 2 end) then raise exception 'MODEL_LIMIT';end if;
 checked_at:=clock_timestamp();
 foreach key in array array['service',p_kind||':'||p_principal::text] loop
  select * into strict b from fmat.model_budgets where name=key;
  if b.window_started_at+interval '24 hours'<=checked_at then b.window_started_at:=checked_at;b.reserved_cents:=0;end if;
  ceiling:=case when key='service' then 30000 else 3000 end;
  if b.reserved_cents+60>ceiling then raise exception 'MODEL_LIMIT';end if;
  update fmat.model_budgets set window_started_at=b.window_started_at,reserved_cents=b.reserved_cents+60 where name=key;
 end loop;
 update fmat.model_work_attempts set attempts=used+1 where name=work_key;
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
 if jsonb_typeof(p_input) is distinct from 'object' or p_operation not in ('read','reserve','save') then raise exception 'INVALID_INPUT';end if;
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
 if p_operation='reserve' then
  if p_input->>'fingerprint' is distinct from fingerprint then raise exception 'REVISION_CONFLICT';end if;
  -- A concurrent saved result must be read again; it cannot authorize another
  -- provider attempt. Empty candidates are deterministic and need no model.
  if saved.id is not null or jsonb_array_length(candidates)=0 then raise exception 'REVISION_CONFLICT';end if;
  perform fmat.model_budget_reserve(p_credential->>'kind',case when p_credential->>'kind'='host' then r.host_id else r.id end,'ranking',r.availability_check_id);
  perform public.fmat_availability_evaluation('check',p_credential,p_input);
  if expires<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
  return jsonb_build_object('reserved',true);
 end if;
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

CREATE OR REPLACE FUNCTION public.fmat_conversation_model_reserve (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_message_id      uuid,
  p_session_id      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare access jsonb; scope fmat.conversation_scopes; message fmat.runtime_messages;
begin
 if p_grant_id is null or p_conversation_id is null or p_message_id is null
  or length(coalesce(p_session_id,'')) not between 1 and 200 then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 select * into strict scope from fmat.conversation_scopes where id=p_conversation_id for update;
 if scope.runtime_session_id is distinct from p_session_id then raise exception 'FORBIDDEN';end if;
 select * into message from fmat.runtime_messages where id=p_message_id and conversation_id=p_conversation_id and grant_id=p_grant_id for update;
 if not found or message.status<>'pending' then raise exception 'NOT_FOUND';end if;
 perform fmat.model_budget_reserve(access->>'actorKind',case when access->>'actorKind'='host' then scope.host_id else scope.request_id end,'conversation',message.id);
 -- Time may expire while the service counter is contended. All charges roll
 -- back if the original authority is no longer valid after that wait.
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 return jsonb_build_object('reserved',true);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "fmat"."model_budget_reserve"(text, uuid, text, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text) TO "service_role";
