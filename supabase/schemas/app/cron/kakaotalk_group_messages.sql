-- Mirrors the schedule in the kakaotalk_group_conversations migration, so
-- declarative syncs keep the hourly sweep of group context lines.
SELECT cron.schedule('app-kakaotalk-group-messages', '17 * * * *', 'select app.sweep_kakaotalk_group_messages()');
