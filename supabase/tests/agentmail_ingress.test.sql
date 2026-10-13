begin;
select plan(7);
insert into fmat.agentmail_receivers(inbox_id,receiver_id,enabled) values('atomic@example.test','10000000-0000-4000-8000-000000000001',true);
create function pg_temp.input() returns jsonb language sql as $$select '{"deliveryId":"d1","eventId":"e1","inboxId":"atomic@example.test","threadId":"t1","messageId":"m1","occurredAt":"2026-10-08T00:00:00Z","payloadHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb$$;
-- Force publication failure after receipt insertion. The whole RPC must roll back.
create function pg_temp.reject_publication() returns trigger language plpgsql as $$begin raise exception 'TEST_PUBLICATION_FAILURE';end$$;
create trigger test_reject_publication before insert on fmat.queue_publications for each row execute function pg_temp.reject_publication();
select throws_ok($$select public.fmat_agentmail_ingress('10000000-0000-4000-8000-000000000001','atomic@example.test',pg_temp.input())$$,'P0001','TEST_PUBLICATION_FAILURE','publication failure propagates');
select is((select count(*)::int from fmat.agentmail_inbox where inbox_id='atomic@example.test'),0,'failed publication leaves no receipt');
select is((select count(*)::int from fmat.agentmail_deliveries where inbox_id='atomic@example.test'),0,'failed publication leaves no delivery');
select is((select count(*)::int from fmat.jobs where kind='agentmail_ingress'),0,'failed publication leaves no job');
drop trigger test_reject_publication on fmat.queue_publications;
select is(public.fmat_agentmail_ingress('10000000-0000-4000-8000-000000000001','atomic@example.test',pg_temp.input())->>'duplicate','false','successful retry commits fresh receipt');
select is(public.fmat_agentmail_ingress('10000000-0000-4000-8000-000000000001','atomic@example.test',pg_temp.input())->>'duplicate','true','identical retry reuses receipt');
select is((select count(*)::int from fmat.jobs j join fmat.queue_publications p on p.job_id=j.id where j.kind='agentmail_ingress'),1,'one job publication');
select * from finish();
rollback;
