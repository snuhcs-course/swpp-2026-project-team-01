-- Internal OAuth registry and consent attempts. These records confer no
-- application authority; grant issuance is a separate protected operation.
create table fmat.oauth_budgets (
  name text primary key check(name in ('registration','authorization')),
  window_started_at timestamptz not null,
  used integer not null check(used between 0 and 600)
);
alter table fmat.oauth_budgets enable row level security;

create table fmat.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) >= 1 and length(name) <= 120 and name !~ '[[:cntrl:]]'),
  redirect_uris text[] not null check(cardinality(redirect_uris) between 1 and 5),
  resource text not null check(length(resource) between 1 and 2048),
  created_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz,
  authorization_window_at timestamptz,
  authorization_count integer not null default 0 check(authorization_count between 0 and 20)
);
alter table fmat.oauth_clients enable row level security;

create table fmat.oauth_authorizations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references fmat.oauth_clients(id),
  resource text not null,
  redirect_uri text not null,
  scope text not null,
  code_challenge text not null check(code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  state text not null check(length(state) >= 1 and length(state) <= 1024 and state !~ '[[:cntrl:]]'),
  browser_hash text not null check(browser_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  decision text check(decision in ('grant','deny')),
  decided_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '10 minutes'),
  check((decision is null)=(decided_at is null))
);
create index oauth_authorizations_client_idx on fmat.oauth_authorizations(client_id);
alter table fmat.oauth_authorizations enable row level security;

-- Fixed cardinality counters, anchored fixed windows. Call before validation
-- and return errors rather than raising: rejection must commit its budget use.
create or replace function fmat.oauth_take_budget(p_name text)
returns boolean language plpgsql set search_path='' as $$
declare v_row fmat.oauth_budgets; v_now timestamptz; v_limit integer; v_window interval;
begin
  if p_name='registration' then v_limit:=30;v_window:=interval '1 hour';
  elsif p_name='authorization' then v_limit:=600;v_window:=interval '1 minute';
  else raise exception 'INVALID_INPUT';end if;
  insert into fmat.oauth_budgets(name,window_started_at,used) values(p_name,clock_timestamp(),0) on conflict(name) do nothing;
  select * into v_row from fmat.oauth_budgets where name=p_name for update;
  v_now:=clock_timestamp();
  if v_row.window_started_at+v_window<=v_now then
    update fmat.oauth_budgets set window_started_at=v_now,used=1 where name=p_name;return true;
  end if;
  if v_row.used>=v_limit then return false;end if;
  update fmat.oauth_budgets set used=used+1 where name=p_name;
  return true;
end$$;

