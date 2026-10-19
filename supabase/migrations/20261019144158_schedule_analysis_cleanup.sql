-- Every 15 minutes, pg_cron removes Calendar analysis evidence and sign-up attempt
-- rows older than 24 hours, 500 at a time. The schedule is a function call, kept in
-- its own hand-written migration and mirrored in
-- supabase/schemas/app/cron/analysis_cleanup.sql so a later sync keeps it.
-- Scheduling the same name again replaces the job.
SELECT cron.schedule('app-analysis-cleanup', '*/15 * * * *', 'select app.cleanup_calendar_analyses(500)');
