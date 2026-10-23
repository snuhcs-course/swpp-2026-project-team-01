-- Mirrors the schedule in migration 20261023024435_imessage_channel, so declarative syncs keep the
-- 15-minute iMessage channel cleanup instead of unscheduling it.
SELECT cron.schedule('app-imessage-cleanup', '*/15 * * * *', 'select app.cleanup_imessage_records(500)');