-- Defense in depth for service-only writes. The protocol adapter additionally
-- uses URL parsing, canonical PKCE checks and exact configured-origin matching.
create or replace function fmat.oauth_redirect_valid(p_uri text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(length(p_uri) between 1 and 2048
    and p_uri !~ '[[:space:][:cntrl:]\\#]'
    and (p_uri ~ '^https://[^/@?#:]+(:[0-9]{1,5})?([/?][^#]*)?$'
      or p_uri ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?([/?][^#]*)?$'),false);
$$;
create or replace function fmat.oauth_scope_valid(p_scope text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(length(p_scope) between 1 and 100
    and p_scope=(select string_agg(s,' ' order by s collate "C") from (select distinct unnest(string_to_array(p_scope,' ')) s) t)
    and (string_to_array(p_scope,' ') <@ array['host:read','host:write','host:decide']
      or string_to_array(p_scope,' ') <@ array['request:intake','request:read','request:write','request:decide']),false);
$$;

create or replace function public.fmat_oauth_register(p_name text,p_redirects text[],p_resource text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client fmat.oauth_clients;
begin
  if not fmat.oauth_take_budget('registration') then return '{"error":"rate_limited"}';end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_name ~ '[[:cntrl:]]'
    or p_redirects is null or cardinality(p_redirects) not between 1 and 5
    or array_ndims(p_redirects)<>1 or array_lower(p_redirects,1)<>1
    or exists(select 1 from unnest(p_redirects) u where not fmat.oauth_redirect_valid(u))
    or (select count(distinct u) from unnest(p_redirects) u)<>cardinality(p_redirects)
    or not fmat.oauth_redirect_valid(p_resource) or p_resource !~ '/mcp$' or p_resource ~ '\?'
    then return '{"error":"invalid_client_metadata"}';end if;
  insert into fmat.oauth_clients(name,redirect_uris,resource) values(btrim(p_name),p_redirects,p_resource) returning * into v_client;
  return jsonb_build_object('clientId',v_client.id,'name',v_client.name,'redirectUris',v_client.redirect_uris,
    'resource',v_client.resource,'createdAt',v_client.created_at);
end$$;

create or replace function public.fmat_oauth_authorization_start(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client fmat.oauth_clients; v_auth fmat.oauth_authorizations; v_now timestamptz; v_intake boolean; v_host uuid;
begin
  if not fmat.oauth_take_budget('authorization') then return '{"error":"rate_limited"}';end if;
  if jsonb_typeof(p_input) is distinct from 'object' then return '{"error":"invalid_request"}';end if;
  if (select count(*) from jsonb_object_keys(p_input)) not in (8,9)
    or not p_input ?& array['clientId','resource','redirectUri','scope','codeChallenge','codeChallengeMethod','state','browserHash']
    or exists(select 1 from jsonb_each(p_input) where jsonb_typeof(value)<>'string')
    or p_input->>'clientId' !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
    then return '{"error":"invalid_request"}';end if;
  if not fmat.oauth_scope_valid(p_input->>'scope') then return '{"error":"invalid_scope"}';end if;
  v_intake:='request:intake'=any(string_to_array(p_input->>'scope',' '));
  if (p_input ? 'handle')<>v_intake or (select count(*) from jsonb_object_keys(p_input))<>(case when v_intake then 9 else 8 end)
    then return '{"error":"invalid_request"}';end if;
  if v_intake then
    if not fmat.valid_public_handle(p_input->>'handle') then return '{"error":"invalid_request"}';end if;
    -- Registry budget -> intake budgets -> public host authority -> client ->
    -- authorization. No path may acquire these budgets after a client lock.
    select id into v_host from fmat.hosts where handle=p_input->>'handle';
    if v_host is null then return '{"error":"invalid_request"}';end if;
    if not fmat.oauth_intake_take_budget(v_host) then return '{"error":"rate_limited"}';end if;
    if not fmat.oauth_intake_host_current(v_host)
      or not exists(select 1 from fmat.hosts where id=v_host and handle=p_input->>'handle')
      then return '{"error":"invalid_request"}';end if;
  end if;
  -- Ordinary registry lock order remains budget, client, authorization.
  select * into v_client from fmat.oauth_clients where id=(p_input->>'clientId')::uuid for update;
  if not found or v_client.disabled_at is not null then return '{"error":"invalid_client"}';end if;
  v_now:=clock_timestamp();
  if v_client.authorization_window_at is null or v_client.authorization_window_at+interval '1 minute'<=v_now then
    update fmat.oauth_clients set authorization_window_at=v_now,authorization_count=1 where id=v_client.id;
  elsif v_client.authorization_count>=20 then return '{"error":"rate_limited"}';
  else update fmat.oauth_clients set authorization_count=authorization_count+1 where id=v_client.id;end if;
  if p_input->>'resource'<>v_client.resource then return '{"error":"invalid_target"}';end if;
  if not (p_input->>'redirectUri'=any(v_client.redirect_uris)) then return '{"error":"invalid_request"}';end if;
  if not fmat.oauth_scope_valid(p_input->>'scope') then return '{"error":"invalid_scope"}';end if;
  if p_input->>'codeChallengeMethod'<>'S256' or p_input->>'codeChallenge' !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
    or length(p_input->>'state') not between 1 and 1024 or p_input->>'state' ~ '[[:cntrl:]]'
    or p_input->>'browserHash' !~ '^[a-f0-9]{64}$'
    then return '{"error":"invalid_request"}';end if;
  insert into fmat.oauth_authorizations(client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at)
    values(v_client.id,v_client.resource,p_input->>'redirectUri',p_input->>'scope',p_input->>'codeChallenge',
      p_input->>'state',p_input->>'browserHash',v_now,v_now+interval '10 minutes') returning * into v_auth;
  if v_intake then
    -- Readiness and time can change while waiting on a client or budget lock.
    if not fmat.oauth_intake_host_current(v_host) then return '{"error":"invalid_request"}';end if;
    insert into fmat.oauth_intakes(authorization_id,host_id,browser_hash)
      values(v_auth.id,v_host,p_input->>'browserHash');
  end if;
  return jsonb_build_object('authorizationId',v_auth.id,'expiresAt',v_auth.expires_at);
end$$;

-- Browser-bound readback only; an authorization ID is never a credential.
-- No underlying host/request data or authority is established by this read.
create or replace function public.fmat_oauth_authorization_read(p_id uuid,p_browser_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth fmat.oauth_authorizations; v_client fmat.oauth_clients;
begin
  select * into v_auth from fmat.oauth_authorizations where id=p_id;
  if not found or p_browser_hash is null or v_auth.browser_hash<>p_browser_hash then return '{"error":"invalid_request"}';end if;
  select * into v_client from fmat.oauth_clients where id=v_auth.client_id for share;
  select * into v_auth from fmat.oauth_authorizations where id=p_id for share;
  if v_client.id is null or v_client.disabled_at is not null or v_auth.expires_at<=clock_timestamp()
    or v_auth.browser_hash<>p_browser_hash then return '{"error":"invalid_request"}';end if;
  return jsonb_build_object('authorizationId',v_auth.id,'clientId',v_client.id,'clientName',v_client.name,
    'redirectUri',v_auth.redirect_uri,'resource',v_auth.resource,'scope',v_auth.scope,'state',v_auth.state,
    'decision',v_auth.decision,'expiresAt',v_auth.expires_at);
end$$;

revoke all on fmat.oauth_budgets,fmat.oauth_clients,fmat.oauth_authorizations from public,anon,authenticated,service_role;
revoke execute on function fmat.oauth_take_budget(text),fmat.oauth_redirect_valid(text),fmat.oauth_scope_valid(text) from public,anon,authenticated,service_role;
revoke execute on function public.fmat_oauth_register(text,text[],text),public.fmat_oauth_authorization_start(jsonb),public.fmat_oauth_authorization_read(uuid,text) from public,anon,authenticated;
grant execute on function public.fmat_oauth_register(text,text[],text),public.fmat_oauth_authorization_start(jsonb),public.fmat_oauth_authorization_read(uuid,text) to service_role;
