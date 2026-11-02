SET local check_function_bodies = off;

SELECT
  cron.schedule_in_database('app-cron-history', '47 * * * *', 'delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval ''7 days''', 'postgres',
  NULL, true);
