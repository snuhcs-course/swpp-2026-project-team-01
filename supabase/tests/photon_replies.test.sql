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
create function pg_temp.runtime(key text,op text,input jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_runtime_message(op,m.grant_id,m.conversation_id,jsonb_build_object('messageId',m.id,'sessionId','reply-'||m.conversation_id)||input)
 from fmat.runtime_messages m join fmat.photon_inbox i on i.runtime_message_id=m.id where i.message_id=key
$$;
create function pg_temp.reply(op text,input jsonb default '{}') returns jsonb language sql as $$
 select public.fmat_photon_reply_delivery(op,'b3000000-0000-4000-8000-000000000001',input)
$$;
create function pg_temp.prepare(n integer,key text,reply text default 'Private final reply') returns void language plpgsql as $$begin
 perform pg_temp.receive(n,key);perform pg_temp.dispatch();perform pg_temp.runtime(key,'deliver');
 perform pg_temp.runtime(key,'settle',jsonb_build_object('status','completed','reply',reply));
end$$;
select ok(not has_function_privilege('anon','public.fmat_photon_reply_delivery(text,uuid,jsonb)','execute'),'anonymous cannot dispatch replies');
select ok(not has_function_privilege('authenticated','public.fmat_photon_reply_delivery(text,uuid,jsonb)','execute'),'browser cannot dispatch replies');
select ok(has_function_privilege('service_role','public.fmat_photon_reply_delivery(text,uuid,jsonb)','execute'),'service can dispatch');
select ok(not has_table_privilege('service_role','fmat.photon_replies','select'),'reply storage not directly exposed');
select ok((select relrowsecurity from pg_class where oid='fmat.photon_replies'::regclass),'private replies have RLS');
select ok(not has_function_privilege('service_role','fmat.photon_reply_prepare(uuid,uuid,jsonb)','execute'),'enqueue helper private');
select pg_temp.link('start',1,pg_temp.input(1));select pg_temp.link('start',2,pg_temp.input(2));
select pg_temp.delivery('claim');select pg_temp.link('verify',1,pg_temp.input(1));select pg_temp.link('verify',2,pg_temp.input(2));
select pg_temp.receive(1,'first');select pg_temp.dispatch();select pg_temp.runtime('first','deliver');
select throws_ok($$select pg_temp.runtime('first','settle',jsonb_build_object('status','completed','reply',repeat('x',4001)))$$,'P0001','INVALID_INPUT','bad reply rolls back settlement');
select is((select status from fmat.runtime_messages),'pending','failed outbox insert leaves input pending');
select is((select count(*)::int from fmat.photon_replies),0,'no partial outbox');
select throws_ok($$select pg_temp.runtime('first','settle','{"sessionId":"wrong","status":"completed","reply":"Private"}')$$,'P0001','FORBIDDEN','other session cannot settle');
select pg_temp.runtime('first','settle','{"status":"completed","reply":"Frozen first reply"}');
select pg_temp.runtime('first','settle','{"status":"failed","reply":"Replacement"}');
select is((select text from fmat.photon_replies),'Frozen first reply','settlement replay preserves exact first reply');
select is((select status from fmat.runtime_messages),'completed','late failure cannot change completed input');
select pg_temp.prepare(1,'second');
insert into fixture values('first-lease',pg_temp.reply('claim'));
select is(pg_temp.f('first-lease')->>'action','send','first claim sends');
select is(pg_temp.f('first-lease')->>'text','Frozen first reply','frozen body returned once');
select is(pg_temp.f('first-lease')->>'phone','+15550100001','recipient from immutable inbound');
select is(pg_temp.f('first-lease')->>'spaceId','any;-;+15550100001','private route frozen');
select is((select status from fmat.photon_replies where id=(pg_temp.f('first-lease')->>'replyId')::uuid),'uncertain','uncertainty persisted before network');
select is(pg_temp.reply('claim')->>'action','idle','active first lease and uncertainty block later reply');
select pg_temp.prepare(2,'other-host');
insert into fixture values('other-lease',pg_temp.reply('claim'));
select is(pg_temp.f('other-lease')->>'phone','+15550100002','uncertain host does not starve other host');
select throws_ok($$select public.fmat_photon_reply_delivery('authorize','b3000000-0000-4000-8000-000000000099',pg_temp.f('first-lease'))$$,'P0001','NOT_FOUND','project cannot cross dispatch boundary');
select throws_ok($$select pg_temp.reply('finish',pg_temp.f('first-lease')||jsonb_build_object('leaseToken',gen_random_uuid(),'status','accepted'))$$,'P0001','REVISION_CONFLICT','wrong lease cannot finish');
update fmat.photon_replies set lease_until=clock_timestamp()-interval '1 second',checked_at=clock_timestamp()-interval '31 seconds' where id=(pg_temp.f('first-lease')->>'replyId')::uuid;
insert into fixture values('recovery',pg_temp.reply('claim'));
select is(pg_temp.f('recovery')->>'action','reconcile','crashed send only reconciles');
select is(pg_temp.f('recovery')->>'replyId',pg_temp.f('first-lease')->>'replyId','recovery retains same message identity');
select is(pg_temp.f('recovery')->>'text',null,'reconciliation cannot receive body for resend');
select throws_ok($$select pg_temp.reply('finish',pg_temp.f('first-lease')||'{"status":"accepted"}'::jsonb)$$,'P0001','REVISION_CONFLICT','old worker fenced');
select pg_temp.reply('finish',pg_temp.f('recovery')||'{"status":"accepted","providerReference":"fixture-guid"}'::jsonb);
insert into fixture values('second-lease',pg_temp.reply('claim'));
select is(pg_temp.f('second-lease')->>'action','send','known acceptance allows next ordered reply');
select isnt(pg_temp.f('second-lease')->>'replyId',pg_temp.f('first-lease')->>'replyId','next input has distinct intent');
select pg_temp.reply('finish',pg_temp.f('second-lease')||'{"status":"delivered","providerReference":"second-guid"}'::jsonb);
select is((select text from fmat.photon_replies where id=(pg_temp.f('second-lease')->>'replyId')::uuid),null,'delivered body removed');
update fmat.photon_replies set checked_at=clock_timestamp()-interval '31 seconds' where id=(pg_temp.f('first-lease')->>'replyId')::uuid;
insert into fixture values('accepted-poll',pg_temp.reply('claim'));
select throws_ok($$select pg_temp.reply('finish',pg_temp.f('accepted-poll')||'{"status":"delivered","providerReference":"wrong-guid"}'::jsonb)$$,'P0001','IDEMPOTENCY_CONFLICT','provider reference cannot change');
select pg_temp.reply('finish',pg_temp.f('accepted-poll')||'{"status":"uncertain","providerReference":null}'::jsonb);
select is((select status from fmat.photon_replies where id=(pg_temp.f('first-lease')->>'replyId')::uuid),'accepted','uncertain poll does not erase known acceptance');
select is((select provider_reference from fmat.photon_replies where id=(pg_temp.f('first-lease')->>'replyId')::uuid),'fixture-guid','poll retains reference');
-- Revocation during preflight denies send and clears private body on finish.
select pg_temp.link('unlink',2,jsonb_build_object('linkId',(select id from fmat.photon_links where host_id=(pg_temp.credential(2)->>'subject')::uuid and revoked_at is null)));
select throws_ok($$select pg_temp.reply('authorize',pg_temp.f('other-lease'))$$,'P0001','FORBIDDEN','unlink denies claimed outbound authority');
select pg_temp.reply('finish',pg_temp.f('other-lease')||'{"status":"revoked"}'::jsonb);
select ok((select revoked_at is not null and text is null and status='uncertain' from fmat.photon_replies where id=(pg_temp.f('other-lease')->>'replyId')::uuid),'revocation redacts body without inventing known provider failure');
-- A failed/no-output turn returns a recovery reply, not fabricated success.
select pg_temp.receive(1,'failed');select pg_temp.dispatch();select pg_temp.runtime('failed','deliver');
select pg_temp.runtime('failed','settle','{"status":"failed","reply":"Do not deliver this partial output"}');
select alike((select r.text from fmat.photon_replies r join fmat.photon_inbox i on i.id=r.inbox_id where i.message_id='failed'),'I could not complete this reply.%','failed turn offers browser recovery');
insert into fixture values('failed-lease',pg_temp.reply('claim'));
select pg_temp.reply('finish',pg_temp.f('failed-lease')||'{"status":"failed"}'::jsonb);
select pg_temp.prepare(1,'banned');
update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=(pg_temp.credential(1)->>'subject')::uuid;
select is(pg_temp.reply('claim')->>'action','suppressed','account ban suppresses prepared reply');
update auth.users set banned_until=null where id=(pg_temp.credential(1)->>'subject')::uuid;
select pg_temp.prepare(1,'rotated');update fmat.photon_receivers set receiver_id=gen_random_uuid();
select is(pg_temp.reply('claim')->>'action','suppressed','receiver rotation suppresses old route');
update fmat.photon_receivers set receiver_id='b4000000-0000-4000-8000-000000000001';
select pg_temp.prepare(1,'expired');
update fmat.conversation_grants set expires_at=clock_timestamp()-interval '1 second' where id=(select m.grant_id from fmat.runtime_messages m join fmat.photon_inbox i on i.runtime_message_id=m.id where i.message_id='expired');
select is(pg_temp.reply('claim')->>'action','suppressed','expired receipt grant cannot send');
select pg_temp.receive(1,'revoked-completion');select pg_temp.dispatch();select pg_temp.runtime('revoked-completion','deliver');
select pg_temp.link('unlink',1,jsonb_build_object('linkId',(select id from fmat.photon_links where host_id=(pg_temp.credential(1)->>'subject')::uuid and revoked_at is null)));
select lives_ok($$select pg_temp.runtime('revoked-completion','settle','{"status":"completed","reply":"Secret"}')$$,'revoked turn can settle its ledger');
select ok((select r.revoked_at is not null and r.text is null from fmat.photon_replies r join fmat.photon_inbox i on i.id=r.inbox_id where i.message_id='revoked-completion'),'revoked completion cannot enqueue private text');
select is((select count(*)::int from fmat.booking_attempts),0,'replies never create bookings');
select * from finish();rollback;
