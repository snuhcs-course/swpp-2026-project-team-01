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
select ok(not has_function_privilege('anon','public.fmat_photon_handoff(text,uuid,jsonb)','execute'),'anonymous cannot operate transport handoffs');
select ok(not has_function_privilege('authenticated','public.fmat_photon_handoff(text,uuid,jsonb)','execute'),'ordinary host cannot operate transport handoffs');
select ok(has_function_privilege('service_role','public.fmat_photon_handoff(text,uuid,jsonb)','execute'),'handoff RPC internal only');
select ok(not has_table_privilege('service_role','fmat.photon_handoffs','select'),'no direct secret read');
select ok((select relrowsecurity from pg_class where oid='fmat.photon_handoffs'::regclass),'private table has RLS');
select is(pg_temp.prepare()->>'outcome','idle','no receipt means no outgoing intent');
select pg_temp.receive(1,'first');
select is(pg_temp.prepare()->>'outcome','handoff','fresh private unknown sender gets bounded continuation');
select pg_temp.receive(1,'first');select is(pg_temp.prepare()->>'outcome','idle','provider replay cannot create another URL');
select is((select count(*)::int from fmat.photon_handoffs),1,'one immutable handoff per receipt');
select is((select count(*)::int from fmat.conversation_grants),0,'unknown sender gets no host grant');
select is((select count(*)::int from fmat.runtime_messages),0,'unlinked text never reaches model');
select is((select count(*)::int from fmat.jobs where status='complete' and result->>'outcome'='handoff'),1,'transport job completes atomically');
select is((select count(*)::int from fmat.queue_publications where acknowledged_at is null),0,'publication acknowledged');
insert into fixture values('proof',(select jsonb_build_object('handoffId',id,'tokenHash',token_hash) from fmat.photon_handoffs));
select throws_ok($$select pg_temp.handoff('resolve',pg_temp.f('proof'))$$,'P0001','CHALLENGE_INVALID','prepared token not yet usable');
insert into fixture values('lease',pg_temp.handoff('claim'));
select is(pg_temp.f('lease')->>'action','send','initial send is allowed once');
select is(pg_temp.f('lease')->>'phone','+15550100001','recipient derives from receipt');
select is(pg_temp.f('lease')->>'spaceId','any;-;+15550100001','private route frozen');
select is((select status from fmat.photon_handoffs),'uncertain','uncertainty persists before network');
select is(pg_temp.handoff('claim')->>'action','idle','active lease excludes second worker');
select lives_ok($$select pg_temp.handoff('resolve',pg_temp.f('proof'))$$,'correct private proof resolves only route metadata');
select throws_ok($$select pg_temp.handoff('resolve',pg_temp.f('proof')||jsonb_build_object('tokenHash',repeat('f',64)))$$,'P0001','CHALLENGE_INVALID','wrong token fails');
select throws_ok($$select public.fmat_photon_handoff('resolve','b3000000-0000-4000-8000-000000000002',pg_temp.f('proof'))$$,'P0001','NOT_FOUND','other project cannot resolve');
update fmat.photon_handoffs set lease_until=clock_timestamp()-interval '1 second',checked_at=clock_timestamp()-interval '31 seconds';
insert into fixture values('recovery',pg_temp.handoff('claim'));
select is(pg_temp.f('recovery')->>'action','reconcile','lost response never resends');
select is(pg_temp.f('recovery')->>'handoffId',pg_temp.f('lease')->>'handoffId','same outbound identity');
select is(pg_temp.f('recovery')->>'encryptedToken',null,'reconciliation receives no URL secret');
select throws_ok($$select pg_temp.handoff('finish',pg_temp.f('lease')||'{"status":"accepted"}'::jsonb)$$,'P0001','REVISION_CONFLICT','old worker cannot acknowledge');
select pg_temp.handoff('finish',pg_temp.f('recovery')||'{"status":"accepted","providerReference":"fixture-guid"}'::jsonb);
update fmat.photon_handoffs set checked_at=clock_timestamp()-interval '31 seconds';
insert into fixture values('poll',pg_temp.handoff('claim'));
select throws_ok($$select pg_temp.handoff('finish',pg_temp.f('poll')||'{"status":"delivered","providerReference":"wrong-guid"}'::jsonb)$$,'P0001','IDEMPOTENCY_CONFLICT','reference cannot change');
select pg_temp.handoff('finish',pg_temp.f('poll')||'{"status":"uncertain","providerReference":null}'::jsonb);
select is((select status from fmat.photon_handoffs),'accepted','uncertain poll preserves known acceptance');
select pg_temp.receive(1,'rapid');select is(pg_temp.prepare()->>'outcome','limited','one link per five minutes per private sender');
select pg_temp.receive(2,'other');select is(pg_temp.prepare()->>'outcome','handoff','another sender can proceed');
insert into fixture values('other-lease',pg_temp.handoff('claim'));
update fmat.photon_receivers set receiver_id=gen_random_uuid();
select throws_ok($$select pg_temp.handoff('authorize',pg_temp.f('other-lease'))$$,'P0001','FORBIDDEN','receiver replacement revokes claimed send');
select throws_ok($$select pg_temp.handoff('resolve',pg_temp.f('proof'))$$,'P0001','CHALLENGE_INVALID','receiver replacement invalidates transferred token');
select pg_temp.handoff('finish',pg_temp.f('other-lease')||'{"status":"revoked"}'::jsonb);
select ok((select revoked_at is not null and encrypted_token is null from fmat.photon_handoffs where id=(pg_temp.f('other-lease')->>'handoffId')::uuid),'suppression clears ciphertext');
update fmat.photon_receivers set receiver_id='b4000000-0000-4000-8000-000000000001';
-- Invalid/private-route mismatches and delayed historical traffic cannot send.
select pg_temp.receive(3,'wrong-space','{"spaceId":"any;-;+15550100007"}');select is(pg_temp.prepare()->>'outcome','revoked','space cannot be transferred');
select pg_temp.receive(3,'wrong-phone','{"senderId":"display-name"}');select is(pg_temp.prepare()->>'outcome','revoked','display name is not phone evidence');
select pg_temp.receive(3,'historical',jsonb_build_object('occurredAt',clock_timestamp()-interval '1 day'));select is(pg_temp.prepare()->>'outcome','revoked','old provider message suppressed');
select pg_temp.receive(3,'future',jsonb_build_object('occurredAt',clock_timestamp()+interval '1 day'));select is(pg_temp.prepare()->>'outcome','revoked','future message suppressed');
select pg_temp.receive(3,'disabled');update fmat.photon_receivers set enabled=false;select is(pg_temp.prepare()->>'outcome','revoked','disabled receiver cannot issue URL');update fmat.photon_receivers set enabled=true;
select pg_temp.receive(3,'expired');update fmat.photon_inbox set received_at=clock_timestamp()-interval '16 minutes' where message_id='expired';select is(pg_temp.prepare()->>'outcome','revoked','late processing cannot extend lifetime');
-- Linking after receipt must not let this old public input gain private authority.
select pg_temp.receive(3,'linked-later');select pg_temp.link('start',3,pg_temp.input(3));select pg_temp.delivery('claim');select pg_temp.link('verify',3,pg_temp.input(3));
select is(pg_temp.prepare()->>'outcome','revoked','new link suppresses obsolete unlinked input');
update fmat.photon_handoffs set created_at=created_at-interval '16 minutes',expires_at=expires_at-interval '16 minutes',checked_at=clock_timestamp()-interval '31 seconds' where id=(pg_temp.f('proof')->>'handoffId')::uuid;
select throws_ok($$select pg_temp.handoff('resolve',pg_temp.f('proof'))$$,'P0001','CHALLENGE_INVALID','expired proof cannot resolve');
select is(pg_temp.handoff('claim')->>'action','suppressed','expired uncertainty is suppressed without resend');
do $$begin
 for n in 1..5 loop
  perform pg_temp.receive(4,'hour-'||n);if pg_temp.prepare()->>'outcome'<>'handoff' then raise exception 'hourly fixture rejected';end if;
  update fmat.photon_handoffs h set created_at=h.created_at-interval '6 minutes',expires_at=h.expires_at-interval '6 minutes' from fmat.photon_inbox i where i.id=h.inbox_id and i.sender_id='+15550100004';
 end loop;
end$$;
select pg_temp.receive(4,'hour-sixth');select is(pg_temp.prepare()->>'outcome','limited','five continuations per sender per hour');
select is((select count(*)::int from fmat.booking_attempts),0,'handoffs create no bookings');
select * from finish();rollback;
