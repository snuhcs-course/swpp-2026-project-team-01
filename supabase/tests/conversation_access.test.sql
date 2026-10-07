begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

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

select ok(not has_table_privilege('anon','fmat.conversation_scopes','SELECT'),'anonymous cannot discover scopes');
select ok(not has_table_privilege('authenticated','fmat.conversation_grants','SELECT'),'browser cannot obtain grant credentials');
select ok(not has_table_privilege('service_role','fmat.conversation_grants','SELECT'),'service access uses the narrow RPC');
select ok(not has_function_privilege('anon','public.fmat_conversation_access(text,jsonb,jsonb)','EXECUTE'),'anonymous cannot forge a verified credential');
select ok(not has_function_privilege('authenticated','public.fmat_conversation_check(uuid,uuid)','EXECUTE'),'a grant ID is not a browser login');
select ok(has_function_privilege('service_role','public.fmat_conversation_check(uuid,uuid)','EXECUTE'),'execution check available to server');
select is(pg_temp.access('identity','host1','{}')->>'email','one@access.test','identity email comes from Auth, never submitted metadata');
select throws_ok($$select public.fmat_conversation_access('identity',pg_temp.f('host1')||'{"subject":"80000000-0000-4000-8000-000000000002"}','{}')$$,'P0001','UNAUTHORIZED','one session cannot claim another user');
select throws_ok($$select public.fmat_conversation_access('identity',pg_temp.f('host1')||jsonb_build_object('expiresAt',now()-interval '1 second'),'{}')$$,'P0001','UNAUTHORIZED','expired JWT authority rejected');
select throws_ok($$select public.fmat_conversation_access('open','{"kind":"operator"}','{"audience":"host_setup"}')$$,'P0001','UNAUTHORIZED','operator claims cannot become conversation identity');
select throws_ok($$select pg_temp.access('open','host3','{"audience":"host_setup"}')$$,'P0001','HOST_NOT_ADMITTED','unadmitted sign-in cannot open private history');

select ok(not has_function_privilege('authenticated','public.fmat_browser_command(text,jsonb,jsonb)','EXECUTE'),'browser cannot supply credential JSON to the service RPC');
select is(public.fmat_browser_command('host_state',pg_temp.f('host1'),'{}')->>'email','one@access.test','browser state derives verified email from Auth');
select is(public.fmat_browser_command('host_state',pg_temp.f('host3'),'{}')->>'admitted','false','uninvited verified account gets only admission state');
select ok(not(public.fmat_browser_command('host_state',pg_temp.f('host1'),'{}') ?| array['rules','credential','sessionId']),'browser access projection omits private configuration and authority');
select throws_ok($$select public.fmat_browser_command('host_state',pg_temp.f('guest1'),'{}')$$,'P0001','FORBIDDEN','guest cannot query host admission');
select throws_ok($$select public.fmat_browser_command('host_approve',pg_temp.f('host1'),'{}')$$,'P0001','FORBIDDEN','browser access adapter cannot dispatch arbitrary commands');
select throws_ok($$select public.fmat_browser_command('guest_state',pg_temp.f('guest1')||jsonb_build_object('requestId','83000000-0000-4000-8000-000000000002'),'{}')$$,'P0001','NOT_FOUND','guest state cannot cross request boundary');

