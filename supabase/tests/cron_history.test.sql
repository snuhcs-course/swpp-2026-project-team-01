-- pg_cron run history: the hourly app-cron-history job deletes runs that ended
-- more than 7 days ago and keeps newer and unfinished ones. The test runs the
-- scheduled command itself in a rolled-back transaction.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select is(
  (select command from cron.job where jobname = 'app-cron-history'),
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$,
  'pg_cron prunes its own run history'
);

select is(
  (select schedule from cron.job where jobname = 'app-cron-history'),
  '47 * * * *',
  'the history cleanup runs every hour'
);

-- postgres cannot draw from cron.runid_seq, so the runs take negative IDs that no
-- real run uses.
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select j.jobid, v.runid, 0, 'postgres', 'postgres', j.command, v.status, v.message, v.started, v.ended
from cron.job j
cross join (values
  (-1, 'succeeded', 'DELETE 0', now() - interval '8 days', now() - interval '8 days'),
  (-2, 'failed', 'ERROR: canceling statement', now() - interval '6 days', now() - interval '6 days'),
  (-3, 'running', null, now() - interval '9 days', null)
) as v (runid, status, message, started, ended)
where j.jobname = 'app-cron-history';

do $$
begin
  execute (select command from cron.job where jobname = 'app-cron-history');
end
$$;

select is(
  (select count(*)::int from cron.job_run_details where runid = -1),
  0,
  'a run that ended 8 days ago is deleted'
);

select is(
  (select count(*)::int from cron.job_run_details where runid = -2),
  1,
  'a failed run from 6 days ago is kept'
);

select is(
  (select count(*)::int from cron.job_run_details where runid = -3),
  1,
  'a run with no end time is kept'
);

select * from finish();
rollback;
