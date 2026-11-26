-- The KakaoTalk relay's health (host-kakaotalk-channel design 7, D7), run every
-- minute by pg_cron and by the relay routes before a claim: returns why the relay
-- is down ('silent' after five minutes with no heartbeat, 'listener_disabled' or
-- 'accessibility_disabled' from the last heartbeat), or null when it is up. A
-- relay that never reported is 'silent' and nothing is recorded. Going down
-- records down_since, the cause and an alert; staying down records another alert
-- once the last one is an hour old. The operator snapshot lists the down state.
-- It also ends every relay lease past its expiry first: such a message may have
-- gone out, so it becomes uncertain and is never sent again (design 5), even
-- while the relay makes no further call.
CREATE FUNCTION "app"."check_kakaotalk_relay"()
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  beat app.kakaotalk_relay_heartbeats%ROWTYPE;
  cause text;
BEGIN
  UPDATE app.imessage_outbox
  SET state = 'uncertain', failure_category = 'lease_expired', lease_token_hash = NULL, lease_expires_at = NULL,
      recipient_ciphertext = NULL, text_ciphertext = NULL, completed_at = now(), updated_at = now()
  WHERE channel = 'kakaotalk' AND state = 'dispatching' AND lease_expires_at <= now();

  SELECT * INTO beat FROM app.kakaotalk_relay_heartbeats WHERE relay = 'relay' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'silent';
  END IF;

  cause := CASE
    WHEN beat.received_at <= now() - interval '5 minutes' THEN 'silent'
    WHEN NOT beat.listener_enabled THEN 'listener_disabled'
    WHEN NOT beat.accessibility_enabled THEN 'accessibility_disabled'
  END;

  IF cause IS NULL THEN
    RETURN NULL;
  END IF;

  IF beat.down_since IS NULL OR beat.down_alerted_at IS NULL OR beat.down_alerted_at <= now() - interval '1 hour' THEN
    UPDATE app.kakaotalk_relay_heartbeats
    SET down_since = coalesce(down_since, now()), down_cause = cause, down_alerted_at = now(), down_alerts = down_alerts + 1
    WHERE relay = 'relay';
    RAISE WARNING 'kakaotalk relay down: %', cause;
  ELSIF beat.down_cause IS DISTINCT FROM cause THEN
    UPDATE app.kakaotalk_relay_heartbeats SET down_cause = cause WHERE relay = 'relay';
  END IF;

  RETURN cause;
END;
$$;
