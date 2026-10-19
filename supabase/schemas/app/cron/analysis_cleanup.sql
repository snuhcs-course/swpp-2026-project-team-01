-- Mirrors migration 20261019144158_schedule_analysis_cleanup, so declarative syncs
-- keep the 15-minute Calendar analysis cleanup instead of unscheduling it.
SELECT cron.schedule('app-analysis-cleanup', '*/15 * * * *', 'select app.cleanup_calendar_analyses(500)');
