-- Additive recovery foundation. Activation waits for generation fencing on all
-- runtime entry points. These functions are private even to service_role.
alter table fmat.conversation_scopes add column runtime_generation bigint not null default 0
 check(runtime_generation between 0 and 9007199254740991);

create table fmat.conversation_generations (
 conversation_id uuid not null references fmat.conversation_scopes(id) on delete cascade,
 generation bigint not null check(generation between 0 and 9007199254740991),
 runtime_session_id text unique check(length(runtime_session_id) between 1 and 200),
 created_at timestamptz not null default clock_timestamp(),
 retired_at timestamptz,
 terminal_event_id text check(length(terminal_event_id) between 1 and 200),
 terminal_tail bigint check(terminal_tail between 0 and 9007199254740990),
 input_tokens bigint check(input_tokens between 0 and 9007199254740991),
 output_tokens bigint check(output_tokens between 0 and 9007199254740991),
 cache_read_tokens bigint check(cache_read_tokens between 0 and 9007199254740991),
 cache_write_tokens bigint check(cache_write_tokens between 0 and 9007199254740991),
 primary key(conversation_id,generation),
 check((retired_at is null and terminal_event_id is null and terminal_tail is null
   and input_tokens is null and output_tokens is null and cache_read_tokens is null and cache_write_tokens is null)
  or (retired_at is not null and runtime_session_id is not null and terminal_event_id is not null and terminal_tail is not null
   and input_tokens is not null and output_tokens is not null and cache_read_tokens is not null and cache_write_tokens is not null))
);
create table fmat.conversation_recoveries (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references fmat.conversation_scopes(id) on delete cascade,
 source_generation bigint not null,
 target_generation bigint not null check(target_generation=source_generation+1),
 grant_id uuid not null references fmat.conversation_grants(id),
 request_key uuid not null,
 input_fingerprint text not null check(input_fingerprint ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(conversation_id,source_generation),
 unique(conversation_id,grant_id,request_key),
 foreign key(conversation_id,source_generation) references fmat.conversation_generations(conversation_id,generation),
 foreign key(conversation_id,target_generation) references fmat.conversation_generations(conversation_id,generation)
);
create index conversation_recoveries_grant_idx on fmat.conversation_recoveries(grant_id);
create index conversation_recoveries_target_idx on fmat.conversation_recoveries(conversation_id,target_generation);
alter table fmat.conversation_generations enable row level security;
alter table fmat.conversation_recoveries enable row level security;
revoke all on fmat.conversation_generations,fmat.conversation_recoveries from public,anon,authenticated,service_role;

-- Validate server-observed evidence independently of browser validation. SQL
-- cannot establish provider terminal state: only the bounded inspector may
-- supply it to the eventual service-only wrapper. Do not expose this function.
create or replace function fmat.conversation_recovery_begin(p_grant_id uuid,p_conversation_id uuid,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
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
$$;
revoke all on function fmat.conversation_recovery_begin(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
