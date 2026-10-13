-- Private staging state for one future request. No public RPC creates or grants
-- this authority yet; OAuth activation must attach a matching intake grant.
create table fmat.oauth_intakes (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null unique references fmat.oauth_authorizations(id),
  host_id uuid not null references fmat.hosts(id),
  reserved_request_id uuid not null unique default gen_random_uuid(),
  browser_hash text not null check(browser_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  grant_id uuid unique references fmat.oauth_grants(id),
  granted_at timestamptz,
  create_expires_at timestamptz,
  request_id uuid references fmat.requests(id),
  token_hash text check(token_hash ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz,
  revoked_at timestamptz,
  constraint oauth_intake_grant_state check(
    (grant_id is null and granted_at is null and create_expires_at is null)
    or (grant_id is not null and granted_at is not null and create_expires_at is not null
      and granted_at>=created_at and create_expires_at=granted_at+interval '15 minutes')),
  constraint oauth_intake_request_state check(
    (request_id is null and token_hash is null and bound_at is null)
    or (request_id is not null and token_hash is not null and bound_at is not null
      and grant_id is not null and request_id=reserved_request_id
      and bound_at>=granted_at and bound_at<create_expires_at))
);
create index oauth_intakes_host_idx on fmat.oauth_intakes(host_id);
create index oauth_intakes_request_idx on fmat.oauth_intakes(request_id);
alter table fmat.oauth_intakes enable row level security;

-- A fixed service row plus at most one row for each admitted host used by this
-- helper. No caller-supplied arbitrary budget keys are accepted.
create table fmat.oauth_intake_budgets (
  bucket text primary key check(bucket='service' or bucket ~ '^host:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  window_started_at timestamptz not null,
  used integer not null check(used between 0 and 300)
);
alter table fmat.oauth_intake_budgets enable row level security;

-- Lock before client/authorization/grant locks. Returns rather than raises on
-- exhaustion. A later failing operation must return an error if admission usage
-- is meant to persist; a transaction rollback also rolls back its reservations.
create or replace function fmat.oauth_intake_take_budget(p_host_id uuid)
returns boolean language plpgsql set search_path='' as $$
declare v_service fmat.oauth_intake_budgets; v_host fmat.oauth_intake_budgets;
 v_bucket text; v_now timestamptz;
begin
  if p_host_id is null or not exists(select 1 from fmat.hosts where id=p_host_id) then return false;end if;
  v_bucket:='host:'||p_host_id;
  insert into fmat.oauth_intake_budgets values('service',clock_timestamp(),0) on conflict do nothing;
  select * into v_service from fmat.oauth_intake_budgets where bucket='service' for update;
  insert into fmat.oauth_intake_budgets values(v_bucket,clock_timestamp(),0) on conflict do nothing;
  select * into v_host from fmat.oauth_intake_budgets where bucket=v_bucket for update;
  v_now:=clock_timestamp();
  if v_service.window_started_at+interval '1 hour'<=v_now then
    v_service.window_started_at:=v_now;v_service.used:=0;
  end if;
  if v_host.window_started_at+interval '1 hour'<=v_now then
    v_host.window_started_at:=v_now;v_host.used:=0;
  end if;
  if v_service.used>=300 or v_host.used>=30 then return false;end if;
  update fmat.oauth_intake_budgets set window_started_at=v_service.window_started_at,used=v_service.used+1 where bucket='service';
  update fmat.oauth_intake_budgets set window_started_at=v_host.window_started_at,used=v_host.used+1 where bucket=v_bucket;
  return true;
end$$;

-- Enforce one-way transitions independently of the future RPC implementation.
-- This trigger does not authorize a mutation or replace fresh authority checks.
create or replace function fmat.oauth_intake_preserve_binding()
returns trigger language plpgsql set search_path='' as $$
declare v_auth fmat.oauth_authorizations; v_grant fmat.oauth_grants; v_request fmat.requests;
begin
  if tg_op='UPDATE' then
    if row(new.id,new.authorization_id,new.host_id,new.reserved_request_id,new.browser_hash,new.created_at)
      is distinct from row(old.id,old.authorization_id,old.host_id,old.reserved_request_id,old.browser_hash,old.created_at)
      or (old.grant_id is not null and row(new.grant_id,new.granted_at,new.create_expires_at)
        is distinct from row(old.grant_id,old.granted_at,old.create_expires_at))
      or (old.request_id is not null and row(new.request_id,new.token_hash,new.bound_at)
        is distinct from row(old.request_id,old.token_hash,old.bound_at))
      or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
      or (old.revoked_at is not null and row(new.grant_id,new.request_id) is distinct from row(old.grant_id,old.request_id))
      then raise exception 'INTAKE_BINDING_IMMUTABLE';end if;
  end if;
  -- Recheck identity on creation/attachment, not on revocation: lost authority
  -- must never prevent its own revocation, nor resurrect a rotated request.
  if tg_op='INSERT' then
    select * into v_auth from fmat.oauth_authorizations where id=new.authorization_id;
    if not found or v_auth.browser_hash is distinct from new.browser_hash
      then raise exception 'INVALID_INTAKE_BINDING';end if;
  end if;
  if new.grant_id is not null and (tg_op='INSERT' or old.grant_id is null) then
    select * into v_grant from fmat.oauth_grants where id=new.grant_id;
    if not found or v_grant.actor_kind<>'intake' or v_grant.actor_id<>new.id
      or v_grant.host_id<>new.host_id or v_grant.authorization_id<>new.authorization_id
      then raise exception 'INVALID_INTAKE_BINDING';end if;
  end if;
  if new.request_id is not null and (tg_op='INSERT' or old.request_id is null) then
    select * into v_request from fmat.requests where id=new.request_id;
    if not found or v_request.host_id<>new.host_id or v_request.token_hash<>new.token_hash
      then raise exception 'INVALID_INTAKE_BINDING';end if;
  end if;
  return new;
end$$;
create trigger oauth_intake_binding_guard before insert or update on fmat.oauth_intakes
for each row execute function fmat.oauth_intake_preserve_binding();

revoke all on fmat.oauth_intakes,fmat.oauth_intake_budgets from public,anon,authenticated,service_role;
revoke execute on function fmat.oauth_intake_take_budget(uuid),fmat.oauth_intake_preserve_binding() from public,anon,authenticated,service_role;
