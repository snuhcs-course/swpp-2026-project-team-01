-- The Data API roles can reach nothing the application owns: no table, sequence
-- or function in `app` or `public`, existing or created later by `postgres`.
begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_schema('app', 'the private application schema exists');

select schema_owner_is('app', 'postgres', 'postgres owns the application schema');

select ok(
  not has_schema_privilege('anon', 'app', 'usage') and not has_schema_privilege('authenticated', 'app', 'usage'),
  'anon and authenticated cannot use the application schema'
);

select is_empty(
  $$
    select c.oid::regclass::text
    from pg_class c
    where c.relnamespace = 'app'::regnamespace
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  $$,
  'every application table enables row-level security'
);

select is_empty(
  $$ select tablename::text || '.' || policyname::text from pg_policies where schemaname = 'app' $$,
  'no application table has a policy, so only the owner sees rows'
);

select is_empty(
  $$
    select r.rolname || ' on ' || c.oid::regclass::text
    from pg_class c
    cross join pg_roles r
    where c.relnamespace in ('app'::regnamespace, 'public'::regnamespace)
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and r.rolname in ('anon', 'authenticated')
      and (
        has_table_privilege(r.oid, c.oid, 'select, insert, update, delete, truncate, references, trigger')
        or (c.relkind = 'S' and has_sequence_privilege(r.oid, c.oid, 'usage, select, update'))
      )
  $$,
  'anon and authenticated hold no privilege on existing relations'
);

select is_empty(
  $$
    select r.rolname || ' on ' || p.oid::regprocedure::text
    from pg_proc p
    cross join pg_roles r
    where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
      and r.rolname in ('anon', 'authenticated')
      and has_function_privilege(r.oid, p.oid, 'execute')
  $$,
  'anon and authenticated can execute no existing function'
);

-- Objects created now by postgres inherit the default privileges under test.
create table app.grant_probe (id bigint generated always as identity primary key);
alter table app.grant_probe enable row level security;
insert into app.grant_probe default values;
create function app.grant_probe_fn() returns int language sql as 'select 1';
create table public.grant_probe (id bigint generated always as identity primary key);
alter table public.grant_probe enable row level security;
create function public.grant_probe_fn() returns int language sql as 'select 1';

select ok(
  not has_table_privilege('anon', 'public.grant_probe', 'select, insert, update, delete')
    and not has_table_privilege('authenticated', 'public.grant_probe', 'select, insert, update, delete'),
  'a new public table is not granted to anon or authenticated'
);

select ok(
  not has_sequence_privilege('anon', 'public.grant_probe_id_seq', 'usage, select, update')
    and not has_sequence_privilege('authenticated', 'public.grant_probe_id_seq', 'usage, select, update'),
  'a new public sequence is not granted to anon or authenticated'
);

select ok(
  not has_function_privilege('anon', 'public.grant_probe_fn()', 'execute')
    and not has_function_privilege('authenticated', 'public.grant_probe_fn()', 'execute'),
  'a new public function is not executable by anon or authenticated'
);

select ok(
  not has_function_privilege('anon', 'app.grant_probe_fn()', 'execute')
    and not has_function_privilege('authenticated', 'app.grant_probe_fn()', 'execute'),
  'a new application function is not executable by anon or authenticated'
);

set local role anon;

select throws_ok('select * from app.grant_probe', '42501', null, 'anon cannot read an application table');
select throws_ok('select app.grant_probe_fn()', '42501', null, 'anon cannot call an application function');
select throws_ok('select * from public.grant_probe', '42501', null, 'anon cannot read a new public table');
select throws_ok('select public.grant_probe_fn()', '42501', null, 'anon cannot call a new public function');

select throws_ok('select * from app.command_outcomes', '42501', null, 'anon cannot read saved command outcomes');
select throws_ok('select * from app.jobs', '42501', null, 'anon cannot read jobs');
select throws_ok('select * from app.agent_sessions', '42501', null, 'anon cannot read the session index');
select throws_ok('select * from app.model_reservations', '42501', null, 'anon cannot read model reservations');
select throws_ok($$select * from app.claim_jobs('production', array['any'], 'x', 1, 60)$$, '42501', null, 'anon cannot claim jobs');

reset role;
set local role authenticated;

select throws_ok('select * from app.command_outcomes', '42501', null, 'authenticated cannot read saved command outcomes');
select throws_ok('select * from app.jobs', '42501', null, 'authenticated cannot read jobs');
select throws_ok('select * from app.agent_sessions', '42501', null, 'authenticated cannot read the session index');
select throws_ok('select * from app.model_reservations', '42501', null, 'authenticated cannot read model reservations');
select throws_ok($$select * from app.claim_jobs('production', array['any'], 'x', 1, 60)$$, '42501', null, 'authenticated cannot claim jobs');

select throws_ok('select * from app.grant_probe', '42501', null, 'authenticated cannot read an application table');
select throws_ok('select app.grant_probe_fn()', '42501', null, 'authenticated cannot call an application function');
select throws_ok('select public.grant_probe_fn()', '42501', null, 'authenticated cannot call a new public function');

reset role;

select * from finish();
rollback;
