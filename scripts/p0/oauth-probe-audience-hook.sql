-- Disposable local P0 probe only. This is not an application migration.
-- It demonstrates a fixed, client-bound audience allowlist using Supabase's
-- official Postgres custom-access-token hook contract.

create schema if not exists p0_probe;

create table if not exists p0_probe.oauth_client_resources (
  client_id uuid primary key,
  resource text not null check (resource = 'http://127.0.0.1:8788/mcp'),
  created_at timestamptz not null default now()
);

revoke all on schema p0_probe from public, anon, authenticated, service_role;
revoke all on all tables in schema p0_probe from public, anon, authenticated, service_role;

grant usage on schema p0_probe to supabase_auth_admin;
grant select on table p0_probe.oauth_client_resources to supabase_auth_admin;

create or replace function p0_probe.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb := event->'claims';
  v_client_id uuid;
  v_resource text;
begin
  -- Current OAuth hook payloads expose client_id at the top level. Reading
  -- the existing claim as a fallback keeps the prototype version-tolerant.
  v_client_id := nullif(
    coalesce(event->>'client_id', event->'claims'->>'client_id'),
    ''
  )::uuid;

  if v_client_id is null then
    return event;
  end if;

  select resource
    into v_resource
    from p0_probe.oauth_client_resources
   where client_id = v_client_id;

  if v_resource is null then
    return event;
  end if;

  v_claims := jsonb_set(v_claims, '{aud}', to_jsonb(v_resource), true);
  return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;

revoke execute on function p0_probe.custom_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function p0_probe.custom_access_token_hook(jsonb)
  to supabase_auth_admin;
