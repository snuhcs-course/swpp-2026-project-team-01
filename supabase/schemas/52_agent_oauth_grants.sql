-- Consent delegates application authority, never a provider/browser token.
create table fmat.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null unique references fmat.oauth_authorizations(id),
  client_id uuid not null references fmat.oauth_clients(id),
  resource text not null,
  scope text not null check(fmat.oauth_scope_valid(scope)),
  actor_kind text not null check(actor_kind in ('host','guest','intake')),
  actor_id uuid not null,
  host_id uuid not null references fmat.hosts(id),
  request_id uuid references fmat.requests(id),
  session_id uuid,
  token_hash text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '30 days'),
  check((actor_kind='host' and actor_id=host_id and session_id is not null and request_id is null and token_hash is null and scope like 'host:%')
    or (actor_kind='guest' and actor_id=request_id and request_id is not null and session_id is null and token_hash is not null and token_hash ~ '^[a-f0-9]{64}$' and scope like 'request:%' and not ('request:intake'=any(string_to_array(scope,' '))))
    or (actor_kind='intake' and session_id is null and request_id is null and token_hash is null and scope like 'request:%'))
);
create index oauth_grants_client_idx on fmat.oauth_grants(client_id);
create index oauth_grants_host_idx on fmat.oauth_grants(host_id);
create index oauth_grants_request_idx on fmat.oauth_grants(request_id);
alter table fmat.oauth_grants enable row level security;
create table fmat.oauth_codes (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid not null unique references fmat.oauth_grants(id),
  redirect_uri text not null,
  code_challenge text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '1 minute')
);
alter table fmat.oauth_codes enable row level security;
create table fmat.oauth_refresh_tokens (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid not null references fmat.oauth_grants(id),
  scope text not null check(fmat.oauth_scope_valid(scope)),
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz
);
create index oauth_refresh_grant_idx on fmat.oauth_refresh_tokens(grant_id);
create unique index oauth_refresh_current_idx on fmat.oauth_refresh_tokens(grant_id) where consumed_at is null;
alter table fmat.oauth_refresh_tokens enable row level security;

-- Match domain lock order: request, host, Auth user/session, then OAuth client,
-- authorization/grant and token. Do not call the registry budgets afterward.
create or replace function fmat.oauth_authority_current(p_grant fmat.oauth_grants)
returns boolean language plpgsql set search_path='' as $$
declare v_request fmat.requests; v_user auth.users; v_session auth.sessions; v_host fmat.hosts; v_now timestamptz;
 v_intake fmat.oauth_intakes; v_bound fmat.oauth_grants; v_auth fmat.oauth_authorizations;
begin
  if p_grant.actor_kind='intake' then
    -- Serialize the mutable pending -> bound lookup before any request/host
    -- lock. Creation and same-browser revocation use this same order.
    select * into v_intake from fmat.oauth_intakes where id=p_grant.actor_id for update;
    if not found or v_intake.grant_id is distinct from p_grant.id or v_intake.host_id is distinct from p_grant.host_id
      or v_intake.authorization_id is distinct from p_grant.authorization_id or v_intake.revoked_at is not null
      then return false;end if;
    select * into v_auth from fmat.oauth_authorizations where id=v_intake.authorization_id;
    if not found or v_auth.decision is distinct from 'grant' or v_auth.client_id is distinct from p_grant.client_id
      or v_auth.browser_hash is distinct from v_intake.browser_hash then return false;end if;
    if v_intake.request_id is null then
      if not fmat.oauth_intake_host_current(v_intake.host_id) then return false;end if;
      return coalesce(v_intake.create_expires_at>clock_timestamp(),false);
    end if;
    v_bound:=p_grant;v_bound.actor_kind:='guest';v_bound.actor_id:=v_intake.request_id;
    v_bound.request_id:=v_intake.request_id;v_bound.token_hash:=v_intake.token_hash;
    return fmat.oauth_authority_current(v_bound);
  end if;
  if p_grant.actor_kind='guest' then
    select * into v_request from fmat.requests where id=p_grant.request_id for update;
    if not found or v_request.host_id is distinct from p_grant.host_id then return false;end if;
  end if;
  select * into v_host from fmat.hosts where id=p_grant.host_id for share;
  if not found or v_host.revoked_at is not null then return false;end if;
  if p_grant.actor_kind='host' then
    select * into v_user from auth.users where id=p_grant.actor_id for share;
    select * into v_session from auth.sessions where id=p_grant.session_id for share;
    v_now:=clock_timestamp();
    return coalesce(p_grant.actor_id=p_grant.host_id and v_user.id=p_grant.actor_id and v_session.user_id=v_user.id
      and v_user.deleted_at is null and v_user.email_confirmed_at is not null and length(v_user.email)>0
      and (v_user.banned_until is null or v_user.banned_until<=v_now)
      and (v_session.not_after is null or v_session.not_after>v_now),false);
  elsif p_grant.actor_kind='guest' then
    v_now:=clock_timestamp();
    return coalesce(p_grant.actor_id=v_request.id and p_grant.token_hash=v_request.token_hash
      and v_request.token_revoked_at is null and v_request.token_expires_at>v_now and v_request.expires_at>v_now
      and v_request.status not in ('booked','declined','withdrawn','expired'),false);
  end if;
  return false;
