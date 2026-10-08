-- Application conversation identity is independent of an eve session ID.
create table fmat.conversation_scopes (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references fmat.hosts(id),
  request_id uuid references fmat.requests(id),
  audience text not null check (audience in ('host_setup','host_private','request_shared')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((audience='host_setup')=(request_id is null)),
  unique nulls not distinct (host_id,request_id,audience)
);
create index conversation_scopes_request_idx on fmat.conversation_scopes(request_id);
alter table fmat.conversation_scopes enable row level security;

-- A grant ID is a server-side execution reference, never a browser credential.
-- Do not FK auth.sessions: logout must not depend on application cleanup.
create table fmat.conversation_grants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references fmat.conversation_scopes(id),
  actor_kind text not null check(actor_kind in ('host','guest')),
  authority_key text not null,
  credential jsonb not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(conversation_id,actor_kind,authority_key)
);
alter table fmat.conversation_grants enable row level security;

-- The server verifies the original Supabase JWT with Auth before forwarding
-- these claims. Fresh database checks additionally enforce immediate logout.
create or replace function fmat.credential_actor(p_credential jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_user auth.users; v_request fmat.requests; v_actor jsonb;
begin
  if jsonb_typeof(p_credential) is distinct from 'object' then raise exception 'UNAUTHORIZED'; end if;
  if p_credential->>'kind'='host' then
    if coalesce((p_credential->>'expiresAt')::timestamptz,now())<=now() then raise exception 'UNAUTHORIZED'; end if;
    select u.* into v_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=(p_credential->>'subject')::uuid and s.id=(p_credential->>'sessionId')::uuid
        and (s.not_after is null or s.not_after>now()) and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now()) and u.email_confirmed_at is not null;
    if not found or coalesce(v_user.email,'')='' then raise exception 'UNAUTHORIZED'; end if;
    return jsonb_build_object('kind','host','id',v_user.id,'email',lower(v_user.email));
  elsif p_credential->>'kind'='guest' then
    v_actor:=jsonb_build_object('kind','guest','requestId',p_credential->>'requestId','tokenHash',p_credential->>'tokenHash');
    perform fmat.authorize_guest(v_actor,(p_credential->>'requestId')::uuid);
    select * into v_request from fmat.requests where id=(p_credential->>'requestId')::uuid;
    if not exists(select 1 from fmat.hosts where id=v_request.host_id and revoked_at is null) then raise exception 'NOT_FOUND'; end if;
    return v_actor;
  end if;
  raise exception 'UNAUTHORIZED';
end;
$$;

create or replace function fmat.authorize_conversation(p_scope fmat.conversation_scopes,p_actor jsonb)
returns boolean language plpgsql set search_path='' as $$
declare v_request fmat.requests;
begin
  if p_scope.id is null or p_scope.revoked_at is not null then raise exception 'NOT_FOUND'; end if;
  if p_actor->>'kind'='host' then
    if fmat.require_host(p_actor,true)<>p_scope.host_id then raise exception 'NOT_FOUND'; end if;
  elsif p_actor->>'kind'='guest' then
    if p_scope.audience<>'request_shared' or p_scope.request_id::text is distinct from p_actor->>'requestId' then raise exception 'NOT_FOUND'; end if;
    perform fmat.authorize_guest(p_actor,p_scope.request_id);
    if not exists(select 1 from fmat.hosts where id=p_scope.host_id and revoked_at is null) then raise exception 'NOT_FOUND'; end if;
  else raise exception 'FORBIDDEN'; end if;
  if p_scope.request_id is null then return true; end if;
  select * into v_request from fmat.requests where id=p_scope.request_id;
  if v_request.host_id is distinct from p_scope.host_id then raise exception 'NOT_FOUND'; end if;
  return v_request.status not in ('booked','declined','withdrawn','expired')
    and (v_request.expires_at>now() or v_request.status='booking');
end;
$$;

create or replace function fmat.conversation_projection(p_scope fmat.conversation_scopes,p_grant fmat.conversation_grants,p_writable boolean)
returns jsonb language sql set search_path='' as $$
  select jsonb_build_object('conversationId',p_scope.id,'audience',p_scope.audience,
    'hostId',p_scope.host_id,'requestId',p_scope.request_id,'grantId',p_grant.id,
    'actorKind',p_grant.actor_kind,'expiresAt',p_grant.expires_at,'readOnly',not p_writable);
$$;