insert into fixture values ('setup1',pg_temp.access('open','host1','{"audience":"host_setup"}')),
('setup2',pg_temp.access('open','host2','{"audience":"host_setup"}')),
('private1',pg_temp.access('open','host1','{"audience":"host_private","requestId":"83000000-0000-4000-8000-000000000001"}')),
('shared1',pg_temp.access('open','host1','{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}')),
('guestgrant1',pg_temp.access('open','guest1','{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}')),
('guestgrant2',pg_temp.access('open','guest2','{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000002"}'));
select isnt(pg_temp.f('setup1')->>'conversationId',pg_temp.f('setup2')->>'conversationId','hosts have independent setup contexts');
select isnt(pg_temp.f('setup1')->>'conversationId',pg_temp.f('private1')->>'conversationId','setup and request review are separate');
select isnt(pg_temp.f('private1')->>'conversationId',pg_temp.f('shared1')->>'conversationId','private and shared histories are separate');
select is(pg_temp.f('shared1')->>'conversationId',pg_temp.f('guestgrant1')->>'conversationId','host and requester share only the explicit shared context');
select isnt(pg_temp.f('shared1')->>'grantId',pg_temp.f('guestgrant1')->>'grantId','participants retain separate execution authority');
select is(pg_temp.access('open','host1','{"audience":"host_setup"}'),pg_temp.f('setup1'),'repeated opening resumes one scope and grant');
select ok(not(pg_temp.f('guestgrant1') ?| array['credential','tokenHash','sessionId','email']),'grant projection omits credential material');
select lives_ok($$select pg_temp.check_grant('guestgrant1')$$,'current guest execution authorized');
select throws_ok($$select pg_temp.access('authorize','host2',jsonb_build_object('conversationId',pg_temp.f('setup1')->>'conversationId'))$$,'P0001','NOT_FOUND','host cannot read another setup by ID');
select throws_ok($$select pg_temp.access('open','host2','{"audience":"host_private","requestId":"83000000-0000-4000-8000-000000000001"}')$$,'P0001','NOT_FOUND','host cannot open another host request');
select throws_ok($$select pg_temp.access('authorize','guest1',jsonb_build_object('conversationId',pg_temp.f('private1')->>'conversationId'))$$,'P0001','NOT_FOUND','guest cannot select host-private history');
select throws_ok($$select pg_temp.access('authorize','guest2',jsonb_build_object('conversationId',pg_temp.f('guestgrant1')->>'conversationId'))$$,'P0001','NOT_FOUND','second guest cannot reuse another conversation ID');
select throws_ok($$select pg_temp.access('open','guest1','{"audience":"host_setup"}')$$,'P0001','NOT_FOUND','guest cannot open host setup');
select throws_ok($$select public.fmat_conversation_check((pg_temp.f('guestgrant1')->>'grantId')::uuid,(pg_temp.f('guestgrant2')->>'conversationId')::uuid)$$,'P0001','UNAUTHORIZED','grant cannot move to another scope');
select throws_ok($$select public.fmat_conversation_access('open',pg_temp.f('guest1')||jsonb_build_object('tokenHash',repeat('c',64)),'{"audience":"request_shared","requestId":"83000000-0000-4000-8000-000000000001"}')$$,'P0001','NOT_FOUND','wrong guest credential cannot open history');

create function pg_temp.tool(text,text,jsonb default '{}') returns jsonb language sql as $$
  select public.fmat_conversation_tool((pg_temp.f($1)->>'grantId')::uuid,(pg_temp.f($1)->>'conversationId')::uuid,$2,$3)
