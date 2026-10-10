-- The database adapter is service-only. The HTTP protocol continues to reject
-- intake scopes until its token and consent integration is deployed.
create or replace function fmat.oauth_intake_host_current(p_host_id uuid)
returns boolean language plpgsql set search_path='' as $$
declare v_user auth.users; v_host fmat.hosts; v_connection fmat.calendar_connections;
begin
  -- Same public-readiness order as public intake: Auth user, host, connection.
  select * into v_user from auth.users where id=p_host_id for share;
  select * into v_host from fmat.hosts where id=p_host_id for share;
  select * into v_connection from fmat.calendar_connections where principal_kind='host' and principal_id=p_host_id and revoked_at is null for share;
  return coalesce(v_user.id is not null and v_host.id is not null and v_connection.id is not null
    and v_user.deleted_at is null and v_user.email_confirmed_at is not null
    and (v_user.banned_until is null or v_user.banned_until<=clock_timestamp()) and fmat.host_ready(v_host),false);
end$$;

create or replace function public.fmat_oauth_intake_consent(p_id uuid,p_browser_hash text,p_decision text,p_code_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_intake fmat.oauth_intakes; v_auth fmat.oauth_authorizations; v_client fmat.oauth_clients;
 v_grant fmat.oauth_grants; v_code fmat.oauth_codes; v_now timestamptz;
begin
  if p_decision is null or p_decision not in ('grant','deny') then return '{"error":"invalid_request"}';end if;
  if p_decision='grant' and (p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$') then return '{"error":"invalid_request"}';end if;
  select * into v_intake from fmat.oauth_intakes where authorization_id=p_id for update;
  if not found or v_intake.browser_hash is distinct from p_browser_hash or v_intake.revoked_at is not null then return '{"error":"invalid_request"}';end if;
  if p_decision='grant' then
    if v_intake.grant_id is not null then
      v_grant:=fmat.oauth_lock_grant(v_intake.grant_id);
      if v_grant.id is null then return '{"error":"invalid_grant"}';end if;
    elsif not fmat.oauth_intake_host_current(v_intake.host_id) then return '{"error":"invalid_grant"}';end if;
  end if;
  select * into v_auth from fmat.oauth_authorizations where id=p_id;
  select * into v_client from fmat.oauth_clients where id=v_auth.client_id for share;
  select * into v_auth from fmat.oauth_authorizations where id=p_id for update;
  v_now:=clock_timestamp();
  if not found or v_auth.browser_hash is distinct from p_browser_hash or v_auth.expires_at<=v_now
    or v_client.id is null or v_client.disabled_at is not null or v_client.resource<>v_auth.resource
    or not fmat.oauth_scope_valid(v_auth.scope) or not ('request:intake'=any(string_to_array(v_auth.scope,' ')))
    then return '{"error":"invalid_request"}';end if;
  if v_auth.decision is not null then
    if v_auth.decision<>p_decision then return '{"error":"invalid_request"}';end if;
    if p_decision='grant' then
      select * into v_code from fmat.oauth_codes where grant_id=v_grant.id;
      if v_code.token_hash is distinct from p_code_hash or v_code.consumed_at is not null or v_code.expires_at<=clock_timestamp()
        or not fmat.oauth_authority_current(v_grant) or v_grant.expires_at<=clock_timestamp()
        then return '{"error":"invalid_grant"}';end if;
    end if;
    return jsonb_build_object('decision',v_auth.decision,'redirectUri',v_auth.redirect_uri,'state',v_auth.state,'codeExpiresAt',v_code.expires_at);
  end if;
  if p_decision='grant' then
    if not fmat.oauth_intake_host_current(v_intake.host_id) then return '{"error":"invalid_grant"}';end if;
    v_now:=clock_timestamp();
    insert into fmat.oauth_grants(authorization_id,client_id,resource,scope,actor_kind,actor_id,host_id,created_at,expires_at)
      values(p_id,v_client.id,v_auth.resource,v_auth.scope,'intake',v_intake.id,v_intake.host_id,v_now,v_now+interval '30 days') returning * into v_grant;
    update fmat.oauth_intakes set grant_id=v_grant.id,granted_at=v_now,create_expires_at=v_now+interval '15 minutes' where id=v_intake.id;
    insert into fmat.oauth_codes(token_hash,grant_id,redirect_uri,code_challenge,created_at,expires_at)
      values(p_code_hash,v_grant.id,v_auth.redirect_uri,v_auth.code_challenge,v_now,v_now+interval '1 minute') returning * into v_code;
  end if;
  update fmat.oauth_authorizations set decision=p_decision,decided_at=v_now where id=p_id;
  return jsonb_build_object('decision',p_decision,'redirectUri',v_auth.redirect_uri,'state',v_auth.state,'codeExpiresAt',v_code.expires_at);
end$$;

-- Explicit same-browser revocation remains available after attempt expiry and
-- request closure. It confers no read authority and never restores a request.
create or replace function public.fmat_oauth_intake_revoke(p_id uuid,p_browser_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_intake fmat.oauth_intakes;
begin
  select * into v_intake from fmat.oauth_intakes where authorization_id=p_id for update;
  if not found or v_intake.browser_hash is distinct from p_browser_hash then return '{"error":"invalid_grant"}';end if;
  update fmat.oauth_intakes set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=v_intake.id;
  if v_intake.grant_id is not null then
    update fmat.oauth_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=v_intake.grant_id;
  end if;
  return '{"revoked":true}';
end$$;

-- The initiating browser may inspect only its own pending target. Returning a
-- public profile and stage never returns the reserved request or its proof.
create or replace function public.fmat_oauth_intake_read(p_id uuid,p_browser_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_intake fmat.oauth_intakes; v_grant fmat.oauth_grants; v_host fmat.hosts; v_auth jsonb;
begin
  select * into v_intake from fmat.oauth_intakes where authorization_id=p_id for update;
  if not found or v_intake.browser_hash is distinct from p_browser_hash or v_intake.revoked_at is not null then return '{"error":"invalid_request"}';end if;
  if v_intake.grant_id is null then
    if not fmat.oauth_intake_host_current(v_intake.host_id) then return '{"error":"invalid_grant"}';end if;
  else
    v_grant:=fmat.oauth_lock_grant(v_intake.grant_id);
    if v_grant.id is null then return '{"error":"invalid_grant"}';end if;
  end if;
  v_auth:=public.fmat_oauth_authorization_read(p_id,p_browser_hash);
  if v_auth ? 'error' then return v_auth;end if;
  select * into v_host from fmat.hosts where id=v_intake.host_id;
  if v_intake.grant_id is null then
    if not fmat.oauth_intake_host_current(v_intake.host_id) then return '{"error":"invalid_grant"}';end if;
  elsif not fmat.oauth_authority_current(v_grant) or v_grant.expires_at<=clock_timestamp() then return '{"error":"invalid_grant"}';end if;
  return v_auth||jsonb_build_object('intake',jsonb_build_object('state',case when v_intake.request_id is null then 'pending' else 'bound' end,
    'profile',jsonb_build_object('handle',v_host.handle,'displayName',v_host.display_name,'timezone',v_host.rules->>'timezone','durationMinutes',v_host.rules->'durationMinutes')));
end$$;

revoke execute on function fmat.oauth_intake_host_current(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.fmat_oauth_intake_consent(uuid,text,text,text),public.fmat_oauth_intake_revoke(uuid,text),public.fmat_oauth_intake_read(uuid,text) from public,anon,authenticated;
grant execute on function public.fmat_oauth_intake_consent(uuid,text,text,text),public.fmat_oauth_intake_revoke(uuid,text),public.fmat_oauth_intake_read(uuid,text) to service_role;
