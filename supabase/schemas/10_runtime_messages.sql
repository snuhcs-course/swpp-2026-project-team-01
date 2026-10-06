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
  if p_operation='settle' then
    -- A runtime may record completion after the originating grant expires.
    -- This branch cannot read content, grant access, or perform domain effects.
    select * into v_scope from fmat.conversation_scopes where id=p_conversation_id;
    if v_scope.runtime_session_id is null or v_scope.runtime_session_id is distinct from p_input->>'sessionId' then raise exception 'FORBIDDEN'; end if;
    if p_input->>'status' is null or p_input->>'status' not in ('completed','failed') then raise exception 'INVALID_INPUT'; end if;
    update fmat.runtime_messages set status=p_input->>'status',settled_at=clock_timestamp()
      where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id and status='pending';
    return jsonb_build_object('recorded',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  -- Serialize accept/bind against other participants on this shared scope.
  select * into v_scope from fmat.conversation_scopes where id=p_conversation_id for update;
  if p_operation='inspect' then
    return jsonb_build_object('sessionId',v_scope.runtime_session_id,'messages',(
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'status',status,'createdAt',created_at,
        'mine',grant_id=p_grant_id) order by created_at,id),'[]'::jsonb) from fmat.runtime_messages where conversation_id=p_conversation_id));
  end if;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if p_operation='accept' then
    if coalesce(p_input->>'clientId','')='' or jsonb_typeof(p_input->'text') is distinct from 'string'
      or length(trim(p_input->>'text')) not between 1 and 10000
      or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('clientId','text')) then raise exception 'INVALID_INPUT'; end if;
    select * into v_message from fmat.runtime_messages where conversation_id=p_conversation_id and grant_id=p_grant_id and client_id=(p_input->>'clientId')::uuid;
    if found then
      if v_message.text is distinct from p_input->>'text' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    else
      if exists(select 1 from fmat.runtime_messages where conversation_id=p_conversation_id and status='pending') then raise exception 'CONVERSATION_BUSY'; end if;
      -- Bounded inbox/checkpoint growth; the runtime has independent token caps.
      if (select count(*) from fmat.runtime_messages where conversation_id=p_conversation_id)>=200 then raise exception 'CONVERSATION_LIMIT'; end if;
      insert into fmat.runtime_messages(conversation_id,grant_id,client_id,text)
        values(p_conversation_id,p_grant_id,(p_input->>'clientId')::uuid,p_input->>'text') returning * into v_message;
    end if;
  elsif p_operation='deliver' then
    select * into v_message from fmat.runtime_messages where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_session:=p_input->>'sessionId';
    if length(coalesce(v_session,'')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
    if v_scope.runtime_session_id is not null and v_scope.runtime_session_id<>v_session then raise exception 'FORBIDDEN'; end if;
    update fmat.conversation_scopes set runtime_session_id=v_session where id=p_conversation_id and runtime_session_id is null;
  else raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('id',v_message.id,'status',v_message.status,'text',v_message.text);
end;
$$;
revoke all on fmat.runtime_messages from public,anon,authenticated,service_role;
revoke execute on function public.fmat_runtime_message(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_runtime_message(text,uuid,uuid,jsonb) to service_role;