$$;
select ok(not has_function_privilege('authenticated','public.fmat_conversation_tool(uuid,uuid,text,jsonb)','EXECUTE'),'browser cannot call execution tool RPC');
select ok(not has_function_privilege('anon','public.fmat_conversation_tool(uuid,uuid,text,jsonb)','EXECUTE'),'anonymous cannot call execution tool RPC');
select ok(has_function_privilege('service_role','public.fmat_conversation_tool(uuid,uuid,text,jsonb)','EXECUTE'),'authored server tools can execute');
select is(pg_temp.tool('setup1','setup_read') ? 'confirmed',true,'private setup can read own confirmed settings and draft');
select throws_ok($$select pg_temp.tool('guestgrant1','setup_read')$$,'P0001','FORBIDDEN','requester cannot read host rules');
select throws_ok($$select pg_temp.tool('shared1','setup_read')$$,'P0001','FORBIDDEN','host shared context cannot read private rules');
select throws_ok($$select pg_temp.tool('setup1','request_read')$$,'P0001','FORBIDDEN','setup cannot choose an arbitrary request');
select throws_ok($$select pg_temp.tool('guestgrant1','request_read','{"requestId":"83000000-0000-4000-8000-000000000002"}')$$,'P0001','INVALID_INPUT','tool resource cannot be overridden');
select throws_ok($$select pg_temp.tool('guestgrant1','request_read','{"actor":{"kind":"host"}}')$$,'P0001','INVALID_INPUT','model cannot supply actor authority');
select throws_ok($$select pg_temp.tool('private1','host_approve','{"confirmed":true}')$$,'P0001','FORBIDDEN','model cannot manufacture host approval');
select throws_ok($$select pg_temp.tool('guestgrant1','requester_agree')$$,'P0001','FORBIDDEN','model cannot manufacture requester agreement');
select throws_ok($$select pg_temp.tool('setup1','setup_save')$$,'P0001','FORBIDDEN','model cannot confirm saved policy');
select throws_ok($$select pg_temp.tool('private1','manual_allowance_save')$$,'P0001','FORBIDDEN','model cannot confirm a travel exception');
select throws_ok($$select pg_temp.tool('private1','booking_record_outcome')$$,'P0001','FORBIDDEN','model cannot manufacture provider success');
select throws_ok($$select pg_temp.tool('shared1','private_note_save','{}')$$,'P0001','FORBIDDEN','host private writes unavailable in shared context');
select throws_ok($$select pg_temp.tool('guestgrant1','private_note_save','{}')$$,'P0001','FORBIDDEN','requester cannot save private host notes');
insert into fixture values ('noteInput',jsonb_build_object('text','private-only sentinel','expectedRevision',1,'idempotencyKey','note-tool-1'));
insert into fixture values ('noteResult',pg_temp.tool('private1','private_note_save',pg_temp.f('noteInput')));
select is(pg_temp.f('noteResult')->>'privateNotes','private-only sentinel','private note saved under verified host authority');
select is(pg_temp.tool('private1','private_note_save',pg_temp.f('noteInput')),pg_temp.f('noteResult'),'lost result replay returns exact committed result');
select is((select count(*)::integer from fmat.request_messages where request_id='83000000-0000-4000-8000-000000000001'),1,'retry has one note effect');
select throws_ok($$select pg_temp.tool('private1','private_note_save',pg_temp.f('noteInput')||'{"text":"different"}')$$,'P0001','IDEMPOTENCY_CONFLICT','changed replay payload rejected');
select throws_ok($$select pg_temp.tool('private1','private_note_save',pg_temp.f('noteInput')||'{"idempotencyKey":"new-stale-call"}')$$,'P0001','REVISION_CONFLICT','new stale call rejected');
select ok(not(pg_temp.tool('shared1','request_read') ?| array['privateNotes','privateMessages','privateSchedulingContext','privateDiagnostics','privateTravelChecks','history']),'host shared read omits every private projection');
select ok(pg_temp.tool('guestgrant1','request_read')::text not like '%private-only sentinel%','private note is absent from guest context');
insert into fixture values ('detailsInput',jsonb_build_object('details','{"purpose":"shared purpose"}'::jsonb,'expectedRevision',2,'idempotencyKey','details-tool-1'));
select throws_ok($$select pg_temp.tool('private1','details_update',pg_temp.f('detailsInput'))$$,'P0001','FORBIDDEN','private discussion cannot silently publish shared details');
update fmat.requests set current_proposal_version=1,requester_agreed_version=1,host_approved_version=1 where id='83000000-0000-4000-8000-000000000001';
insert into fixture values ('detailsResult',pg_temp.tool('shared1','details_update',pg_temp.f('detailsInput')));
select is(pg_temp.f('detailsResult')->'details'->>'purpose','shared purpose','host shared details updated');
select ok(pg_temp.f('detailsResult')::text not like '%private-only sentinel%','host shared mutation excludes private result');
select is(pg_temp.tool('shared1','details_update',pg_temp.f('detailsInput')),pg_temp.f('detailsResult'),'cached host result is scrubbed on replay too');
select is(pg_temp.tool('guestgrant1','request_read')->>'revision','3','shared mutation and replay advance revision once');
select ok((select current_proposal_version is null and requester_agreed_version is null and host_approved_version is null from fmat.requests where id='83000000-0000-4000-8000-000000000001'),'changed details invalidate proposal and both decisions');

create function pg_temp.runtime(text,text,jsonb default '{}') returns jsonb language sql as $$
  select public.fmat_runtime_message($2,(pg_temp.f($1)->>'grantId')::uuid,(pg_temp.f($1)->>'conversationId')::uuid,$3)
