-- Every minute, pg_cron runs the recovery sweep, which requests the job worker
-- when production work is due. The schedule is a function call, kept in its own
-- hand-written migration. pg-delta does read cron jobs, so the call is mirrored in
-- supabase/schemas/app/cron/jobs_sweep.sql; without it a later sync would
-- unschedule the sweep. Scheduling the same name again replaces the job.
SELECT cron.schedule('app-jobs-sweep', '* * * * *', 'select app.sweep_jobs()');
