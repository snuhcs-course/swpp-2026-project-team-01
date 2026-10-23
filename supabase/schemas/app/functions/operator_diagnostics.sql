-- One category of the operator snapshot: the total count of the rows the query
-- returns, the oldest timestamp and at most sample_limit identifiers ordered by
-- timestamp and then identifier. query is one of the constant statements in
-- app.operator_diagnostics_snapshot and returns (id text, at timestamptz).
CREATE FUNCTION "app"."diagnostics_category"("category" text, "query" text, "sample_limit" integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  EXECUTE format(
    $q$
    WITH matches AS (%s)
    SELECT jsonb_build_object(
      'name', %L,
      'count', (SELECT count(*) FROM matches),
      'oldestAt', (SELECT min(at) FROM matches),
      'sample', coalesce(
        (SELECT jsonb_agg(s.id ORDER BY s.at, s.id) FROM (SELECT id, at FROM matches ORDER BY at, id LIMIT %s) s),
        '[]'::jsonb
      )
    )
    $q$,
    query, category, sample_limit
  ) INTO result;

  RETURN result;
END;
$$;

-- The operator's redacted, read-only snapshot (operational-diagnostics;
-- operations-and-release design 4, D5): ten fixed categories, each with a count,
-- the oldest timestamp and an oldest-first sample of opaque identifiers. Nothing
-- else leaves the database: no payload, recipient, provider reference, text or
-- failure detail. Nothing is changed, an expired lease included.
CREATE FUNCTION "app"."operator_diagnostics_snapshot"("sample_limit" integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
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
        $s$SELECT id::text AS id, accepted_at AS at FROM app.conversation_inputs WHERE state <> 'completed' AND accepted_at < now() - interval '10 minutes'$s$, n)
    ),
    'notMeasured', jsonb_build_array(
      'authorization_denials: see diagnostics rejections (best effort, application commands only)',
      'stale_actions: see diagnostics rejections (best effort, application commands only)',
      'provider_readiness',
      'recipient_delivery'
    )
  );
END;
$$;

-- Records one recognized command rejection (operations-and-release design 5,
-- D6): prunes buckets older than the preceding 23 UTC hours, then increments the
-- current hour's bucket atomically, capped at 10,000 with saturated set.
CREATE FUNCTION "app"."record_rejection"("p_category" text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  current_bucket timestamptz := date_bin('1 hour', now(), timestamptz '2000-01-01 00:00:00+00');
BEGIN
  IF p_category IS NULL OR p_category NOT IN ('authorization_denied', 'stale_action') THEN
    RAISE EXCEPTION 'unknown rejection category' USING ERRCODE = '22023';
  END IF;

  DELETE FROM app.rejection_observations o WHERE o.bucket < current_bucket - interval '23 hours';

  INSERT INTO app.rejection_observations AS o (category, bucket, count)
  VALUES (p_category, current_bucket, 1)
  ON CONFLICT (category, bucket) DO UPDATE
  SET count = least(o.count + 1, 10000),
      saturated = o.saturated OR o.count >= 10000;
END;
$$;

-- The operator's read of the rejection counts (operational-diagnostics:
-- truthful rejection inspection): the current and preceding 23 UTC hourly
-- buckets per category, zero-filled, with totals, saturation and the coverage
-- limits. Nothing is pruned or changed.
CREATE FUNCTION "app"."operator_rejection_snapshot"()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH window_hours AS (
    SELECT generate_series(
      date_bin('1 hour', now(), timestamptz '2000-01-01 00:00:00+00') - interval '23 hours',
      date_bin('1 hour', now(), timestamptz '2000-01-01 00:00:00+00'),
      interval '1 hour'
    ) AS hour
  ),
  categories AS (
    SELECT unnest(array['authorization_denied', 'stale_action']) AS name
  ),
  filled AS (
    SELECT c.name, w.hour, coalesce(o.count, 0) AS count, coalesce(o.saturated, false) AS saturated
    FROM categories c
    CROSS JOIN window_hours w
    LEFT JOIN app.rejection_observations o ON o.category = c.name AND o.bucket = w.hour
  )
  SELECT jsonb_build_object(
    'version', 1,
    'observedAt', now(),
    'windowStart', (SELECT min(hour) FROM window_hours),
    'currentBucketPartial', true,
    'scope', 'best effort: rejected application commands only, while collection is enabled',
    'notCovered', jsonb_build_array(
      'rejections before the command pipeline, such as raw runtime routes',
      'uncategorized failures',
      'periods when collection was disabled or failed'
    ),
    'categories', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', f.name,
          'total', f.total,
          'saturated', f.saturated,
          'buckets', f.buckets
        )
        ORDER BY f.name
      )
      FROM (
        SELECT name, sum(count)::int AS total, bool_or(saturated) AS saturated,
               jsonb_agg(jsonb_build_object('hour', hour, 'count', count, 'saturated', saturated) ORDER BY hour) AS buckets
        FROM filled
        GROUP BY name
      ) f
    )
  );
$$;