$$;
select ok(not has_table_privilege('authenticated','fmat.runtime_messages','SELECT'),'browser cannot read inbox directly');
select ok(not has_function_privilege('anon','public.fmat_runtime_message(text,uuid,uuid,jsonb)','EXECUTE'),'anonymous cannot dispatch runtime messages');
insert into fixture values ('runtimeInput','{"clientId":"84000000-0000-4000-8000-000000000001","text":"frozen requester message"}');
insert into fixture values ('runtimeReceipt',pg_temp.runtime('guestgrant1','accept',pg_temp.f('runtimeInput')));
select is(pg_temp.runtime('guestgrant1','accept',pg_temp.f('runtimeInput')),pg_temp.f('runtimeReceipt'),'accepted input retries preserve receipt identity');
select throws_ok($$select pg_temp.runtime('guestgrant1','accept',pg_temp.f('runtimeInput')||'{"text":"changed"}')$$,'P0001','IDEMPOTENCY_CONFLICT','client message ID cannot change text');
select throws_ok($$select pg_temp.runtime('shared1','accept',pg_temp.f('runtimeInput'))$$,'P0001','CONVERSATION_BUSY','another participant cannot coalesce into active caller turn');
select is(pg_temp.runtime('guestgrant1','deliver',jsonb_build_object('messageId',pg_temp.f('runtimeReceipt')->>'id','sessionId','runtime-owner'))->>'text','frozen requester message','delivery reads frozen authorized input');
select throws_ok($$select pg_temp.runtime('guestgrant1','deliver',jsonb_build_object('messageId',pg_temp.f('runtimeReceipt')->>'id','sessionId','replacement-session'))$$,'P0001','FORBIDDEN','terminated or competing workflow cannot replace bound history');
select throws_ok($$select pg_temp.runtime('shared1','deliver',jsonb_build_object('messageId',pg_temp.f('runtimeReceipt')->>'id','sessionId','runtime-owner'))$$,'P0001','NOT_FOUND','other actor cannot replay message under its own authority');
select throws_ok($$select pg_temp.runtime('guestgrant1','settle',jsonb_build_object('messageId',pg_temp.f('runtimeReceipt')->>'id','sessionId','wrong','status','completed'))$$,'P0001','FORBIDDEN','wrong runtime cannot manufacture completion');
select lives_ok($$select pg_temp.runtime('guestgrant1','settle',jsonb_build_object('messageId',pg_temp.f('runtimeReceipt')->>'id','sessionId','runtime-owner','status','completed'))$$,'bound runtime records receipt');
select is(pg_temp.runtime('guestgrant1','accept',pg_temp.f('runtimeInput'))->>'status','completed','acknowledgment loss returns settled receipt');
select is(jsonb_array_length(pg_temp.runtime('shared1','inspect')->'messages'),1,'authorized host shared history sees accepted requester message once');
select is(jsonb_array_length(pg_temp.runtime('private1','inspect')->'messages'),0,'host-private transcript remains separate from shared inbox');
select lives_ok($$select pg_temp.runtime('shared1','accept','{"clientId":"84000000-0000-4000-8000-000000000002","text":"second participant after settled turn"}')$$,'next participant may speak after prior turn settles');

select ok(not has_function_privilege('anon','public.fmat_runtime_dispatch(text,jsonb)','EXECUTE'),'dispatch RPC is not public');
select ok(not has_function_privilege('service_role','fmat.wake_runtime_dispatch()','EXECUTE'),'service cannot read scheduler secrets through wake function');
update fmat.runtime_messages set next_dispatch_at=now()-interval '1 second' where status='pending';
insert into fixture values ('claim',public.fmat_runtime_dispatch('claim','{}')->0);
select is(jsonb_array_length(public.fmat_runtime_dispatch('claim','{}')),0,'live dispatch lease prevents overlapping claim');
select throws_ok($$select public.fmat_runtime_dispatch('finish',pg_temp.f('claim')||'{"leaseToken":"84000000-0000-4000-8000-000000000099","outcome":"sent"}')$$,'P0001','LEASE_LOST','wrong worker cannot acknowledge dispatch');
update fmat.runtime_messages set dispatch_until=now()-interval '1 second' where status='pending';
insert into fixture values ('reclaim',public.fmat_runtime_dispatch('claim','{}')->0);
select isnt(pg_temp.f('claim')->>'leaseToken',pg_temp.f('reclaim')->>'leaseToken','expired lease produces a new fence');
select throws_ok($$select public.fmat_runtime_dispatch('finish',pg_temp.f('claim')||'{"outcome":"sent"}')$$,'P0001','LEASE_LOST','old worker is fenced after reclaim');
select lives_ok($$select public.fmat_runtime_dispatch('finish',pg_temp.f('reclaim')||'{"outcome":"sent"}')$$,'new worker records dispatch');
select is((select status from fmat.runtime_messages where id=(pg_temp.f('reclaim')->>'messageId')::uuid),'pending','transport acknowledgment does not manufacture turn completion');
select is(jsonb_array_length(public.fmat_runtime_dispatch('claim','{}')),0,'acknowledged transport retries are delayed');
select is(fmat.wake_runtime_dispatch(),null::bigint,'unconfigured scheduler performs no network request');

