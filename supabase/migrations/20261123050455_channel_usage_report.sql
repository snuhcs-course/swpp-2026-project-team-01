SET local check_function_bodies = off;

CREATE TABLE "app"."channel_usage_days" (
  "day"              date                     NOT NULL,
  "channel"          text                     NOT NULL,
  "active_hosts"     integer                  NOT NULL,
  "inbound_messages" integer                  NOT NULL,
  "guest_links"      integer                  NOT NULL,
  "guest_bookings"   integer                  NOT NULL,
  "recorded_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "channel_usage_days_active_hosts_check" CHECK ((active_hosts >= 0)),
  CONSTRAINT "channel_usage_days_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text]))),
  CONSTRAINT "channel_usage_days_guest_bookings_check" CHECK ((guest_bookings >= 0)),
  CONSTRAINT "channel_usage_days_guest_links_check" CHECK ((guest_links >= 0)),
  CONSTRAINT "channel_usage_days_inbound_messages_check" CHECK ((inbound_messages >= 0)),
  CONSTRAINT "channel_usage_days_pkey" PRIMARY KEY (day, channel)
);

ALTER TABLE "app"."channel_usage_days"
  ENABLE ROW LEVEL SECURITY;

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
      SELECT name, ord FROM unnest(array['imessage', 'whatsapp', 'telegram']) WITH ORDINALITY AS c (name, ord)
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

CREATE OR REPLACE FUNCTION app.record_channel_usage (
  days_back integer
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'UTC')::date;
  offset_days integer;
BEGIN
  IF days_back IS NULL OR days_back NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'days back must be between 1 and 30' USING ERRCODE = '22023';
  END IF;

  FOR offset_days IN REVERSE days_back - 1..0 LOOP
    PERFORM app.record_channel_usage_day(today - offset_days);
  END LOOP;

  RETURN days_back;
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
    SELECT unnest(array['imessage', 'whatsapp', 'telegram']) AS channel
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

REVOKE ALL ON FUNCTION "app"."operator_channel_usage_report"(text, integer, date) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."operator_channel_usage_report"(text, integer, date) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."operator_channel_usage_report"(text, integer, date) TO "postgres";

REVOKE ALL ON FUNCTION "app"."record_channel_usage"(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."record_channel_usage"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."record_channel_usage"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "app"."record_channel_usage_day"(date) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."record_channel_usage_day"(date) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."record_channel_usage_day"(date) TO "postgres";

SELECT cron.schedule_in_database('app-channel-usage', '23 * * * *', 'select app.record_channel_usage(7)', 'postgres', NULL, true);
