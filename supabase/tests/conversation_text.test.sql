begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Isolate this rollback-only test from local browser fixture service usage.
delete from fmat.conversation_budgets where name='service';

insert into auth.users(id,email,email_confirmed_at) values
('80000000-0000-4000-8000-000000000001','one@access.test',now()),
('80000000-0000-4000-8000-000000000002','two@access.test',now()),
('80000000-0000-4000-8000-000000000003','unadmitted@access.test',now());
insert into auth.sessions(id,user_id) values
('81000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001'),
('81000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002'),
('81000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003');
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values
('82000000-0000-4000-8000-000000000001','one@access.test',repeat('1',64),now()+interval '1 day','fixture'),
('82000000-0000-4000-8000-000000000002','two@access.test',repeat('2',64),now()+interval '1 day','fixture');
insert into fmat.hosts(id,email,invitation_id) values
('80000000-0000-4000-8000-000000000001','one@access.test','82000000-0000-4000-8000-000000000001'),
('80000000-0000-4000-8000-000000000002','two@access.test','82000000-0000-4000-8000-000000000002');
insert into fmat.requests(id,host_id,details,token_hash,expires_at) values
('83000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','{}',repeat('a',64),now()+interval '1 day'),
('83000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','{}',repeat('b',64),now()+interval '1 day');
create temporary table fixture(name text primary key,value jsonb);
insert into fixture select 'host'||n,jsonb_build_object('kind','host','subject','80000000-0000-4000-8000-00000000000'||n,
  'sessionId','81000000-0000-4000-8000-00000000000'||n,'expiresAt',now()+interval '1 hour','email','spoofed@attacker.test') from generate_series(1,3) n;
insert into fixture values
('guest1','{"kind":"guest","requestId":"83000000-0000-4000-8000-000000000001","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'),
('guest2','{"kind":"guest","requestId":"83000000-0000-4000-8000-000000000002","tokenHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');
create function pg_temp.f(text) returns jsonb language sql as $$select value from fixture where name=$1$$;
create function pg_temp.access(text,text,jsonb) returns jsonb language sql as $$select public.fmat_conversation_access($1,pg_temp.f($2),$3)$$;
create function pg_temp.check_grant(text) returns jsonb language sql as $$select public.fmat_conversation_check((pg_temp.f($1)->>'grantId')::uuid,(pg_temp.f($1)->>'conversationId')::uuid)$$;


insert into fixture values
('setup',pg_temp.access('open','host1','{"audience":"host_setup"}')),
('shared',pg_temp.access('open','host1','{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}')),
('guest',pg_temp.access('open','guest1','{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}')),
('other',pg_temp.access('open','host2','{"audience":"host_setup"}'));
create function pg_temp.accept(text,uuid default gen_random_uuid(),text default 'hello') returns jsonb language sql as $$
 select public.fmat_runtime_message('accept',(pg_temp.f($1)->>'grantId')::uuid,(pg_temp.f($1)->>'conversationId')::uuid,jsonb_build_object('clientId',$2,'text',$3))
$$;

create temporary table text_cases(input text,expected text);
insert into text_cases values
('code=a code=abc','[x] [x]'),
('https://example.test/#token=a https://example.test/#token=abc','https://example.test/#[x] https://example.test/#[x]'),
('Meet October 6 at 14:00 in Seoul. Bearer syntheticjwt','Meet October 6 at 14:00 in Seoul. [x]'),
('서울에서 화요일 14:00, Asia/Seoul. code=synthetic 안녕하세요','서울에서 화요일 14:00, Asia/Seoul. [x] 안녕하세요'),
('https://example.test/path?view=week&code=synthetic&day=6#token=hidden','https://example.test/path?view=week&[x]&day=6#[x]'),
('https://example.test/?access_%74O%6bEN=hidden&view=day','https://example.test/?[x]&view=day'),
('https://example.test/#%69Message/hidden','https://example.test/#[x]'),
('https://example.test/?day=6&view=week#agenda','https://example.test/?day=6&view=week#agenda'),
('The code review is next Tuesday; state your timezone.','The code review is next Tuesday; state your timezone.'),
('TOKEN=a code=b STATE=c secret=d proof=e recovery=f invitation=g credential=h','[x] [x] [x] [x] [x] [x] [x] [x]'),
('Bearer abc.DEF_ghi-~+/== bearer another-secret','[x] [x]'),
('LINK 84000000-0000-4000-8000-000000000001 '||repeat('x',64)||' then meet','[x] then meet'),
('link 84000000-0000-4000-8000-000000000001 '||repeat('x',200),'[x]'),
('[x] token=one token=two [x]','[x] [x] [x] [x]'),
('  Plain scheduling text 👋  ','  Plain scheduling text 👋  '),
('https://example.test/?%00view=week#section-2','https://example.test/?%00view=week#section-2'),
(repeat('code= ',1666)||'time',repeat('[x] ',1666)||'time');
select is(fmat.protect_conversation_text(input),expected,'recognized grammar retains surrounding context, case '||row_number() over()) from text_cases;
select is(fmat.protect_conversation_text(expected),expected,'protection is idempotent, case '||row_number() over()) from text_cases;
select is(fmat.protect_conversation_text(repeat('한',10000)),repeat('한',10000),'maximum multilingual text preserved');
select throws_ok($$select fmat.protect_conversation_text(repeat('x',10001))$$,'P0001','INVALID_INPUT','protection is bounded');
select ok(not has_function_privilege('service_role','fmat.protect_conversation_text(text)','EXECUTE'),'protection helper is private');
select ok(not has_table_privilege('service_role','fmat.runtime_messages','SELECT'),'digest cannot be read directly through Data API');

