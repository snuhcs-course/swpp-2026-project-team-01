-- Mirrors the schedule in the channel-usage-report migration, so declarative syncs
-- keep the hourly channel usage count instead of unscheduling it.
SELECT cron.schedule('app-channel-usage', '23 * * * *', 'select app.record_channel_usage(7)');
