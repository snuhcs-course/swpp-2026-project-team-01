-- pg_cron records every run in cron.job_run_details and never removes them, even
-- after a job is unscheduled (operations-and-release design 8). At minute 47 of
-- every hour this deletes the runs that ended more than 7 days ago; a running
-- job has no end_time and stays.
SELECT cron.schedule('app-cron-history', '47 * * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
