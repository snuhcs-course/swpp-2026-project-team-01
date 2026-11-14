-- Mirrors migration 20261114090100_weekly_note_check_schedule, so declarative
-- syncs keep the weekly note check instead of unscheduling it. Monday 00:00 UTC is
-- Monday 09:00 in Asia/Seoul (calendar-note-review design 9); change the day and
-- time here and in a new migration.
SELECT cron.schedule('app-weekly-note-check', '0 0 * * 1', 'select app.publish_weekly_note_checks()');
