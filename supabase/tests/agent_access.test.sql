-- Agent access schema: the Data API roles reach none of the new tables, each
-- enables row-level security, and the grant constraints hold (a host grant has
-- no request, a requester grant names a request or is a bootstrap grant, a bound
-- bootstrap grant records when it was bound, a revocation names its reason).
-- Everything runs in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select is_empty(
  $$
    select r.rolname || ' on ' || t.name
    from unnest(array['agent_clients', 'agent_authorization_transactions', 'agent_grants',
                      'agent_authorization_codes', 'agent_refresh_tokens', 'agent_protocol_attempts']) as t(name)
    cross join pg_roles r
    where r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.oid, ('app.' || t.name)::regclass, 'select, insert, update, delete, truncate, references, trigger')
  $$,
  'anon and authenticated hold no privilege on the new tables'
);

select is_empty(
  $$
    select t.name
    from unnest(array['agent_clients', 'agent_authorization_transactions', 'agent_grants',
                      'agent_authorization_codes', 'agent_refresh_tokens', 'agent_protocol_attempts']) as t(name)
    join pg_class c on c.oid = ('app.' || t.name)::regclass
    where not c.relrowsecurity
  $$,
  'every new table enables row-level security'
);

insert into app.host_accounts (id) values ('00000000-0000-4000-8000-0000000000d1');
insert into app.requests (id, host_account_id, state, requester_name, contact_email, expires_at)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'gathering', 'Guest', 'guest@example.test', now() + interval '1 day');
insert into app.agent_clients (id, kind, client_name, redirect_uris)
values ('fmat-cli', 'first_party', 'Find Me a Time CLI', array['http://127.0.0.1/callback']);

select lives_ok(
  $$ insert into app.agent_grants (client_id, role, host_account_id, scopes, resource, source_hash)
     values ('fmat-cli', 'host', '00000000-0000-4000-8000-0000000000d1', array['host:read'], 'http://localhost:3000/mcp', 'x') $$,
  'a host grant binds the host'
);

select throws_ok(
  $$ insert into app.agent_grants (client_id, role, host_account_id, request_id, scopes, resource, source_hash)
     values ('fmat-cli', 'host', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
             array['host:read'], 'http://localhost:3000/mcp', 'x') $$,
  '23514', null, 'a host grant names no request'
);

select throws_ok(
  $$ insert into app.agent_grants (client_id, role, host_account_id, scopes, resource, source_hash)
     values ('fmat-cli', 'requester', '00000000-0000-4000-8000-0000000000d1', array['request:read'], 'http://localhost:3000/dodo/mcp', 'x') $$,
  '23514', null, 'a requester grant names a request unless it is a bootstrap grant'
);

select lives_ok(
  $$ insert into app.agent_grants (client_id, role, host_account_id, bootstrap, scopes, resource, source_hash, expires_at)
     values ('fmat-cli', 'requester', '00000000-0000-4000-8000-0000000000d1', true, array['request:write'],
             'http://localhost:3000/dodo/mcp', 'x', now() + interval '1 day') $$,
  'an unbound bootstrap grant names only the host'
);

select throws_ok(
  $$ insert into app.agent_grants (client_id, role, host_account_id, request_id, bootstrap, scopes, resource, source_hash)
     values ('fmat-cli', 'requester', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1', true,
             array['request:write'], 'http://localhost:3000/dodo/mcp', 'x') $$,
  '23514', null, 'a bound bootstrap grant records when it was bound'
);

select throws_ok(
  $$ insert into app.agent_grants (client_id, role, host_account_id, scopes, resource, source_hash, revoked_at)
     values ('fmat-cli', 'host', '00000000-0000-4000-8000-0000000000d1', array['host:read'], 'http://localhost:3000/mcp', 'x', now()) $$,
  '23514', null, 'a revocation names its reason'
);

select * from finish();

rollback;