end$$;

-- Only the verified-browser adapter may supply this credential. Its access JWT
-- must still be fresh at consent; the delegation thereafter uses session state.
create or replace function fmat.oauth_browser_authority(p_credential jsonb)
returns fmat.oauth_grants language plpgsql set search_path='' as $$
declare v_grant fmat.oauth_grants; v_actor jsonb; v_now timestamptz;
begin
  v_actor:=fmat.credential_actor(p_credential);
  v_grant.actor_kind:=v_actor->>'kind';
  if v_grant.actor_kind='host' then
    v_grant.actor_id:=(v_actor->>'id')::uuid;v_grant.host_id:=v_grant.actor_id;
    v_grant.session_id:=(p_credential->>'sessionId')::uuid;
  elsif v_grant.actor_kind='guest' then
    v_grant.actor_id:=(v_actor->>'requestId')::uuid;v_grant.request_id:=v_grant.actor_id;
    v_grant.token_hash:=v_actor->>'tokenHash';
    select host_id into v_grant.host_id from fmat.requests where id=v_grant.request_id;
  else return null;end if;
  if not fmat.oauth_authority_current(v_grant) then return null;end if;
  v_now:=clock_timestamp();v_grant.created_at:=v_now;v_grant.expires_at:=v_now+interval '30 days';
  if v_grant.actor_kind='host' then
    if coalesce((p_credential->>'expiresAt')::timestamptz,v_now)<=v_now then return null;end if;
    select least(v_grant.expires_at,not_after) into v_grant.expires_at from auth.sessions where id=v_grant.session_id;
  else
    select least(v_grant.expires_at,token_expires_at,expires_at) into v_grant.expires_at from fmat.requests where id=v_grant.request_id;
  end if;
  return v_grant;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or raise_exception then return null;
end$$;

create or replace function fmat.oauth_grant_projection(p_grant fmat.oauth_grants)
returns jsonb language sql set search_path='' as $$
  select jsonb_build_object('grantId',p_grant.id,'clientId',p_grant.client_id,'actorKind',p_grant.actor_kind,
    'actorId',p_grant.actor_id,'scope',p_grant.scope,'grantExpiresAt',floor(extract(epoch from p_grant.expires_at))::bigint);
$$;
-- Internal requester projection only, never token identity or authorization.
-- Resolve a binding before domain locks and preserve the original grant for
-- oauth_lock_grant/current-authority checks. Pending intake resolves to null.
create or replace function fmat.oauth_bound_grant(p_grant fmat.oauth_grants)
returns fmat.oauth_grants language plpgsql set search_path='' as $$
declare v_intake fmat.oauth_intakes; v_bound fmat.oauth_grants;
begin
  if p_grant.actor_kind is distinct from 'intake' then return p_grant;end if;
  select * into v_intake from fmat.oauth_intakes where id=p_grant.actor_id for update;
  if not found or v_intake.grant_id is distinct from p_grant.id
    or v_intake.host_id is distinct from p_grant.host_id
    or v_intake.authorization_id is distinct from p_grant.authorization_id
    or v_intake.request_id is null or v_intake.token_hash is null then return null;end if;
  v_bound:=p_grant;v_bound.actor_kind:='guest';v_bound.actor_id:=v_intake.request_id;
  v_bound.request_id:=v_intake.request_id;v_bound.token_hash:=v_intake.token_hash;
  return v_bound;
end$$;
revoke execute on function fmat.oauth_bound_grant(fmat.oauth_grants) from public,anon,authenticated,service_role;

