-- Every Monday at 00:00 UTC (09:00 in Asia/Seoul), pg_cron publishes one weekly
-- note check job per active host with settings and a Google grant
-- (calendar-note-review design 9). The schedule is a function call, kept in its
-- own hand-written migration and mirrored in
-- supabase/schemas/app/cron/weekly_note_check.sql so a later sync keeps it.
-- Scheduling the same name again replaces the job.
SELECT cron.schedule('app-weekly-note-check', '0 0 * * 1', 'select app.publish_weekly_note_checks()');
