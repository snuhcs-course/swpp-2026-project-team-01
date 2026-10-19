-- Mirrors migration 20261019031811_schedule_job_sweep, so declarative syncs keep
-- the every-minute recovery sweep instead of unscheduling it.
SELECT cron.schedule('app-jobs-sweep', '* * * * *', 'select app.sweep_jobs()');
