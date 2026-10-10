SET local check_function_bodies = off;

CREATE TABLE "fmat"."conversation_successors" (
  "conversation_id"     uuid                     NOT NULL,
  "generation"          bigint                   NOT NULL,
  "message_id"          uuid                     NOT NULL,
  "creation_key"        uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "lease_token"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "lease_until"         timestamp with time zone NOT NULL DEFAULT (clock_timestamp() + '00:01:30'::interval),
  "creation_started_at" timestamp with time zone,
  "bound_at"            timestamp with time zone,
  CONSTRAINT "conversation_successors_check" CHECK (((bound_at IS NULL) OR (creation_started_at IS NOT NULL))),
  CONSTRAINT "conversation_successors_creation_key_key" UNIQUE (creation_key),
  CONSTRAINT "conversation_successors_generation_check" CHECK ((generation > 0)),
  CONSTRAINT "conversation_successors_pkey" PRIMARY KEY (conversation_id, generation)
);

ALTER TABLE "fmat"."conversation_successors"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.conversation_successor (
  p_operation       text,
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare scope fmat.conversation_scopes; pending fmat.runtime_messages; successor fmat.conversation_successors;
 access jsonb; expected numeric; message_id uuid; permitted boolean:=false; session_id text;
begin
 if p_operation is null or p_operation not in ('claim','start','bind')
  or jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_input->'generation') is distinct from 'number'
  or jsonb_typeof(p_input->'messageId') is distinct from 'string'
  or (p_input->>'messageId') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  then raise exception 'INVALID_INPUT';end if;
 expected:=(p_input->>'generation')::numeric;message_id:=(p_input->>'messageId')::uuid;
 if expected<1 or expected>9007199254740991 or trunc(expected)<>expected then raise exception 'INVALID_INPUT';end if;
 if p_operation='claim' then
  if (p_input-'generation'-'messageId')<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 elsif p_operation='start' then
  if (p_input-'generation'-'messageId'-'leaseToken')<>'{}'::jsonb
   or jsonb_typeof(p_input->'leaseToken') is distinct from 'string'
   or (p_input->>'leaseToken') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   then raise exception 'INVALID_INPUT';end if;
 else
  if (p_input-'generation'-'messageId'-'creationKey'-'sessionId')<>'{}'::jsonb
   or jsonb_typeof(p_input->'creationKey') is distinct from 'string'
   or (p_input->>'creationKey') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(p_input->'sessionId') is distinct from 'string' or length(p_input->>'sessionId') not between 1 and 200
   then raise exception 'INVALID_INPUT';end if;
  session_id:=p_input->>'sessionId';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 select * into strict scope from fmat.conversation_scopes where id=p_conversation_id for update;
 if scope.runtime_generation<>expected then raise exception 'STALE_REVISION';end if;
 -- Validate the entire retained ledger and the explicit recovery transition.
 perform fmat.conversation_history_timeline(scope);
 if not exists(select 1 from fmat.conversation_recoveries where conversation_id=scope.id and target_generation=expected)
  then raise exception 'FORBIDDEN';end if;
 select * into pending from fmat.runtime_messages where id=message_id and conversation_id=scope.id and grant_id=p_grant_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into successor from fmat.conversation_successors where conversation_id=scope.id and generation=expected for update;
 -- Authority may expire while waiting for any row lock, including a replay.
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 if successor.conversation_id is not null and successor.message_id<>message_id then raise exception 'FORBIDDEN';end if;
 if p_operation='claim' then
  if successor.bound_at is null and pending.status<>'pending' then raise exception 'FORBIDDEN';end if;
  if successor.conversation_id is null then
   if scope.runtime_session_id is not null then raise exception 'FORBIDDEN';end if;
   insert into fmat.conversation_successors(conversation_id,generation,message_id)
    values(scope.id,expected,message_id) returning * into successor;
  elsif successor.creation_started_at is null and successor.lease_until<=clock_timestamp() then
   update fmat.conversation_successors set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
    where conversation_id=scope.id and generation=expected returning * into successor;
  end if;
 elsif p_operation='start' then
  if successor.conversation_id is null or successor.lease_token is distinct from (p_input->>'leaseToken')::uuid then raise exception 'LEASE_LOST';end if;
  if successor.creation_started_at is null then
   if successor.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
   if pending.status<>'pending' or scope.runtime_session_id is not null then raise exception 'FORBIDDEN';end if;
   update fmat.conversation_successors set creation_started_at=clock_timestamp()
    where conversation_id=scope.id and generation=expected returning * into successor;
   permitted:=true;
  end if;
 else
  if successor.conversation_id is null or successor.creation_started_at is null
   or successor.creation_key is distinct from (p_input->>'creationKey')::uuid then raise exception 'FORBIDDEN';end if;
  if successor.bound_at is not null then
   perform fmat.require_runtime_generation(scope,session_id);
  else
   if pending.status<>'pending' or scope.runtime_session_id is not null then raise exception 'FORBIDDEN';end if;
   if exists(select 1 from fmat.conversation_generations where runtime_session_id=session_id)
    or exists(select 1 from fmat.conversation_scopes where runtime_session_id=session_id) then raise exception 'FORBIDDEN';end if;
   update fmat.conversation_generations set runtime_session_id=session_id
    where conversation_id=scope.id and generation=expected and retired_at is null and runtime_session_id is null;
   if not found then raise exception 'STALE_REVISION';end if;
   update fmat.conversation_scopes set runtime_session_id=session_id where id=scope.id;
   update fmat.conversation_successors set bound_at=clock_timestamp()
    where conversation_id=scope.id and generation=expected returning * into successor;
   scope.runtime_session_id:=session_id;
   insert into fmat.audit_events(operation,actor,subject_id,metadata)
    values('conversation_successor_bound',jsonb_build_object('kind',access->>'actorKind','grantId',p_grant_id),scope.id::text,
     jsonb_build_object('generation',expected,'messageId',message_id));
  end if;
 end if;
 return jsonb_build_object('generation',expected,'messageId',message_id,'creationKey',successor.creation_key,
  'leaseToken',successor.lease_token,'leaseExpiresAt',successor.lease_until,
  'state',case when successor.bound_at is not null then 'bound' when successor.creation_started_at is not null then 'creating' else 'prepared' end,
  'sessionId',scope.runtime_session_id,'dispatch',permitted);
end;
$function$;

ALTER TABLE "fmat"."conversation_successors"
  ADD CONSTRAINT "conversation_successors_conversation_id_generation_fkey" FOREIGN KEY (conversation_id, generation)
    REFERENCES fmat.conversation_generations(conversation_id, generation) ON DELETE CASCADE;

ALTER TABLE "fmat"."conversation_successors"
  ADD CONSTRAINT "conversation_successors_message_id_fkey" FOREIGN KEY (message_id) REFERENCES fmat.runtime_messages(id);

CREATE INDEX conversation_successors_message_idx ON fmat.conversation_successors USING btree (message_id);

REVOKE ALL ON FUNCTION "fmat"."conversation_successor"(text, uuid, uuid, jsonb) FROM PUBLIC;
