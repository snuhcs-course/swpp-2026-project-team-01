begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('ac000000-0000-4000-8000-000000000001','intake-state1@example.test',now()),
('ac000000-0000-4000-8000-000000000002','intake-state2@example.test',now());
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by)
select ('ac100000-0000-4000-8000-00000000000'||n)::uuid,'intake-state'||n||'@example.test',repeat(n::text,64),now()+interval '1 day','intake-state-test' from generate_series(1,2) n;
insert into fmat.hosts(id,email,invitation_id)
select ('ac000000-0000-4000-8000-00000000000'||n)::uuid,'intake-state'||n||'@example.test',('ac100000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,2) n;
create temporary table fixture(client_id uuid,authorization_id uuid,intake_id uuid);
insert into fixture select (public.fmat_oauth_register('intake fixture',array['https://client.example/cb'],'https://release.findmeatime.com/mcp')->>'clientId')::uuid,null,null;
-- Staging schema only: intake authorization requires an explicit host target.
select is(public.fmat_oauth_authorization_start(jsonb_build_object('clientId',client_id,'resource','https://release.findmeatime.com/mcp','redirectUri','https://client.example/cb','scope','request:intake','codeChallenge',repeat('A',43),'codeChallengeMethod','S256','state','s','browserHash',repeat('a',64)))->>'error','invalid_request','intake scope without a host target is rejected') from fixture;
-- Private fixture authorizations are inert: no code or grant is issued.
with a as (
 insert into fmat.oauth_authorizations(client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at)
 select client_id,'https://release.findmeatime.com/mcp','https://client.example/cb','request:intake request:read',repeat('A',43),'s',repeat('a',64),clock_timestamp(),clock_timestamp()+interval '9 minutes' from fixture returning id
) update fixture set authorization_id=(select id from a);
with i as (
 insert into fmat.oauth_intakes(authorization_id,host_id,browser_hash)
 select authorization_id,'ac000000-0000-4000-8000-000000000001',repeat('a',64) from fixture returning id
) update fixture set intake_id=(select id from i);
select ok((select request_id is null and grant_id is null and token_hash is null from fmat.oauth_intakes),'staging creates no request or grant authority');
select is((select count(*)::int from fmat.requests),0,'no fake request for consent');
select is((select count(*)::int from fmat.oauth_grants),0,'no implicit grant');
select throws_ok($$update fmat.oauth_intakes set host_id='ac000000-0000-4000-8000-000000000002'$$,'P0001','INTAKE_BINDING_IMMUTABLE','host cannot change');
select throws_ok($$update fmat.oauth_intakes set reserved_request_id=gen_random_uuid()$$,'P0001','INTAKE_BINDING_IMMUTABLE','reserved request cannot change');
select throws_ok($$update fmat.oauth_intakes set browser_hash=repeat('b',64)$$,'P0001','INTAKE_BINDING_IMMUTABLE','browser binding cannot change');
select throws_ok($$update fmat.oauth_intakes set authorization_id=gen_random_uuid()$$,'P0001','INTAKE_BINDING_IMMUTABLE','authorization cannot change');
select throws_ok($$update fmat.oauth_intakes set created_at=created_at+interval '1 day'$$,'P0001','INTAKE_BINDING_IMMUTABLE','creation time cannot move');
select throws_ok($$insert into fmat.oauth_intakes(authorization_id,host_id,browser_hash) select authorization_id,'ac000000-0000-4000-8000-000000000001',repeat('b',64) from fixture$$,'P0001','INVALID_INTAKE_BINDING','copied authorization cannot bind another browser');
select throws_ok($$update fmat.oauth_intakes set grant_id=gen_random_uuid(),granted_at=clock_timestamp(),create_expires_at=clock_timestamp()+interval '15 minutes'$$,'P0001','INVALID_INTAKE_BINDING','nonexistent grant cannot attach');
select throws_ok($$update fmat.oauth_intakes set granted_at=clock_timestamp()$$,'23514',null,'partial grant state rejected');
select throws_ok($$update fmat.oauth_intakes set token_hash=repeat('c',64)$$,'23514',null,'partial bound request state rejected');
update fmat.oauth_intakes set revoked_at=clock_timestamp();
select throws_ok($$update fmat.oauth_intakes set revoked_at=null$$,'P0001','INTAKE_BINDING_IMMUTABLE','revocation cannot be removed');
select throws_ok($$update fmat.oauth_intakes set revoked_at=clock_timestamp()+interval '1 hour'$$,'P0001','INTAKE_BINDING_IMMUTABLE','revocation cannot be postponed');
select throws_ok($$update fmat.oauth_intakes set grant_id=gen_random_uuid()$$,'P0001','INTAKE_BINDING_IMMUTABLE','revoked state cannot gain a grant');
select ok((select relrowsecurity from pg_class where oid=('fmat.'||t)::regclass),t||' RLS enabled') from unnest(array['oauth_intakes','oauth_intake_budgets']) t;
select ok(not has_table_privilege(r,'fmat.'||t,'select,insert,update,delete'),r||' has no direct access to '||t)
from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['oauth_intakes','oauth_intake_budgets']) t;
select ok(not has_function_privilege(r,'fmat.'||f,'execute'),r||' cannot call private '||f)
from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['oauth_intake_take_budget(uuid)','oauth_intake_preserve_binding()']) f;
select is(fmat.oauth_intake_take_budget(null),false,'null host cannot allocate budget');
select is(fmat.oauth_intake_take_budget(gen_random_uuid()),false,'unknown host cannot allocate budget');
select is((select count(*)::int from fmat.oauth_intake_budgets),0,'invalid subjects allocate no counter rows');
select is((select count(*)::int from generate_series(1,30) where fmat.oauth_intake_take_budget('ac000000-0000-4000-8000-000000000001')),30,'thirty host admissions allowed');
select is(fmat.oauth_intake_take_budget('ac000000-0000-4000-8000-000000000001'),false,'thirty-first host admission denied');
select is((select used from fmat.oauth_intake_budgets where bucket='service'),30,'denied admission does not charge service');
select is(fmat.oauth_intake_take_budget('ac000000-0000-4000-8000-000000000002'),true,'host limits are separate');
update fmat.oauth_intake_budgets set used=300 where bucket='service';
select is(fmat.oauth_intake_take_budget('ac000000-0000-4000-8000-000000000002'),false,'aggregate ceiling applies across hosts');
select is((select used from fmat.oauth_intake_budgets where bucket='host:ac000000-0000-4000-8000-000000000002'),1,'global denial does not charge host');
update fmat.oauth_intake_budgets set window_started_at=clock_timestamp()-interval '61 minutes' where bucket='service';
select is(fmat.oauth_intake_take_budget('ac000000-0000-4000-8000-000000000001'),false,'service rollover does not reset a current host window');
update fmat.oauth_intake_budgets set window_started_at=clock_timestamp()-interval '61 minutes' where bucket like 'host:%';
select is(fmat.oauth_intake_take_budget('ac000000-0000-4000-8000-000000000001'),true,'expired independent windows roll over');
select is((select used from fmat.oauth_intake_budgets where bucket='service'),1,'fresh service window starts with one');
select is((select used from fmat.oauth_intake_budgets where bucket='host:ac000000-0000-4000-8000-000000000001'),1,'fresh host window starts with one');
savepoint budget_rollback;
select is(fmat.oauth_intake_take_budget('ac000000-0000-4000-8000-000000000001'),true,'budget reservation participates in caller transaction');
rollback to savepoint budget_rollback;
select is((select used from fmat.oauth_intake_budgets where bucket='service'),1,'rollback restores service counter');
select is((select used from fmat.oauth_intake_budgets where bucket='host:ac000000-0000-4000-8000-000000000001'),1,'rollback restores host counter');
-- An actual existing-request grant is not a substitute for intake consent.
insert into fmat.requests(id,host_id,details,token_hash,expires_at)
values('ac200000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001','{}',repeat('e',64),clock_timestamp()+interval '1 day');
insert into fmat.oauth_grants(authorization_id,client_id,resource,scope,actor_kind,actor_id,host_id,request_id,token_hash,created_at,expires_at)
select authorization_id,client_id,'https://release.findmeatime.com/mcp','request:read','guest','ac200000-0000-4000-8000-000000000001',
'ac000000-0000-4000-8000-000000000001','ac200000-0000-4000-8000-000000000001',repeat('e',64),clock_timestamp(),clock_timestamp()+interval '1 hour' from fixture;
-- INSERT takes the attachment-validation path without undoing the earlier
-- revocation fixture. It must reject the actor before any uniqueness check.
select throws_ok($$insert into fmat.oauth_intakes(authorization_id,host_id,browser_hash,grant_id,granted_at,create_expires_at)
select authorization_id,host_id,repeat('a',64),id,statement_timestamp(),statement_timestamp()+interval '15 minutes' from fmat.oauth_grants$$,
'P0001','INVALID_INTAKE_BINDING','existing requester grant cannot attach as intake authority');
select * from finish();
rollback;
