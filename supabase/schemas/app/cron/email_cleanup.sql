-- Mirrors the schedule in migration 20261023010100_email_threads, so declarative syncs keep the
-- 15-minute email channel cleanup instead of unscheduling it.
SELECT cron.schedule('app-email-cleanup', '*/15 * * * *', 'select app.cleanup_email_records(500)');
