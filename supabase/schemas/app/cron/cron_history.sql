-- Mirrors migration 20261102032102_prune_cron_history, so declarative syncs keep
-- the hourly pg_cron history cleanup instead of unscheduling it. pg_cron never
-- removes its run records (operations-and-release design 8); this deletes those
-- older than 7 days. A run a server restart interrupted is marked failed with no
-- end_time, so it counts from its start_time.
SELECT cron.schedule('app-cron-history', '47 * * * *', $$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'$$);
