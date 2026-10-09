-- Application inbox, not a second transcript engine. Eve owns generated
-- history/checkpoints; this ledger freezes authenticated input and its receipt.
alter table fmat.conversation_scopes add column runtime_session_id text;
create unique index conversation_runtime_session_idx on fmat.conversation_scopes(runtime_session_id) where runtime_session_id is not null;
create table fmat.runtime_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references fmat.conversation_scopes(id),
  grant_id uuid not null references fmat.conversation_grants(id),
  client_id uuid not null,
  text text not null check(length(text) between 1 and 10000),
  status text not null default 'pending' check(status in ('pending','completed','failed')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique(conversation_id,grant_id,client_id)
);
create index runtime_messages_grant_idx on fmat.runtime_messages(grant_id);
create unique index runtime_messages_pending_idx on fmat.runtime_messages(conversation_id) where status='pending';
alter table fmat.runtime_messages enable row level security;

create or replace function public.fmat_runtime_message(p_operation text,p_grant_id uuid,p_conversation_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_access jsonb; v_message fmat.runtime_messages; v_scope fmat.conversation_scopes; v_session text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
  if p_operation='settle' then
    -- A runtime may record completion after the originating grant expires.
    -- Reply preparation separately requires current private-channel authority.
    select * into v_scope from fmat.conversation_scopes where id=p_conversation_id;
    perform fmat.require_runtime_generation(v_scope,p_input->>'sessionId');
    if p_input->>'status' is null or p_input->>'status' not in ('completed','failed') then raise exception 'INVALID_INPUT'; end if;
    -- Commit an eligible private reply in the same transaction as completion.
    -- A failed write leaves the input pending for checkpoint-based recovery.
    perform fmat.photon_reply_prepare(p_grant_id,p_conversation_id,p_input);
    perform fmat.requester_email_reply_prepare(p_grant_id,p_conversation_id,p_input);
    update fmat.runtime_messages set status=p_input->>'status',settled_at=clock_timestamp()
      where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id and status='pending';
    return jsonb_build_object('recorded',true);
  end if;
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  -- Serialize accept/bind against other participants on this shared scope.
  select * into v_scope from fmat.conversation_scopes where id=p_conversation_id for update;
  if p_operation='inspect' then
    return jsonb_build_object('sessionId',v_scope.runtime_session_id,'messages',(
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',fmat.protect_conversation_text(text),'status',status,'createdAt',created_at,
        'mine',grant_id=p_grant_id) order by created_at,id),'[]'::jsonb) from fmat.runtime_messages where conversation_id=p_conversation_id));
  end if;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if p_operation='accept' then
    if coalesce(p_input->>'clientId','')='' or jsonb_typeof(p_input->'text') is distinct from 'string'
      or length(p_input->>'text') not between 1 and 10000 or length(trim(p_input->>'text'))=0
      or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('clientId','text')) then raise exception 'INVALID_INPUT'; end if;
    select * into v_message from fmat.runtime_messages where conversation_id=p_conversation_id and grant_id=p_grant_id and client_id=(p_input->>'clientId')::uuid;
    if found then
      if coalesce(v_message.input_fingerprint,fmat.conversation_input_fingerprint(p_conversation_id,p_grant_id,v_message.client_id,v_message.text))
        is distinct from fmat.conversation_input_fingerprint(p_conversation_id,p_grant_id,v_message.client_id,p_input->>'text')
        then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    else
      if exists(select 1 from fmat.runtime_messages where conversation_id=p_conversation_id and status='pending') then raise exception 'CONVERSATION_BUSY'; end if;
      -- Bounded inbox/checkpoint growth; the runtime has independent token caps.
      if (select count(*) from fmat.runtime_messages where conversation_id=p_conversation_id)>=200 then raise exception 'CONVERSATION_LIMIT'; end if;
      perform fmat.conversation_budget_charge(v_access->>'actorKind',
        case when v_access->>'actorKind'='host' then v_scope.host_id else v_scope.request_id end);
      -- Quota contention may outlast a grant, Auth session or request deadline.
      v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
      if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
      insert into fmat.runtime_messages(conversation_id,grant_id,client_id,text,input_fingerprint)
        values(p_conversation_id,p_grant_id,(p_input->>'clientId')::uuid,fmat.protect_conversation_text(p_input->>'text'),
          fmat.conversation_input_fingerprint(p_conversation_id,p_grant_id,(p_input->>'clientId')::uuid,p_input->>'text')) returning * into v_message;
    end if;
  elsif p_operation='deliver' then
    select * into v_message from fmat.runtime_messages where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_session:=p_input->>'sessionId';
    if length(coalesce(v_session,'')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
    if v_scope.runtime_generation>0 and v_scope.runtime_session_id is null then raise exception 'RECONCILIATION_PENDING';end if;
    if v_scope.runtime_session_id is not null then perform fmat.require_runtime_generation(v_scope,v_session);end if;
    update fmat.conversation_scopes set runtime_session_id=v_session where id=p_conversation_id and runtime_session_id is null;
    insert into fmat.conversation_generations(conversation_id,generation,runtime_session_id)
      values(p_conversation_id,v_scope.runtime_generation,v_session) on conflict(conversation_id,generation) do update
      set runtime_session_id=excluded.runtime_session_id where conversation_generations.generation=0
        and conversation_generations.runtime_session_id is null and conversation_generations.retired_at is null;
  else raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('id',v_message.id,'status',v_message.status,'text',fmat.protect_conversation_text(v_message.text));
end;
$$;
revoke all on fmat.runtime_messages from public,anon,authenticated,service_role;
revoke execute on function public.fmat_runtime_message(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_runtime_message(text,uuid,uuid,jsonb) to service_role;
