-- Mirrors migration 20261021110942_request_expiry_schedule, so declarative syncs
-- keep the 5-minute request expiry schedule instead of unscheduling it.
SELECT cron.schedule('app-request-expiry', '*/5 * * * *', 'select app.publish_request_expiry()');
