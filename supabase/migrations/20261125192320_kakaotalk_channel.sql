SET local check_function_bodies = off;

ALTER TABLE "app"."channel_usage_days"
  DROP CONSTRAINT "channel_usage_days_channel_check";

ALTER TABLE "app"."imessage_bindings"
  DROP CONSTRAINT "imessage_bindings_channel_check";

ALTER TABLE "app"."imessage_links"
  DROP CONSTRAINT "imessage_links_channel_check";

ALTER TABLE "app"."imessage_outbox"
  DROP CONSTRAINT "imessage_outbox_channel_check";

ALTER TABLE "app"."imessage_outbox"
  DROP CONSTRAINT "imessage_outbox_kind_check";

ALTER TABLE "app"."imessage_receipts"
  DROP CONSTRAINT "imessage_receipts_channel_check";

CREATE TABLE "app"."kakaotalk_relay_heartbeats" (
  "relay"                 text                     NOT NULL DEFAULT 'relay'::text,
  "received_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "listener_enabled"      boolean                  NOT NULL,
  "accessibility_enabled" boolean                  NOT NULL,
  "locked"                boolean                  NOT NULL,
  "kakaotalk_version"     text,
  "posted_rooms"          integer                  NOT NULL DEFAULT 0,
  "down_since"            timestamp with time zone,
  "down_cause"            text,
  "down_alerted_at"       timestamp with time zone,
  "down_alerts"           integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "kakaotalk_relay_heartbeats_down_alerts_check" CHECK ((down_alerts >= 0)),
  CONSTRAINT "kakaotalk_relay_heartbeats_down_cause_check" CHECK ((down_cause = ANY (ARRAY['silent'::text, 'listener_disabled'::text, 'accessibility_disabled'::text]))),
  CONSTRAINT "kakaotalk_relay_heartbeats_down" CHECK (((down_since IS NULL) = (down_cause IS NULL))),
  CONSTRAINT "kakaotalk_relay_heartbeats_kakaotalk_version_check" CHECK (((char_length(kakaotalk_version) >= 1) AND (char_length(kakaotalk_version) <= 40))),
  CONSTRAINT "kakaotalk_relay_heartbeats_pkey" PRIMARY KEY (relay),
  CONSTRAINT "kakaotalk_relay_heartbeats_posted_rooms_check" CHECK ((posted_rooms >= 0)),
  CONSTRAINT "kakaotalk_relay_heartbeats_relay_check" CHECK ((relay = 'relay'::text))
);

ALTER TABLE "app"."kakaotalk_relay_heartbeats"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."kakaotalk_relay_nonces" (
  "nonce"       text                     NOT NULL,
  "route_class" text                     NOT NULL,
  "seen_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "kakaotalk_relay_nonces_nonce_check" CHECK ((nonce ~ '^[0-9a-f]{32}$'::text)),
  CONSTRAINT "kakaotalk_relay_nonces_pkey" PRIMARY KEY (nonce),
  CONSTRAINT "kakaotalk_relay_nonces_route_class_check" CHECK ((route_class = ANY (ARRAY['inbound'::text, 'outbox'::text])))
);

ALTER TABLE "app"."kakaotalk_relay_nonces"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."imessage_outbox"
  ADD COLUMN "lease_token_hash" text;

ALTER TABLE "app"."imessage_outbox"
  ADD COLUMN "lease_expires_at" timestamp WITH time zone;