insert into fixture values ('protectedInput',jsonb_build_object('clientId','84000000-0000-4000-8000-000000000001','text','Meet in Seoul. Bearer synthetic-secret'));
create function pg_temp.message(text,jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_runtime_message($1,(pg_temp.f('setup')->>'grantId')::uuid,(pg_temp.f('setup')->>'conversationId')::uuid,$2)
$$;
insert into fixture values ('receipt',pg_temp.message('accept',pg_temp.f('protectedInput')));
select is(pg_temp.f('receipt')->>'text','Meet in Seoul. [x]','canonical admission removes credential');
select ok(not(pg_temp.f('receipt') ? 'input_fingerprint'),'receipt omits digest');
select is((select text from fmat.runtime_messages where id=(pg_temp.f('receipt')->>'id')::uuid),'Meet in Seoul. [x]','ledger never stores newly submitted plaintext');
select is((select input_fingerprint from fmat.runtime_messages where id=(pg_temp.f('receipt')->>'id')::uuid),
 fmat.conversation_input_fingerprint((pg_temp.f('setup')->>'conversationId')::uuid,(pg_temp.f('setup')->>'grantId')::uuid,
 '84000000-0000-4000-8000-000000000001',pg_temp.f('protectedInput')->>'text'),'ledger stores original exact scoped digest');
select is(pg_temp.message('accept',pg_temp.f('protectedInput')),pg_temp.f('receipt'),'exact retry returns protected receipt');
select throws_ok($$select pg_temp.message('accept',pg_temp.f('protectedInput')||'{"text":"Meet in Seoul. Bearer other-secret"}')$$,'P0001','IDEMPOTENCY_CONFLICT','changed secret conflicts although protected text is equal');
select throws_ok($$select pg_temp.message('accept',pg_temp.f('protectedInput')||'{"text":"Meet in Seoul. [x]"}')$$,'P0001','IDEMPOTENCY_CONFLICT','protected text is not a substitute retry credential');
select is((select minute_used from fmat.conversation_budgets where name='service'),1,'retries and conflicts do not charge twice');
select is(pg_temp.message('inspect')->'messages'->0->>'text','Meet in Seoul. [x]','inspection omits secret');
select ok(not((pg_temp.message('inspect')->'messages'->0) ? 'input_fingerprint'),'inspection omits digest');
select is(pg_temp.message('deliver',jsonb_build_object('messageId',pg_temp.f('receipt')->>'id','sessionId','text-protection-fixture'))->>'text','Meet in Seoul. [x]','delivery uses only protected text');
update fmat.runtime_messages set next_dispatch_at=clock_timestamp()-interval '1 second' where id=(pg_temp.f('receipt')->>'id')::uuid;
select is((select x->>'text' from jsonb_array_elements(public.fmat_runtime_dispatch('claim','{}')) x where x->>'messageId'=pg_temp.f('receipt')->>'id'),'Meet in Seoul. [x]','recovery dispatch uses protected text');
select throws_ok($$select pg_temp.message('accept',jsonb_build_object('clientId',gen_random_uuid(),'text',repeat(' ',10000)||'x'))$$,'P0001','INVALID_INPUT','raw input limit cannot be bypassed with whitespace');
select is((select count(*)::integer from fmat.runtime_messages where conversation_id=(pg_temp.f('setup')->>'conversationId')::uuid),1,'rejected input leaves no extra ledger row');
update fmat.runtime_messages set status='completed' where id=(pg_temp.f('receipt')->>'id')::uuid;
update fmat.conversation_budgets set minute_used=20 where name='host:80000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.message('accept',jsonb_build_object('clientId',gen_random_uuid(),'text','Bearer quota-secret'))$$,'P0001','CONVERSATION_RATE_LIMIT','credential text does not bypass quota');
select is((select minute_used from fmat.conversation_budgets where name='service'),1,'quota rejection rolls back service counter');
select is(pg_temp.message('accept',pg_temp.f('protectedInput'))->>'status','completed','settled exact retry works at quota ceiling');
update fmat.conversation_grants set revoked_at=clock_timestamp() where id=(pg_temp.f('setup')->>'grantId')::uuid;
select throws_ok($$select pg_temp.message('accept',pg_temp.f('protectedInput'))$$,'P0001','UNAUTHORIZED','redaction does not authorize revoked exact retry');
select throws_ok($$select pg_temp.message('inspect')$$,'P0001','UNAUTHORIZED','protected transcript still requires authority');
select is((select minute_used from fmat.conversation_budgets where name='service'),1,'authority rejection leaves budget unchanged');
select * from finish();
rollback;