create or replace function fmat.oauth_lock_grant(p_id uuid)
returns fmat.oauth_grants language plpgsql set search_path='' as $$
declare v_grant fmat.oauth_grants; v_client fmat.oauth_clients; v_current boolean;
begin
  select * into v_grant from fmat.oauth_grants where id=p_id;
  if not found then return null;end if;
  v_current:=fmat.oauth_authority_current(v_grant);
  select * into v_client from fmat.oauth_clients where id=v_grant.client_id for share;
  select * into v_grant from fmat.oauth_grants where id=p_id for update;
  if not found then return null;end if;
  if not v_current or v_client.id is null or v_client.disabled_at is not null or v_client.resource<>v_grant.resource
    or v_grant.revoked_at is not null or v_grant.expires_at<=clock_timestamp() or not fmat.oauth_authority_current(v_grant) then
    update fmat.oauth_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id;
    return null;
  end if;
  return v_grant;
end$$;

create or replace function public.fmat_oauth_consent(p_id uuid,p_browser_hash text,p_credential jsonb,p_decision text,p_code_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth fmat.oauth_authorizations; v_client fmat.oauth_clients; v_grant fmat.oauth_grants; v_old fmat.oauth_grants; v_code fmat.oauth_codes; v_now timestamptz;
begin
  if p_decision is null or p_decision not in ('grant','deny') then return '{"error":"invalid_request"}';end if;
  select * into v_auth from fmat.oauth_authorizations where id=p_id;
  if not found or v_auth.browser_hash is distinct from p_browser_hash then return '{"error":"invalid_request"}';end if;
  if 'request:intake'=any(string_to_array(v_auth.scope,' ')) then return '{"error":"invalid_scope"}';end if;
  if p_decision='grant' then
    if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then return '{"error":"invalid_request"}';end if;
    v_grant:=fmat.oauth_browser_authority(p_credential);
    if v_grant.actor_id is null then return '{"error":"invalid_grant"}';end if;
    if (v_grant.actor_kind='host')<>(v_auth.scope like 'host:%') then return '{"error":"invalid_scope"}';end if;
  end if;
  select * into v_client from fmat.oauth_clients where id=v_auth.client_id for share;
  select * into v_auth from fmat.oauth_authorizations where id=p_id for update;
  v_now:=clock_timestamp();
  if not found or v_auth.browser_hash is distinct from p_browser_hash or v_auth.expires_at<=v_now
    or v_client.id is null or v_client.disabled_at is not null or v_client.resource<>v_auth.resource then return '{"error":"invalid_request"}';end if;
  if p_decision='grant' then
    -- Authority may have expired while waiting for the authorization lock.
    if not fmat.oauth_authority_current(v_grant) or v_grant.expires_at<=clock_timestamp()
      or (v_grant.actor_kind='host' and (p_credential->>'expiresAt')::timestamptz<=clock_timestamp()) then return '{"error":"invalid_grant"}';end if;
  end if;
  if v_auth.decision is not null then
    if v_auth.decision<>p_decision then return '{"error":"invalid_request"}';end if;
    if p_decision='grant' then
      select * into v_old from fmat.oauth_grants where authorization_id=p_id;
      select * into v_code from fmat.oauth_codes where grant_id=v_old.id;
      if v_old.actor_kind is distinct from v_grant.actor_kind or v_old.actor_id is distinct from v_grant.actor_id
        or v_old.session_id is distinct from v_grant.session_id or v_old.token_hash is distinct from v_grant.token_hash
        or v_code.token_hash is distinct from p_code_hash or v_old.revoked_at is not null or v_old.expires_at<=clock_timestamp()
        then return '{"error":"invalid_grant"}';end if;
    end if;
    return jsonb_build_object('decision',v_auth.decision,'redirectUri',v_auth.redirect_uri,'state',v_auth.state,'codeExpiresAt',v_code.expires_at);
  end if;
  if p_decision='grant' then
    v_grant.id:=gen_random_uuid();v_grant.authorization_id:=p_id;v_grant.client_id:=v_auth.client_id;
    v_grant.resource:=v_auth.resource;v_grant.scope:=v_auth.scope;
    insert into fmat.oauth_grants select v_grant.*;
    insert into fmat.oauth_codes(token_hash,grant_id,redirect_uri,code_challenge,created_at,expires_at)
      values(p_code_hash,v_grant.id,v_auth.redirect_uri,v_auth.code_challenge,v_now,least(v_now+interval '1 minute',v_grant.expires_at)) returning * into v_code;
  end if;
  update fmat.oauth_authorizations set decision=p_decision,decided_at=v_now where id=p_id;
  return jsonb_build_object('decision',p_decision,'redirectUri',v_auth.redirect_uri,'state',v_auth.state,'codeExpiresAt',v_code.expires_at);
end$$;

create or replace function public.fmat_oauth_code_exchange(p_client_id uuid,p_resource text,p_code_hash text,p_redirect_uri text,p_verifier text,p_refresh_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_code fmat.oauth_codes; v_grant fmat.oauth_grants; v_challenge text;
begin
  if p_refresh_hash is null or p_refresh_hash !~ '^[a-f0-9]{64}$' or p_verifier is null or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' then return '{"error":"invalid_grant"}';end if;
  select * into v_code from fmat.oauth_codes where token_hash=p_code_hash;
  if not found then return '{"error":"invalid_grant"}';end if;
  -- Reject misbinding before locking/revoking any other client's family.
  select * into v_grant from fmat.oauth_grants where id=v_code.grant_id;
  if v_grant.client_id is distinct from p_client_id or v_grant.resource is distinct from p_resource then return '{"error":"invalid_grant"}';end if;
  v_grant:=fmat.oauth_lock_grant(v_code.grant_id);
  select * into v_code from fmat.oauth_codes where token_hash=p_code_hash for update;
  v_challenge:=translate(rtrim(encode(extensions.digest(p_verifier,'sha256'),'base64'),'='),'+/','-_');
  if v_grant.id is null or v_code.consumed_at is not null or v_code.expires_at<=clock_timestamp()
    or v_code.redirect_uri is distinct from p_redirect_uri or v_code.code_challenge<>v_challenge then return '{"error":"invalid_grant"}';end if;
  if v_grant.expires_at<=clock_timestamp() or not fmat.oauth_authority_current(v_grant) then
    update fmat.oauth_grants set revoked_at=clock_timestamp() where id=v_grant.id;return '{"error":"invalid_grant"}';
  end if;
  if p_refresh_hash=p_code_hash or exists(select 1 from fmat.oauth_refresh_tokens where token_hash=p_refresh_hash) then return '{"error":"invalid_request"}';end if;
  update fmat.oauth_codes set consumed_at=clock_timestamp() where token_hash=p_code_hash;
  insert into fmat.oauth_refresh_tokens(token_hash,grant_id,scope) values(p_refresh_hash,v_grant.id,v_grant.scope);
  return fmat.oauth_grant_projection(v_grant);
end$$;

create or replace function public.fmat_oauth_refresh(p_client_id uuid,p_resource text,p_token_hash text,p_next_hash text,p_scope text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token fmat.oauth_refresh_tokens; v_grant fmat.oauth_grants; v_scope text;
begin
  select * into v_token from fmat.oauth_refresh_tokens where token_hash=p_token_hash;
  if not found then return '{"error":"invalid_grant"}';end if;
  select * into v_grant from fmat.oauth_grants where id=v_token.grant_id;
  if v_grant.client_id is distinct from p_client_id or v_grant.resource is distinct from p_resource then return '{"error":"invalid_grant"}';end if;
  v_grant:=fmat.oauth_lock_grant(v_token.grant_id);
  select * into v_token from fmat.oauth_refresh_tokens where token_hash=p_token_hash for update;
  if v_grant.id is null then return '{"error":"invalid_grant"}';end if;
  if v_grant.expires_at<=clock_timestamp() or not fmat.oauth_authority_current(v_grant) then
    update fmat.oauth_grants set revoked_at=clock_timestamp() where id=v_grant.id;return '{"error":"invalid_grant"}';
  end if;
  if v_token.consumed_at is not null then
    -- Return, do not raise: replay revocation must commit even on failure.
    update fmat.oauth_grants set revoked_at=clock_timestamp() where id=v_grant.id;
    return '{"error":"invalid_grant"}';
  end if;
  v_scope:=coalesce(p_scope,v_token.scope);
  if not fmat.oauth_scope_valid(v_scope) or not (string_to_array(v_scope,' ') <@ string_to_array(v_token.scope,' '))
    or not (string_to_array(v_scope,' ') <@ string_to_array(v_grant.scope,' ')) then return '{"error":"invalid_scope"}';end if;
  if p_next_hash is null or p_next_hash !~ '^[a-f0-9]{64}$' or exists(select 1 from fmat.oauth_refresh_tokens where token_hash=p_next_hash) then return '{"error":"invalid_request"}';end if;
  update fmat.oauth_refresh_tokens set consumed_at=clock_timestamp() where token_hash=p_token_hash;
  insert into fmat.oauth_refresh_tokens(token_hash,grant_id,scope) values(p_next_hash,v_grant.id,v_scope);
  update fmat.oauth_grants set scope=v_scope where id=v_grant.id returning * into v_grant;
  return fmat.oauth_grant_projection(v_grant);
end$$;

-- Inputs here are cryptographically verified access claims, not browser JSON.
create or replace function public.fmat_oauth_grant_check(p_id uuid,p_client_id uuid,p_resource text,p_actor_kind text,p_actor_id uuid,p_scope text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_grant fmat.oauth_grants;
begin
  v_grant:=fmat.oauth_lock_grant(p_id);
  if v_grant.id is null or v_grant.client_id is distinct from p_client_id or v_grant.resource is distinct from p_resource
    or v_grant.actor_kind is distinct from p_actor_kind or v_grant.actor_id is distinct from p_actor_id
    or not fmat.oauth_scope_valid(p_scope) or not(string_to_array(p_scope,' ') <@ string_to_array(v_grant.scope,' ')) then return '{"error":"invalid_grant"}';end if;
  -- Preserve the verified token's narrower scope in the authorized result.
  return fmat.oauth_grant_projection(v_grant)||jsonb_build_object('scope',p_scope);
end$$;
create or replace function public.fmat_oauth_grant_revoke(p_id uuid,p_credential jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor fmat.oauth_grants; v_grant fmat.oauth_grants;
begin
  v_actor:=fmat.oauth_browser_authority(p_credential);
  if v_actor.actor_id is null then return '{"error":"invalid_grant"}';end if;
  select * into v_grant from fmat.oauth_grants where id=p_id for update;
  if not found or v_grant.actor_kind is distinct from v_actor.actor_kind or v_grant.actor_id is distinct from v_actor.actor_id then return '{"error":"invalid_grant"}';end if;
  if not fmat.oauth_authority_current(v_actor) or v_actor.expires_at<=clock_timestamp()
    or (v_actor.actor_kind='host' and (p_credential->>'expiresAt')::timestamptz<=clock_timestamp()) then return '{"error":"invalid_grant"}';end if;
  update fmat.oauth_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id;
  return '{"revoked":true}';
end$$;
create or replace function public.fmat_oauth_token_revoke(p_client_id uuid,p_resource text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_grant fmat.oauth_grants;
begin
  select g.* into v_grant from fmat.oauth_grants g join fmat.oauth_refresh_tokens t on t.grant_id=g.id where t.token_hash=p_token_hash;
  if found and v_grant.client_id=p_client_id and v_grant.resource=p_resource then
    -- No authority is granted by revocation; lock only the family, then end.
    update fmat.oauth_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=v_grant.id;
  end if;
  return '{"revoked":true}';
end$$;

revoke all on fmat.oauth_grants,fmat.oauth_codes,fmat.oauth_refresh_tokens from public,anon,authenticated,service_role;
revoke execute on function fmat.oauth_authority_current(fmat.oauth_grants),fmat.oauth_browser_authority(jsonb),fmat.oauth_grant_projection(fmat.oauth_grants),fmat.oauth_lock_grant(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.fmat_oauth_consent(uuid,text,jsonb,text,text),public.fmat_oauth_code_exchange(uuid,text,text,text,text,text),public.fmat_oauth_refresh(uuid,text,text,text,text),public.fmat_oauth_grant_check(uuid,uuid,text,text,uuid,text),public.fmat_oauth_grant_revoke(uuid,jsonb),public.fmat_oauth_token_revoke(uuid,text,text) from public,anon,authenticated;
grant execute on function public.fmat_oauth_consent(uuid,text,jsonb,text,text),public.fmat_oauth_code_exchange(uuid,text,text,text,text,text),public.fmat_oauth_refresh(uuid,text,text,text,text),public.fmat_oauth_grant_check(uuid,uuid,text,text,uuid,text),public.fmat_oauth_grant_revoke(uuid,jsonb),public.fmat_oauth_token_revoke(uuid,text,text) to service_role;
