-- Counts one UTC day of messaging channel use into app.channel_usage_days
-- (channel-usage-report design 2), replacing that day's rows for all four
-- channels, zeros included:
--   active_hosts      hosts whose host binding on the channel was active at any
--                     time in the day
--   inbound_messages  receipts the receiver stored from the channel that day
--   guest_links       requests whose guest linked the channel that day; a
--                     binding moved to a revised request is not a new link
--   guest_bookings    original bookings (not changes after booking) confirmed
--                     that day on requests whose guest linked the channel
-- Sample requests are not counted. The sources keep their rows for 30 days, so
-- a day can be counted again until then.
CREATE FUNCTION "app"."record_channel_usage_day"("p_day" date)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
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
$$;

-- The hourly channel usage count (channel-usage-report design 2), run by pg_cron:
-- recounts the current UTC day and the days_back - 1 days before it, at most 30
-- so every source row is still there. Returns the number of days counted.
CREATE FUNCTION "app"."record_channel_usage"("days_back" integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
$$;

-- The operator's read of channel usage (operational-diagnostics: channel usage
-- report; channel-usage-report design 3): per channel, the last p_count UTC
-- days or ISO weeks (Monday first) ending with p_until (today when null),
-- zero-filled, with how many days of each period were recorded. A week sums its
-- days and reports its highest day's active hosts. Only counts and dates leave
-- the database, and nothing is changed or recounted.
CREATE FUNCTION "app"."operator_channel_usage_report"("p_period" text, "p_count" integer, "p_until" date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
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
$$;
