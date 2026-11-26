-- Mirrors the schedule in the kakaotalk_relay_check migration, so declarative
-- syncs keep the every-minute KakaoTalk relay health check instead of
-- unscheduling it.
SELECT cron.schedule('app-kakaotalk-relay', '* * * * *', 'select app.check_kakaotalk_relay()');
