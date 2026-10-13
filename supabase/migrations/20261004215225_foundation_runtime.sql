-- Runtime queue/cron installation is data initialization, outside pg-delta schema diffs.
select fmat.install_runtime();

-- Preserve defaults for future schema objects; pg-delta emits current object ACLs.
revoke all on schema fmat from public, anon, authenticated, service_role;
alter default privileges in schema fmat revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema fmat revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema fmat revoke execute on functions from public, anon, authenticated, service_role;
create extension if not exists pg_net with schema extensions;