create or replace function public.fmat_conversation_access(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor jsonb; v_scope fmat.conversation_scopes; v_grant fmat.conversation_grants;
  v_host_id uuid; v_request_id uuid; v_audience text; v_expiry timestamptz; v_authority text; v_writable boolean;
begin
  v_actor:=fmat.credential_actor(p_credential);
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  if p_operation='identity' then return v_actor-'tokenHash'; end if;
  if p_operation='open' then
    v_audience:=p_input->>'audience'; v_request_id:=(p_input->>'requestId')::uuid;
    if v_audience is null or v_audience not in ('host_setup','host_private','request_shared')
      or (v_audience='host_setup')<>(v_request_id is null) then raise exception 'INVALID_INPUT'; end if;
    if v_actor->>'kind'='host' then v_host_id:=fmat.require_host(v_actor,true);
    else
      if v_audience<>'request_shared' or v_request_id::text is distinct from v_actor->>'requestId' then raise exception 'NOT_FOUND'; end if;
      select host_id into v_host_id from fmat.requests where id=v_request_id;
    end if;
    if v_request_id is not null and not exists(select 1 from fmat.requests where id=v_request_id and host_id=v_host_id) then raise exception 'NOT_FOUND'; end if;
    insert into fmat.conversation_scopes(host_id,request_id,audience) values(v_host_id,v_request_id,v_audience)
      on conflict(host_id,request_id,audience) do nothing;
    select * into v_scope from fmat.conversation_scopes where host_id=v_host_id
      and request_id is not distinct from v_request_id and audience=v_audience;
  elsif p_operation in ('authorize','revoke') then
    select * into v_scope from fmat.conversation_scopes where id=(p_input->>'conversationId')::uuid;
  else raise exception 'INVALID_INPUT'; end if;
  v_writable:=fmat.authorize_conversation(v_scope,v_actor);
  if v_actor->>'kind'='host' then
    v_authority:=p_credential->>'sessionId'; v_expiry:=(p_credential->>'expiresAt')::timestamptz;
  else
    v_authority:=p_credential->>'tokenHash';
    select token_expires_at into v_expiry from fmat.requests where id=v_scope.request_id;
  end if;
  if p_operation='revoke' then
    update fmat.conversation_grants set revoked_at=coalesce(revoked_at,now())
      where conversation_id=v_scope.id and actor_kind=v_actor->>'kind' and authority_key=v_authority;
    return jsonb_build_object('revoked',true);
  end if;
  insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
    values(v_scope.id,v_actor->>'kind',v_authority,p_credential,v_expiry)
    on conflict(conversation_id,actor_kind,authority_key) do update
      set credential=case when excluded.expires_at>fmat.conversation_grants.expires_at then excluded.credential else fmat.conversation_grants.credential end,
        expires_at=greatest(excluded.expires_at,fmat.conversation_grants.expires_at)
      where fmat.conversation_grants.revoked_at is null
    returning * into v_grant;
  if not found then raise exception 'FORBIDDEN'; end if;
  return fmat.conversation_projection(v_scope,v_grant,v_writable);
end;
$$;

-- Only authored server/tool code calls this with the grant captured during
-- authenticated dispatch. It must never be mounted as a grant-ID login route.
create or replace function public.fmat_conversation_check(p_grant_id uuid,p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor jsonb; v_scope fmat.conversation_scopes; v_grant fmat.conversation_grants; v_writable boolean;
begin
  select * into v_grant from fmat.conversation_grants where id=p_grant_id and conversation_id=p_conversation_id;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
  select * into v_scope from fmat.conversation_scopes where id=v_grant.conversation_id;
  -- Match request-command lock order. Keep revocation and the eventual tool
  -- effect serialized in this transaction, including an idempotent replay.
  if v_grant.credential->>'kind'='requester_email' then
    v_actor:=fmat.requester_email_execution_actor(v_grant.credential);
    if v_grant.actor_kind<>'guest' or v_scope.audience<>'request_shared' or v_scope.request_id::text is distinct from v_actor->>'requestId' then raise exception 'UNAUTHORIZED';end if;
  end if;
  perform 1 from fmat.requests where id=v_scope.request_id for update;
  if v_grant.credential->>'kind'='photon' then
    -- Link authority is issued only by the durable private inbox processor,
    -- never by credential_actor or a browser-supplied credential.
    if v_grant.actor_kind<>'host' or v_scope.audience<>'host_setup' then raise exception 'UNAUTHORIZED'; end if;
    v_actor:=fmat.photon_execution_actor(v_grant.credential);
  end if;
  perform 1 from fmat.hosts where id=v_scope.host_id for share;
  if v_grant.actor_kind='host' then
    perform 1 from auth.users where id=(v_grant.credential->>'subject')::uuid for share;
    perform 1 from auth.sessions where id=(v_grant.credential->>'sessionId')::uuid for share;
  end if;
  select * into v_scope from fmat.conversation_scopes where id=p_conversation_id for share;
  select * into v_grant from fmat.conversation_grants where id=p_grant_id and conversation_id=p_conversation_id for share;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at<=clock_timestamp() then raise exception 'UNAUTHORIZED'; end if;
  if v_grant.credential->>'kind'='requester_email' then v_actor:=fmat.requester_email_execution_actor(v_grant.credential);
  elsif v_grant.credential->>'kind'<>'photon' then v_actor:=fmat.credential_actor(v_grant.credential); end if;
  v_writable:=fmat.authorize_conversation(v_scope,v_actor);
  -- A transaction may have waited for another writer. Recheck time-based
  -- authority against wall time after locks, not its earlier transaction time.
  if v_grant.actor_kind='host' and exists(select 1 from auth.sessions
    where id=(v_grant.credential->>'sessionId')::uuid and not_after<=clock_timestamp()) then raise exception 'UNAUTHORIZED'; end if;
  if exists(select 1 from fmat.requests where id=v_scope.request_id and status<>'booking' and expires_at<=clock_timestamp()) then
    if v_grant.actor_kind='guest' then raise exception 'REQUEST_EXPIRED'; end if;
    v_writable:=false;
  end if;
  return fmat.conversation_projection(v_scope,v_grant,v_writable)||jsonb_build_object('actor',v_actor);
end;
$$;

revoke all on fmat.conversation_scopes,fmat.conversation_grants from public,anon,authenticated,service_role;
revoke execute on all functions in schema fmat from public,anon,authenticated,service_role;
revoke execute on function public.fmat_conversation_access(text,jsonb,jsonb),public.fmat_conversation_check(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fmat_conversation_access(text,jsonb,jsonb),public.fmat_conversation_check(uuid,uuid) to service_role;
