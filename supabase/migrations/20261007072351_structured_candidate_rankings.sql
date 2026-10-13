SET local check_function_bodies = off;

CREATE TABLE "fmat"."candidate_rankings" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"       uuid                     NOT NULL,
  "check_id"         uuid                     NOT NULL,
  "request_revision" integer                  NOT NULL,
  "fingerprint"      text                     NOT NULL,
  "ordered_ids"      jsonb                    NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "expires_at"       timestamp with time zone NOT NULL,
  CONSTRAINT "candidate_rankings_check" CHECK ((expires_at > created_at)),
  CONSTRAINT "candidate_rankings_fingerprint_check" CHECK ((fingerprint ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "candidate_rankings_ordered_ids_check" CHECK (((jsonb_typeof(ordered_ids) = 'array'::text) AND (jsonb_array_length(ordered_ids) <= 30))),
  CONSTRAINT "candidate_rankings_pkey" PRIMARY KEY (id),
  CONSTRAINT "candidate_rankings_request_id_check_id_key" UNIQUE (request_id, check_id),
  CONSTRAINT "candidate_rankings_request_revision_check" CHECK ((request_revision > 0))
);

ALTER TABLE "fmat"."candidate_rankings"
  ENABLE ROW LEVEL SECURITY;

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
   insert into fmat.candidate_rankings(request_id,check_id,request_revision,fingerprint,ordered_ids,expires_at)
    values(r.id,r.availability_check_id,r.revision,fingerprint,p_input->'orderedIds',expires) returning * into saved;
  end if;
 end if;
 if saved.id is not null then result:=jsonb_build_object('rankingId',saved.id,'requestId',r.id,'revision',r.revision,'checkId',r.availability_check_id,'orderedIds',saved.ordered_ids,'expiresAt',saved.expires_at,'complete',false);end if;
 if p_operation='read' then return jsonb_build_object('fingerprint',fingerprint,'input',jsonb_build_object('timezone',r.details->>'timezone','candidates',candidates),'saved',result);end if;
 return result;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_candidate_ranking"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."candidate_rankings"
  ADD CONSTRAINT "candidate_rankings_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id) ON DELETE CASCADE;

CREATE TRIGGER candidate_rankings_immutable
  BEFORE UPDATE ON fmat.candidate_rankings
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "public"."fmat_candidate_ranking"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_candidate_ranking"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_candidate_ranking"(text, jsonb, jsonb) TO "service_role";
