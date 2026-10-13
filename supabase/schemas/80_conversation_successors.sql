-- Private creation protocol, invoked through the service-only runtime wrapper.
-- Explicit terminal-recovery activation remains separate from dispatch.
create table fmat.conversation_successors (
 conversation_id uuid not null,
 generation bigint not null check(generation>0),
 message_id uuid not null references fmat.runtime_messages(id),
 creation_key uuid not null unique default gen_random_uuid(),
 lease_token uuid not null default gen_random_uuid(),
 lease_until timestamptz not null default (clock_timestamp()+interval '90 seconds'),
 creation_started_at timestamptz,
 bound_at timestamptz,
 primary key(conversation_id,generation),
 foreign key(conversation_id,generation) references fmat.conversation_generations(conversation_id,generation) on delete cascade,
 check(bound_at is null or creation_started_at is not null)
);
create index conversation_successors_message_idx on fmat.conversation_successors(message_id);
alter table fmat.conversation_successors enable row level security;
revoke all on fmat.conversation_successors from public,anon,authenticated,service_role;

-- claim may renew an expired pre-creation lease; start consumes the permission
-- to perform one external creation send. After start, uncertainty is permanent
-- until the same creation identity binds, regardless of lease expiry. The exact
-- immutable session ID and creation key come from the runtime delivery hook.
create or replace function fmat.conversation_successor(p_operation text,p_grant_id uuid,p_conversation_id uuid,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
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
 if successor.conversation_id is not null and successor.message_id<>message_id then
  -- An original grant may expire during context preparation. The dispatcher
  -- settles that input as failed; a separately authorized new input can reuse
  -- this unstarted generation, but never an uncertain external creation.
  if p_operation='claim' and successor.creation_started_at is not null then raise exception 'RECONCILIATION_PENDING';end if;
  if p_operation<>'claim' or successor.creation_started_at is not null or scope.runtime_session_id is not null
   or pending.status<>'pending' or exists(select 1 from fmat.runtime_messages where id=successor.message_id and status='pending')
   then raise exception 'FORBIDDEN';end if;
  insert into fmat.audit_events(operation,actor,subject_id,metadata)
   values('conversation_successor_preparation_reassigned',jsonb_build_object('kind',access->>'actorKind','grantId',p_grant_id),scope.id::text,
    jsonb_build_object('generation',expected,'previousMessageId',successor.message_id,'messageId',message_id));
  update fmat.conversation_successors set message_id=pending.id,creation_key=gen_random_uuid(),lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
   where conversation_id=scope.id and generation=expected returning * into successor;
 end if;
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
$$;
revoke all on function fmat.conversation_successor(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
