-- Every 5 minutes, pg_cron publishes one request_expiry job when an actionable
-- request is past its expiry. The schedule is a function call, kept in its own
-- hand-written migration and mirrored in supabase/schemas/app/cron/request_expiry.sql
-- so a later sync keeps it. Scheduling the same name again replaces the job.
SELECT cron.schedule('app-request-expiry', '*/5 * * * *', 'select app.publish_request_expiry()');