ALTER TABLE "app"."imessage_outbox"
  ADD COLUMN "claim_attempts" integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION app.check_kakaotalk_relay()
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION app.operator_channel_usage_report (
  p_period text,
  p_count  integer,
  p_until  date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
DECLARE
  span integer;
  max_count integer;
  last_start date;
  first_start date;
BEGIN
  IF p_period IS NULL OR p_period NOT IN ('day', 'week') THEN
    RAISE EXCEPTION 'period must be day or week' USING ERRCODE = '22023';
  END IF;

  span := CASE p_period WHEN 'day' THEN 1 ELSE 7 END;
  max_count := CASE p_period WHEN 'day' THEN 90 ELSE 52 END;

  IF p_count IS NULL OR p_count NOT BETWEEN 1 AND max_count THEN
    RAISE EXCEPTION 'period count out of range' USING ERRCODE = '22023';
  END IF;

  last_start := coalesce(p_until, (now() AT TIME ZONE 'UTC')::date);
  IF p_period = 'week' THEN
    last_start := date_trunc('week', last_start::timestamp)::date;
  END IF;
  first_start := last_start - span * (p_count - 1);

  RETURN (
    WITH starts AS (
      SELECT (first_start + span * i) AS start FROM generate_series(0, p_count - 1) AS i
    ),
    channels AS (
      SELECT name, ord FROM unnest(array['imessage', 'whatsapp', 'telegram', 'kakaotalk']) WITH ORDINALITY AS c (name, ord)
    ),
    cells AS (
      SELECT c.name, c.ord, s.start,
             count(u.day)::int AS recorded_days,
             coalesce(max(u.active_hosts), 0) AS active_hosts,
             coalesce(sum(u.inbound_messages), 0)::int AS inbound_messages,
             coalesce(sum(u.guest_links), 0)::int AS guest_links,
             coalesce(sum(u.guest_bookings), 0)::int AS guest_bookings
      FROM channels c
      CROSS JOIN starts s
      LEFT JOIN app.channel_usage_days u ON u.channel = c.name AND u.day >= s.start AND u.day < s.start + span
      GROUP BY c.name, c.ord, s.start
    )
    SELECT jsonb_build_object(
      'version', 1,
      'observedAt', now(),
      'period', p_period,
      'from', first_start,
      'to', last_start + span - 1,
      'recordedFrom', (SELECT min(day) FROM app.channel_usage_days),
      'lastRecordedAt', (SELECT max(recorded_at) FROM app.channel_usage_days),
      'channels', (
        SELECT jsonb_agg(jsonb_build_object('name', x.name, 'periods', x.periods) ORDER BY x.ord)
        FROM (
          SELECT name, ord,
                 jsonb_agg(
                   jsonb_build_object(
                     'start', start,
                     'recordedDays', recorded_days,
                     'activeHosts', active_hosts,
                     'inboundMessages', inbound_messages,
                     'guestLinks', guest_links,
                     'guestBookings', guest_bookings
                   )
                   ORDER BY start
                 ) AS periods
          FROM cells
          GROUP BY name, ord
        ) x
      ),
      'notes', jsonb_build_array(
        'activeHosts: hosts with an active host binding at any time in the day; for a week, the highest day',
        'guestLinks: requests whose guest linked the channel; a request does not record the channel a conversation started in',
        'guestBookings: original bookings confirmed on requests whose guest linked the channel',
        'counted hourly for the last 7 UTC days; a day is final after that, and a host or request deleted before then is not counted',
        'a period with fewer recorded days than its length was not fully counted; its zeros are not measurements'
      )
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app.operator_diagnostics_snapshot (
  sample_limit integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
DECLARE
  n integer;
BEGIN
  IF sample_limit IS NULL OR sample_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'sample limit must be between 1 and 20' USING ERRCODE = '22023';
  END IF;

  n := sample_limit;

  RETURN jsonb_build_object(
    'version', 1,
    'observedAt', now(),
    'categories', jsonb_build_array(
      app.diagnostics_category('jobs_exhausted',
        $s$SELECT id::text AS id, updated_at AS at FROM app.jobs WHERE state = 'exhausted'$s$, n),
      app.diagnostics_category('jobs_lease_expired',
        $s$SELECT id::text AS id, lease_expires_at AS at FROM app.jobs WHERE state = 'running' AND lease_expires_at <= now()$s$, n),
      app.diagnostics_category('jobs_overdue',
        $s$SELECT id::text AS id, run_after AS at FROM app.jobs WHERE state = 'pending' AND run_after < now() - interval '5 minutes'$s$, n),
      app.diagnostics_category('bookings_uncertain',
        $s$SELECT id::text AS id, dispatched_at AS at FROM app.bookings WHERE state = 'dispatching'$s$, n),
      app.diagnostics_category('bookings_reserved_stale',
        $s$SELECT id::text AS id, created_at AS at FROM app.bookings WHERE state = 'reserved' AND created_at < now() - interval '15 minutes'$s$, n),
      app.diagnostics_category('email_deliveries_uncertain',
        $s$SELECT id::text AS id, completed_at AS at FROM app.email_deliveries WHERE state = 'uncertain'$s$, n),
      app.diagnostics_category('email_replies_uncertain',
        $s$SELECT id::text AS id, completed_at AS at FROM app.email_replies WHERE state = 'uncertain'$s$, n),
      app.diagnostics_category('imessage_uncertain',
        $s$SELECT id::text AS id, completed_at AS at FROM app.imessage_outbox WHERE state IN ('uncertain', 'failed')$s$, n),
      app.diagnostics_category('sessions_failed',
        $s$SELECT session_id_hash AS id, updated_at AS at FROM app.agent_sessions WHERE state = 'failed'$s$, n),
      app.diagnostics_category('inputs_unanswered',
        $s$SELECT id::text AS id, accepted_at AS at FROM app.conversation_inputs WHERE state <> 'completed' AND accepted_at < now() - interval '10 minutes'$s$, n),
      -- The KakaoTalk relay's down alert (host-kakaotalk-channel design 7): its cause since it went down.
      app.diagnostics_category('kakaotalk_relay_down',
        $s$SELECT down_cause AS id, down_since AS at FROM app.kakaotalk_relay_heartbeats WHERE down_since IS NOT NULL$s$, n)
    ),
    'notMeasured', jsonb_build_array(
      'authorization_denials: see diagnostics rejections (best effort, application commands only)',
      'stale_actions: see diagnostics rejections (best effort, application commands only)',
      'provider_readiness',
      'recipient_delivery'
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app.record_channel_usage_day (
  p_day date
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  WITH bounds AS (
    SELECT p_day::timestamp AT TIME ZONE 'UTC' AS day_start, (p_day + 1)::timestamp AT TIME ZONE 'UTC' AS day_end
  ),
  channels AS (
    SELECT unnest(array['imessage', 'whatsapp', 'telegram', 'kakaotalk']) AS channel
  )
  INSERT INTO app.channel_usage_days AS u (day, channel, active_hosts, inbound_messages, guest_links, guest_bookings, recorded_at)
  SELECT
    p_day,
    c.channel,
    (
      SELECT count(DISTINCT b.host_account_id)::int
      FROM app.imessage_bindings b
      WHERE b.channel = c.channel AND b.linked_at < w.day_end AND (b.ended_at IS NULL OR b.ended_at >= w.day_start)
    ),
    (
      SELECT count(*)::int
      FROM app.imessage_receipts r
      WHERE r.channel = c.channel AND r.received_at >= w.day_start AND r.received_at < w.day_end
    ),
    (
      SELECT count(DISTINCT g.request_id)::int
      FROM app.requester_imessage_bindings g
      JOIN app.requests q ON q.id = g.request_id
      WHERE g.channel = c.channel AND NOT q.is_sample AND g.created_at >= w.day_start AND g.created_at < w.day_end
        AND NOT EXISTS (
          SELECT 1 FROM app.requester_imessage_bindings m WHERE m.moved_to_request_id = g.request_id AND m.channel = g.channel
        )
    ),
    (
      SELECT count(*)::int
      FROM app.bookings k
      JOIN app.requests q ON q.id = k.request_id
      WHERE k.replaces_booking_id IS NULL AND NOT q.is_sample AND k.confirmed_at >= w.day_start AND k.confirmed_at < w.day_end
        AND EXISTS (SELECT 1 FROM app.requester_imessage_bindings g WHERE g.request_id = k.request_id AND g.channel = c.channel)
    ),
    now()
  FROM channels c
  CROSS JOIN bounds w
  ON CONFLICT (day, channel) DO UPDATE
  SET active_hosts = excluded.active_hosts,
      inbound_messages = excluded.inbound_messages,
      guest_links = excluded.guest_links,
      guest_bookings = excluded.guest_bookings,
      recorded_at = excluded.recorded_at;
$function$;

ALTER TABLE "app"."channel_usage_days"
  ADD CONSTRAINT "channel_usage_days_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text, 'kakaotalk'::text])));

ALTER TABLE "app"."imessage_bindings"
  ADD CONSTRAINT "imessage_bindings_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text, 'kakaotalk'::text])));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text, 'kakaotalk'::text])));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text, 'kakaotalk'::text])));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_claim_attempts_check" CHECK ((claim_attempts >= 0));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_kakaotalk_kinds" CHECK (((kind <> 'nudge'::text) OR (channel = 'kakaotalk'::text)));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_kind_check"
    CHECK
    ((kind = ANY (ARRAY['link_received'::text, 'link_refused'::text, 'linked'::text, 'fallback_code'::text, 'unlinked_sender'::text, 'text_only'::text, 'command'::text,
    'turn'::text,
    'notice'::text, 'image'::text, 'schedule_image'::text, 'contact_card'::text, 'signal'::text, 'template'::text, 'edit_markup'::text, 'callback_answer'::text, 'nudge'::text])));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_lease_token_hash_check" CHECK ((lease_token_hash ~ '^[0-9a-f]{64}$'::text));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_lease"
    CHECK ((((lease_token_hash IS NULL) = (lease_expires_at IS NULL)) AND ((lease_token_hash IS NULL) OR ((channel = 'kakaotalk'::text) AND (state = 'dispatching'::text)))));

ALTER TABLE "app"."imessage_receipts"
  ADD CONSTRAINT "imessage_receipts_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text, 'kakaotalk'::text])));

CREATE INDEX imessage_outbox_kakaotalk_queue_idx ON app.imessage_outbox USING btree (recipient_hash, created_at, id)
  WHERE ((channel = 'kakaotalk'::text) AND (state = ANY (ARRAY['waiting'::text, 'queued'::text, 'dispatching'::text])));

CREATE INDEX kakaotalk_relay_nonces_seen_idx ON app.kakaotalk_relay_nonces USING btree (seen_at);

REVOKE ALL ON FUNCTION "app"."check_kakaotalk_relay"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."check_kakaotalk_relay"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."check_kakaotalk_relay"() TO "postgres";

SELECT cron.schedule_in_database('app-kakaotalk-relay', '* * * * *', 'select app.check_kakaotalk_relay()', 'postgres', NULL, true);
