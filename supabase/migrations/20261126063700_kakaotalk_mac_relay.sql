SET local check_function_bodies = off;

ALTER TABLE "app"."imessage_outbox"
  DROP CONSTRAINT "imessage_outbox_kakaotalk_kinds";

ALTER TABLE "app"."imessage_outbox"
  DROP CONSTRAINT "imessage_outbox_kind_check";

ALTER TABLE "app"."kakaotalk_relay_heartbeats"
  ADD COLUMN "relay_kind" text NOT NULL DEFAULT 'android'::text;

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
        $s$SELECT down_cause AS id, down_since AS at FROM app.kakaotalk_relay_heartbeats WHERE down_since IS NOT NULL$s$, n),
      -- A KakaoTalk message the Mac relay found in another room (host-kakaotalk-mac-relay design 5).
      app.diagnostics_category('kakaotalk_wrong_room',
        $s$SELECT id::text AS id, completed_at AS at FROM app.imessage_outbox WHERE failure_category = 'relay_wrong_room'$s$, n)
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

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_kakaotalk_kinds" CHECK (((kind <> ALL (ARRAY['nudge'::text, 'leave_room'::text])) OR (channel = 'kakaotalk'::text)));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_kind_check"
    CHECK
    ((kind = ANY (ARRAY['link_received'::text, 'link_refused'::text, 'linked'::text, 'fallback_code'::text, 'unlinked_sender'::text, 'text_only'::text, 'command'::text,
    'turn'::text,
    'notice'::text,
    'image'::text,
    'schedule_image'::text, 'contact_card'::text, 'signal'::text, 'template'::text, 'edit_markup'::text, 'callback_answer'::text, 'nudge'::text, 'leave_room'::text])));

ALTER TABLE "app"."kakaotalk_relay_heartbeats"
  ADD CONSTRAINT "kakaotalk_relay_heartbeats_relay_kind_check" CHECK ((relay_kind = ANY (ARRAY['android'::text, 'mac'::text])));
