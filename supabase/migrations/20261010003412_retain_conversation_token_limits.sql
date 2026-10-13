SET local check_function_bodies = off;

DROP FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text);

CREATE TABLE "fmat"."conversation_model_usage" (
  "conversation_id"    uuid   NOT NULL,
  "generation"         bigint NOT NULL,
  "input_tokens"       bigint NOT NULL,
  "output_tokens"      bigint NOT NULL,
  "cache_read_tokens"  bigint NOT NULL,
  "cache_write_tokens" bigint NOT NULL,
  CONSTRAINT "conversation_model_usage_cache_read_tokens_check" CHECK (((cache_read_tokens >= 0) AND (cache_read_tokens <= '9007199254740991'::bigint))),
  CONSTRAINT "conversation_model_usage_cache_write_tokens_check" CHECK (((cache_write_tokens >= 0) AND (cache_write_tokens <= '9007199254740991'::bigint))),
  CONSTRAINT "conversation_model_usage_input_tokens_check" CHECK (((input_tokens >= 0) AND (input_tokens <= '9007199254740991'::bigint))),
  CONSTRAINT "conversation_model_usage_output_tokens_check" CHECK (((output_tokens >= 0) AND (output_tokens <= '9007199254740991'::bigint))),
  CONSTRAINT "conversation_model_usage_pkey" PRIMARY KEY (conversation_id, generation)
);

