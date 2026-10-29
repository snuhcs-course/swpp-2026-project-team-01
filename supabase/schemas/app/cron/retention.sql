-- Mirrors the schedule in the operations-and-release retention migration, so
-- declarative syncs keep the hourly retention pass instead of unscheduling it.
SELECT cron.schedule('app-retention', '17 * * * *', 'select app.cleanup_retained_records(1000)');
