-- Worker wake-ups: the insert trigger and the every-minute sweep request the
-- worker only when Vault holds both its URL and secret, and only for production
-- work. Everything runs in a rolled-back transaction, so no queued request is
-- ever sent.
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select is(
  (select command from cron.job where jobname = 'app-jobs-sweep'),
  'select app.sweep_jobs()',
  'pg_cron runs the job sweep'
);

select is(
  (select schedule from cron.job where jobname = 'app-jobs-sweep'),
  '* * * * *',
  'the sweep runs every minute'
);

-- A sandbox: no worker entries in Vault.
delete from vault.secrets where name in ('worker_url', 'worker_secret');

create temporary table queued_before as select count(*) as n from net.http_request_queue;

insert into app.jobs (kind, producer_environment) values ('test.wakeup', 'production');

select is(app.request_worker(), false, 'without Vault entries the worker is not requested');
select is(app.sweep_jobs(), false, 'without Vault entries the sweep requests nothing');
select is(
  (select count(*) from net.http_request_queue),
  (select n from queued_before),
  'a sandbox with no Vault entries queues no HTTP request'
);

-- Only the URL: still nothing.
select vault.create_secret('https://worker.example.test/api/internal/jobs', 'worker_url');
select is(app.request_worker(), false, 'a URL without a secret requests nothing');

-- Both entries, as the deploy workflow writes them for the shared project.
select vault.create_secret('test-worker-secret-0123456789abcdefghijkl', 'worker_secret');

truncate queued_before;
insert into queued_before select count(*) from net.http_request_queue;

insert into app.jobs (kind, producer_environment) values ('test.wakeup', 'preview');

select is(
  (select count(*) from net.http_request_queue),
  (select n from queued_before),
  'inserting a preview-produced job does not wake the worker'
);

insert into app.jobs (kind, producer_environment) values ('test.wakeup', 'production');

select is(
  (select count(*) from net.http_request_queue),
  (select n from queued_before) + 1,
  'inserting production work wakes the worker once'
);

select ok(
  exists (
    select 1 from net.http_request_queue
    where method = 'POST'
      and url = 'https://worker.example.test/api/internal/jobs'
      and headers ->> 'authorization' = 'Bearer test-worker-secret-0123456789abcdefghijkl'
  ),
  'the wake-up posts to the Vault URL with the Vault secret'
);

select is(app.sweep_jobs(), true, 'the sweep requests the worker while production work is due');

update app.jobs set state = 'completed' where producer_environment = 'production' and state = 'pending';
update app.jobs set state = 'completed', lease_expires_at = null, lease_owner = null
where producer_environment = 'production' and state = 'running';

select is(app.sweep_jobs(), false, 'the sweep requests nothing when no production work is due');

-- A failing wake-up never rolls back the change that published the job.
create or replace function app.request_worker() returns boolean language plpgsql set search_path = '' as $$
begin
  raise exception 'vault unavailable';
end;
$$;

select lives_ok(
  $$insert into app.jobs (kind, producer_environment) values ('test.wakeup.best-effort', 'production')$$,
  'a failing wake-up does not fail the insert'
);
select is(
  (select count(*)::int from app.jobs where kind = 'test.wakeup.best-effort'),
  1,
  'the job published despite the failed wake-up is kept'
);

select * from finish();
rollback;