ALTER TABLE "fmat"."conversation_model_usage"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.conversation_model_reserve (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_message_id      uuid,
  p_session_id      text,
  p_usage           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
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
 perform fmat.require_runtime_generation(scope,p_session_id);
 select * into message from fmat.runtime_messages where id=p_message_id and conversation_id=p_conversation_id and grant_id=p_grant_id for update;
 if not found or message.status<>'pending' then raise exception 'NOT_FOUND';end if;
 perform fmat.require_model_usage(scope,p_usage);
 perform fmat.model_budget_reserve(access->>'actorKind',case when access->>'actorKind'='host' then scope.host_id else scope.request_id end,'conversation',message.id);
 -- Time may expire while the service counter is contended. All charges roll
 -- back if the original authority is no longer valid after that wait.
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 return jsonb_build_object('reserved',true);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.conversation_recovery_begin (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare scope fmat.conversation_scopes; access jsonb; old fmat.conversation_generations;
 recovery fmat.conversation_recoveries; evidence jsonb; usage jsonb; key text; value numeric;
 expected bigint; v_request_key uuid; fingerprint text; input_used numeric; output_used numeric;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or (p_input-'expectedGeneration'-'idempotencyKey'-'evidence')<>'{}'::jsonb
  or jsonb_typeof(p_input->'expectedGeneration') is distinct from 'number'
  or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string'
  or (p_input->>'idempotencyKey') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  then raise exception 'INVALID_INPUT';end if;
 value:=(p_input->>'expectedGeneration')::numeric;
 if value<0 or value>9007199254740990 or trunc(value)<>value then raise exception 'INVALID_INPUT';end if;
 expected:=value::bigint;v_request_key:=(p_input->>'idempotencyKey')::uuid;
 evidence:=p_input->'evidence';usage:=evidence->'usage';
 if jsonb_typeof(evidence) is distinct from 'object'
  or (evidence-'sessionId'-'generation'-'tailIndex'-'eventId'-'usage')<>'{}'::jsonb
  or jsonb_typeof(evidence->'sessionId') is distinct from 'string' or length(evidence->>'sessionId') not between 1 and 200
  or jsonb_typeof(evidence->'eventId') is distinct from 'string' or length(evidence->>'eventId') not between 1 and 200
  or jsonb_typeof(evidence->'generation') is distinct from 'number' or evidence->'generation' is distinct from p_input->'expectedGeneration'
  or jsonb_typeof(evidence->'tailIndex') is distinct from 'number'
  or jsonb_typeof(usage) is distinct from 'object'
  or (usage-'inputTokens'-'outputTokens'-'cacheReadTokens'-'cacheWriteTokens')<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 value:=(evidence->>'tailIndex')::numeric;
 if value<0 or value>9007199254740990 or trunc(value)<>value then raise exception 'INVALID_INPUT';end if;
 foreach key in array array['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'] loop
  if jsonb_typeof(usage->key) is distinct from 'number' then raise exception 'INVALID_INPUT';end if;
  value:=(usage->>key)::numeric;
  if value<0 or value>9007199254740991 or trunc(value)<>value then raise exception 'INVALID_INPUT';end if;
 end loop;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array('conversation-recovery:v1',p_conversation_id,p_grant_id,expected,evidence)::text,'UTF8')),'hex');
 -- Same leading lock as accept/deliver/model reservation. The authority helper
 -- then locks request, host/Auth, scope and grant before the scope write lock.
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 select * into strict scope from fmat.conversation_scopes where id=p_conversation_id for update;
 -- Recheck wall-clock expiry after any scope lock upgrade, including replays.
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 select * into recovery from fmat.conversation_recoveries where conversation_id=p_conversation_id and grant_id=p_grant_id and conversation_recoveries.request_key=v_request_key;
 if found then
  if recovery.input_fingerprint<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('recoveryId',recovery.id,'sourceGeneration',recovery.source_generation,'generation',recovery.target_generation);
 end if;
 if scope.runtime_generation<>expected then raise exception 'STALE_REVISION';end if;
 if scope.runtime_session_id is null or scope.runtime_session_id is distinct from evidence->>'sessionId' then raise exception 'FORBIDDEN';end if;
 -- New generation-zero scopes created after the migration are enrolled here;
 -- the next implementation slice also enrolls them during canonical binding.
 insert into fmat.conversation_generations(conversation_id,generation,runtime_session_id)
  values(scope.id,scope.runtime_generation,scope.runtime_session_id) on conflict(conversation_id,generation) do update set runtime_session_id=excluded.runtime_session_id
  where conversation_generations.generation=0 and conversation_generations.runtime_session_id is null and conversation_generations.retired_at is null;
 select * into strict old from fmat.conversation_generations where conversation_id=scope.id and generation=expected for update;
 if old.runtime_session_id is distinct from scope.runtime_session_id or old.retired_at is not null then raise exception 'STALE_REVISION';end if;
 -- Final provider evidence cannot understate a previously reserved live total.
 perform fmat.require_model_usage(scope,usage);
 -- Aggregate using numeric, so even adversarially large valid counts cannot
 -- overflow and become a fresh allowance. The native agent uses these limits.
 select coalesce(sum(input_tokens),0)+(usage->>'inputTokens')::numeric,
  coalesce(sum(output_tokens),0)+(usage->>'outputTokens')::numeric
  into input_used,output_used from fmat.conversation_generations where conversation_id=scope.id and retired_at is not null;
 if input_used>=100000 or output_used>=8000 then raise exception 'MODEL_LIMIT';end if;
 update fmat.conversation_generations set retired_at=clock_timestamp(),terminal_event_id=evidence->>'eventId',
  terminal_tail=(evidence->>'tailIndex')::bigint,input_tokens=(usage->>'inputTokens')::bigint,
  output_tokens=(usage->>'outputTokens')::bigint,cache_read_tokens=(usage->>'cacheReadTokens')::bigint,
  cache_write_tokens=(usage->>'cacheWriteTokens')::bigint where conversation_id=scope.id and generation=expected;
 insert into fmat.conversation_generations(conversation_id,generation) values(scope.id,expected+1);
 insert into fmat.conversation_recoveries(conversation_id,source_generation,target_generation,grant_id,request_key,input_fingerprint)
  values(scope.id,expected,expected+1,p_grant_id,v_request_key,fingerprint) returning * into recovery;
 update fmat.conversation_scopes set runtime_generation=expected+1,runtime_session_id=null where id=scope.id;
 insert into fmat.audit_events(operation,actor,subject_id,metadata)
  values('conversation_recovery_started',jsonb_build_object('kind',access->>'actorKind','grantId',p_grant_id),scope.id::text,
   jsonb_build_object('recoveryId',recovery.id,'sourceGeneration',expected,'generation',expected+1));
 return jsonb_build_object('recoveryId',recovery.id,'sourceGeneration',expected,'generation',expected+1);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.require_model_usage (
  p_scope fmat.conversation_scopes,
  p_usage jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare key text; value numeric; prior fmat.conversation_model_usage;
 retired_count bigint; retired_input numeric; retired_output numeric;
begin
 if p_usage is null then
  if p_scope.runtime_generation<>0 or exists(select 1 from fmat.conversation_model_usage where conversation_id=p_scope.id) then
   raise exception 'MODEL_LIMIT';
  end if;
  return; -- Legacy generation zero still has its original native session caps.
 end if;
 if jsonb_typeof(p_usage) is distinct from 'object' or (p_usage-'inputTokens'-'outputTokens'-'cacheReadTokens'-'cacheWriteTokens')<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 foreach key in array array['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'] loop
  if jsonb_typeof(p_usage->key) is distinct from 'number' then raise exception 'INVALID_INPUT';end if;
  value:=(p_usage->>key)::numeric;
  if value<0 or value>9007199254740991 or trunc(value)<>value then raise exception 'INVALID_INPUT';end if;
 end loop;
 select * into prior from fmat.conversation_model_usage where conversation_id=p_scope.id and generation=p_scope.runtime_generation for update;
 if found and ((p_usage->>'inputTokens')::bigint<prior.input_tokens or (p_usage->>'outputTokens')::bigint<prior.output_tokens
  or (p_usage->>'cacheReadTokens')::bigint<prior.cache_read_tokens or (p_usage->>'cacheWriteTokens')::bigint<prior.cache_write_tokens) then raise exception 'MODEL_LIMIT';end if;
 select count(*),coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0) into retired_count,retired_input,retired_output
  from fmat.conversation_generations where conversation_id=p_scope.id and generation<p_scope.runtime_generation and retired_at is not null;
 if retired_count<>p_scope.runtime_generation then raise exception 'MODEL_LIMIT';end if;
 if retired_input+(p_usage->>'inputTokens')::numeric>=100000 or retired_output+(p_usage->>'outputTokens')::numeric>=8000 then raise exception 'MODEL_LIMIT';end if;
 insert into fmat.conversation_model_usage values(p_scope.id,p_scope.runtime_generation,(p_usage->>'inputTokens')::bigint,
  (p_usage->>'outputTokens')::bigint,(p_usage->>'cacheReadTokens')::bigint,(p_usage->>'cacheWriteTokens')::bigint)
 on conflict(conversation_id,generation) do update set input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,
  cache_read_tokens=excluded.cache_read_tokens,cache_write_tokens=excluded.cache_write_tokens;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_model_reserve (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_message_id      uuid,
  p_session_id      text
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select fmat.conversation_model_reserve(p_grant_id,p_conversation_id,p_message_id,p_session_id,null)
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_conversation_model_reserve (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_message_id      uuid,
  p_session_id      text,
  p_usage           jsonb
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select fmat.conversation_model_reserve(p_grant_id,p_conversation_id,p_message_id,p_session_id,p_usage)
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."conversation_model_usage"
  ADD CONSTRAINT "conversation_model_usage_conversation_id_generation_fkey" FOREIGN KEY (conversation_id, generation)
    REFERENCES fmat.conversation_generations(conversation_id, generation) ON DELETE CASCADE;

REVOKE ALL ON FUNCTION "fmat"."conversation_model_reserve"(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."require_model_usage"(fmat.conversation_scopes, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_model_reserve"(uuid, uuid, uuid, text, jsonb) TO "service_role";
