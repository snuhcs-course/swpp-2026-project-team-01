begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'link'||n||'@example.test',now() from generate_series(1,8)n;
insert into auth.sessions(id,user_id) select ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8)n;
insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) select ('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'link'||n||'@example.test',md5(n::text)||md5(n::text),now()+interval '1 day','fixture' from generate_series(1,7)n;
insert into fmat.hosts(id,email,invitation_id) select ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'link'||n||'@example.test',('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,7)n;
insert into fmat.photon_receivers values('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',true,now());
create function pg_temp.credential(n integer) returns jsonb language sql as $$select jsonb_build_object('kind','host','subject','b0000000-0000-4000-8000-'||lpad(n::text,12,'0'),'sessionId','b1000000-0000-4000-8000-'||lpad(n::text,12,'0'),'expiresAt',now()+interval '1 hour')$$;
create function pg_temp.input(n integer) returns jsonb language sql as $$select jsonb_build_object('phone','+1555010000'||n,'spaceId','any;-;+1555010000'||n,'line','shared','browserHash',repeat('b',64),'codeHash',repeat('c',64),'encryptedCode',repeat('e',40),'challengeId','b5000000-0000-4000-8000-'||lpad(n::text,12,'0'),'idempotencyKey','b6000000-0000-4000-8000-'||lpad(n::text,12,'0'))$$;
create function pg_temp.link(op text,n integer,input jsonb default '{}') returns jsonb language sql as $$select public.fmat_photon_link(op,pg_temp.credential(n),'b3000000-0000-4000-8000-000000000001',input)$$;
create function pg_temp.delivery(op text,input jsonb default '{}') returns jsonb language sql as $$select public.fmat_photon_link_delivery(op,'b3000000-0000-4000-8000-000000000001',input)$$;
create temporary table fixture(name text primary key,value jsonb);
create function pg_temp.f(text) returns jsonb language sql as $$select value from fixture where name=$1$$;

create function pg_temp.receive(n integer,key text,overrides jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_photon_ingress('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',
 jsonb_build_object('messageId',key,'senderId','+1555010000'||n,'line','shared','spaceId','any;-;+1555010000'||n,'text','Synthetic private preference',
 'occurredAt',coalesce((select occurred_at from fmat.photon_inbox where message_id=key),clock_timestamp()))||overrides)
$$;
create function pg_temp.dispatch() returns text language sql as $$select public.fmat_photon_dispatch('b3000000-0000-4000-8000-000000000001')->>'outcome'$$;
create function pg_temp.handoff(op text,input jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_photon_handoff(op,'b3000000-0000-4000-8000-000000000001',input)
$$;
create function pg_temp.prepare() returns jsonb language sql as $$select pg_temp.handoff('prepare',jsonb_build_object('handoffId',gen_random_uuid(),'tokenHash',encode(extensions.gen_random_bytes(32),'hex'),'encryptedToken',repeat('e',64)))$$;
create function pg_temp.browser(op text,n integer,input jsonb) returns jsonb language sql as $$
 select public.fmat_photon_handoff_browser(op,case when n=0 then null else pg_temp.credential(n) end,'b3000000-0000-4000-8000-000000000001',input)
$$;
create function pg_temp.proof(n integer) returns jsonb language sql as $$
 select jsonb_build_object('handoffId',h.id,'tokenHash',h.token_hash,'browserHash',repeat('b',64)) from fmat.photon_handoffs h join fmat.photon_inbox i on i.id=h.inbox_id where i.message_id='entry-'||n
$$;
select ok(not has_function_privilege('anon','public.fmat_photon_handoff_browser(text,jsonb,uuid,jsonb)','execute'),'anonymous cannot bypass browser adapter');
select ok(not has_function_privilege('authenticated','public.fmat_photon_handoff_browser(text,jsonb,uuid,jsonb)','execute'),'host cannot forge browser or admission claims');
select ok(has_function_privilege('service_role','public.fmat_photon_handoff_browser(text,jsonb,uuid,jsonb)','execute'),'service RPC enabled');
select pg_temp.receive(n,'entry-'||n) from generate_series(1,7)n;
select pg_temp.prepare() from generate_series(1,7);
update fmat.photon_handoffs set status='delivered',encrypted_token=null;
select throws_ok($$select pg_temp.browser('read',0,pg_temp.proof(1))$$,'P0001','CHALLENGE_INVALID','read does not silently bind a browser');
select is(pg_temp.browser('exchange',0,pg_temp.proof(1))->>'maskedPhone','••••0001','anonymous exchange reveals masked original number');
select is((select count(*)::int from fmat.photon_link_challenges),0,'exchange creates no code or host authority');
select is(pg_temp.browser('exchange',0,pg_temp.proof(1)),pg_temp.browser('read',0,pg_temp.proof(1)),'lost exchange response is replayable');
select throws_ok($$select pg_temp.browser('exchange',0,pg_temp.proof(1)||jsonb_build_object('browserHash',repeat('a',64)))$$,'P0001','CHALLENGE_INVALID','transferred URL cannot rebind');
select throws_ok($$select pg_temp.browser('read',0,pg_temp.proof(1)||jsonb_build_object('tokenHash',repeat('a',64)))$$,'P0001','CHALLENGE_INVALID','browser proof alone cannot read handoff');
select throws_ok($$select pg_temp.browser('start',0,pg_temp.proof(1)||pg_temp.input(1))$$,'P0001','FORBIDDEN','handoff does not authorize anonymous start');
select throws_ok($$select pg_temp.browser('start',8,pg_temp.proof(1)||pg_temp.input(1))$$,'P0001','HOST_NOT_ADMITTED','sign-in without admission denied');
select is(pg_temp.browser('start',1,pg_temp.proof(1)||pg_temp.input(1)||' {"phone":"+15559999999","line":"attacker","spaceId":"any;-;+15559999999"}'::jsonb)#>>'{challenge,status}','prepared','fresh proof is required');
select is((select phone||':'||line from fmat.photon_link_challenges where id=(pg_temp.input(1)->>'challengeId')::uuid),'+15550100001:shared','client cannot replace original number or line');
select lives_ok($$select pg_temp.browser('start',1,pg_temp.proof(1)||pg_temp.input(1)||jsonb_build_object('challengeId',gen_random_uuid()))$$,'lost start acknowledgment reuses attached challenge');
select is((select count(*)::int from fmat.photon_link_challenges),1,'replay emits no new code');
select throws_ok($$select pg_temp.browser('start',2,pg_temp.proof(1)||pg_temp.input(1))$$,'P0001','CHALLENGE_INVALID','same browser cannot transfer code to another host');
insert into auth.sessions(id,user_id) values('b1000000-0000-4000-8000-000000000009',(pg_temp.credential(1)->>'subject')::uuid);
select throws_ok($$select public.fmat_photon_handoff_browser('start',pg_temp.credential(1)||'{"sessionId":"b1000000-0000-4000-8000-000000000009"}','b3000000-0000-4000-8000-000000000001',pg_temp.proof(1)||pg_temp.input(1))$$,'P0001','CHALLENGE_INVALID','another Auth session cannot take over');
select throws_ok($$select pg_temp.link('verify',1,pg_temp.input(1))$$,'P0001','CHALLENGE_INVALID','link token cannot substitute for undelivered code');
insert into fixture values('delivery',pg_temp.delivery('claim')->0);
update fmat.photon_receivers set receiver_id=gen_random_uuid();
select throws_ok($$select pg_temp.delivery('authorize',pg_temp.f('delivery'))$$,'P0001','FORBIDDEN','receiver replacement fences code delivery');
select throws_ok($$select pg_temp.link('verify',1,pg_temp.input(1))$$,'P0001','CHALLENGE_INVALID','correct code from replaced receiver cannot link');
update fmat.photon_receivers set receiver_id='b4000000-0000-4000-8000-000000000001';
select is(pg_temp.link('verify',1,pg_temp.input(1))->>'outcome','linked','fresh private proof confirms original sender');
select is(pg_temp.link('verify',1,pg_temp.input(1))->>'outcome','linked','lost confirmation replay preserves original link');
select is((select count(*)::int from fmat.runtime_messages),0,'old unlinked message is never dispatched');
select pg_temp.link('unlink',1,jsonb_build_object('linkId',(select id from fmat.photon_links where host_id=(pg_temp.credential(1)->>'subject')::uuid)));
select throws_ok($$select pg_temp.link('verify',1,pg_temp.input(1))$$,'P0001','CHALLENGE_INVALID','replay cannot resurrect an unlinked identity');
-- A near-expired entry cannot extend its lifetime by minting a fresh code.
update fmat.photon_handoffs set created_at=clock_timestamp()-interval '14 minutes',expires_at=clock_timestamp()+interval '30 seconds' where id=(pg_temp.proof(2)->>'handoffId')::uuid;
select pg_temp.browser('exchange',0,pg_temp.proof(2));select pg_temp.browser('start',2,pg_temp.proof(2)||pg_temp.input(2));
select ok((select c.expires_at=h.expires_at from fmat.photon_handoffs h join fmat.photon_link_challenges c on c.id=h.challenge_id where h.id=(pg_temp.proof(2)->>'handoffId')::uuid),'code lifetime ends at original entry deadline');
select pg_temp.delivery('claim');
update fmat.photon_handoffs set expires_at=clock_timestamp()-interval '1 second' where id=(pg_temp.proof(2)->>'handoffId')::uuid;
select throws_ok($$select pg_temp.link('verify',2,pg_temp.input(2))$$,'P0001','CHALLENGE_INVALID','entry expiry rejects correct unexpired code');
select pg_temp.browser('exchange',0,pg_temp.proof(3));select pg_temp.browser('start',3,pg_temp.proof(3)||pg_temp.input(3));
update fmat.photon_handoffs set revoked_at=clock_timestamp() where id=(pg_temp.proof(3)->>'handoffId')::uuid;
select is(jsonb_array_length(pg_temp.delivery('claim')),0,'revocation suppresses queued delivery');
select is((select encrypted_code from fmat.photon_link_challenges where id=(pg_temp.input(3)->>'challengeId')::uuid),null,'suppression erases protected code');
select pg_temp.browser('exchange',0,pg_temp.proof(4));select pg_temp.link('start',4,pg_temp.input(4));
select throws_ok($$select pg_temp.browser('start',4,pg_temp.proof(4)||pg_temp.input(4))$$,'P0001','IDEMPOTENCY_CONFLICT','existing browser-first challenge cannot be attached to handoff');
select is((select count(*)::int from cron.job where jobname='fmat-photon-handoffs' and active),1,'exactly one recovery sweep');
select ok(not has_function_privilege('service_role','fmat.wake_photon_handoffs()','execute'),'worker cannot change scheduler authority');
select is(fmat.wake_photon_handoffs(),null::bigint,'local stack without Vault configuration makes no external call');
select * from finish();rollback;
