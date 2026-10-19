-- The Data API roles cannot read Vault, which holds the worker URL and secret
-- the pg_net wake-up sends.
--
-- pg_net's own tables (net.http_request_queue, net._http_response) are granted
-- to PUBLIC by the platform role supabase_admin, which `postgres` cannot revoke.
-- They stay unreachable because `net` is outside the Data API's schemas and
-- anon and authenticated can execute no application function; the integration
-- suite tests/integration/data-api-exposure.test.ts checks that boundary.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select ok(
  not has_table_privilege('anon', 'vault.decrypted_secrets', 'select')
    and not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select'),
  'anon and authenticated have no select on vault.decrypted_secrets'
);
select ok(
  not has_table_privilege('anon', 'vault.secrets', 'select')
    and not has_table_privilege('authenticated', 'vault.secrets', 'select'),
  'anon and authenticated have no select on vault.secrets'
);

set local role anon;
select throws_ok('select * from vault.decrypted_secrets', '42501', null, 'anon cannot read decrypted secrets');
select throws_ok('select * from vault.secrets', '42501', null, 'anon cannot read stored secrets');
reset role;

set local role authenticated;
select throws_ok('select * from vault.decrypted_secrets', '42501', null, 'authenticated cannot read decrypted secrets');
select throws_ok('select * from vault.secrets', '42501', null, 'authenticated cannot read stored secrets');
reset role;

select * from finish();
rollback;