update auth.sessions set not_after=now()-interval '1 second' where id='81000000-0000-4000-8000-000000000001';
select throws_ok($$select public.fmat_browser_command('host_state',pg_temp.f('host1'),'{}')$$,'P0001','UNAUTHORIZED','browser state denies an expired Auth session');
select throws_ok($$select pg_temp.check_grant('setup1')$$,'P0001','UNAUTHORIZED','session expiry interrupts existing execution grant');
update auth.sessions set not_after=null where id='81000000-0000-4000-8000-000000000001';
update auth.users set banned_until=now()+interval '1 day' where id='80000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.check_grant('setup1')$$,'P0001','UNAUTHORIZED','banned user loses existing runtime authority');
update auth.users set banned_until=null where id='80000000-0000-4000-8000-000000000001';
update fmat.hosts set revoked_at=now() where id='80000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.check_grant('setup1')$$,'P0001','HOST_NOT_ADMITTED','host admission revocation reaches existing runtime grant');
select throws_ok($$select pg_temp.check_grant('guestgrant1')$$,'P0001','NOT_FOUND','host revocation closes related guest conversation');
update fmat.hosts set revoked_at=null where id='80000000-0000-4000-8000-000000000001';
update fmat.requests set token_hash=repeat('c',64) where id='83000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.check_grant('guestgrant1')$$,'P0001','NOT_FOUND','rotated guest token invalidates existing runtime grant');
select throws_ok($$select pg_temp.tool('guestgrant1','request_read')$$,'P0001','NOT_FOUND','tool checks fresh guest rotation');
update fmat.requests set token_hash=repeat('a',64),token_revoked_at=now() where id='83000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.check_grant('guestgrant1')$$,'P0001','NOT_FOUND','guest revocation interrupts existing runtime authority');
update fmat.requests set token_revoked_at=null,status='booked' where id='83000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.check_grant('guestgrant1')$$,'P0001','NOT_FOUND','closed requester retains no unlimited conversation access');
select is((pg_temp.check_grant('private1')->>'readOnly')::boolean,true,'host closed history is read-only');
select lives_ok($$select pg_temp.tool('private1','request_read')$$,'host may read closed private context');
select throws_ok($$select pg_temp.tool('private1','private_note_save',pg_temp.f('noteInput'))$$,'P0001','REQUEST_CLOSED','closed request prevents old tool mutation replay');
select lives_ok($$select fmat.authorize_guest_receipt(pg_temp.f('guest1'),'83000000-0000-4000-8000-000000000001')$$,'closed receipt access remains independently available');
update fmat.requests set status='gathering' where id='83000000-0000-4000-8000-000000000001';

select lives_ok($$select pg_temp.access('revoke','guest1',jsonb_build_object('conversationId',pg_temp.f('guestgrant1')->>'conversationId'))$$,'guest can revoke own runtime grant');
select throws_ok($$select pg_temp.check_grant('guestgrant1')$$,'P0001','UNAUTHORIZED','explicit grant revocation checked on execution');
select throws_ok($$select pg_temp.access('authorize','guest1',jsonb_build_object('conversationId',pg_temp.f('guestgrant1')->>'conversationId'))$$,'P0001','FORBIDDEN','same credential cannot silently restore a revoked grant');
select lives_ok($$select pg_temp.check_grant('shared1')$$,'revoking guest grant preserves independently authorized host grant');
delete from auth.sessions where id='81000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.check_grant('shared1')$$,'P0001','UNAUTHORIZED','logout immediately invalidates runtime execution despite unexpired JWT');
select throws_ok($$select pg_temp.tool('private1','private_note_save',pg_temp.f('noteInput'))$$,'P0001','UNAUTHORIZED','logout blocks even an already committed tool replay');
select lives_ok($$select pg_temp.check_grant('setup2')$$,'another host remains authorized');
update fmat.conversation_scopes set revoked_at=now() where id=(pg_temp.f('guestgrant2')->>'conversationId')::uuid;
select throws_ok($$select pg_temp.check_grant('guestgrant2')$$,'P0001','NOT_FOUND','scope retirement prevents continuation');
select * from finish();
rollback;
