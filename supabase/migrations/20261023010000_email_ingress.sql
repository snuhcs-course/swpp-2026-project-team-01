SET local check_function_bodies = off;

CREATE TABLE "app"."email_receipts" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "receiver_id"    uuid                     NOT NULL,
  "event_id"       text                     NOT NULL,
  "delivery_id"    text                     NOT NULL,
  "event_type"     text                     NOT NULL,
  "inbox_id"       text                     NOT NULL,
  "thread_id"      text                     NOT NULL,
  "message_id"     text                     NOT NULL,
  "payload_sha256" text                     NOT NULL,
  "outcome"        text,
  "received_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at"   timestamp with time zone,
  CONSTRAINT "email_receipts_delivery_id_check" CHECK (((char_length(delivery_id) >= 1) AND (char_length(delivery_id) <= 200))),
  CONSTRAINT "email_receipts_delivery_key" UNIQUE (delivery_id),
  CONSTRAINT "email_receipts_event_id_check" CHECK (((char_length(event_id) >= 1) AND (char_length(event_id) <= 200))),
  CONSTRAINT "email_receipts_event_key" UNIQUE (event_id),
  CONSTRAINT "email_receipts_event_type_check" CHECK ((event_type = 'message.received'::text)),
  CONSTRAINT "email_receipts_inbox_id_check" CHECK (((char_length(inbox_id) >= 1) AND (char_length(inbox_id) <= 320))),
  CONSTRAINT "email_receipts_message_id_check" CHECK (((char_length(message_id) >= 1) AND (char_length(message_id) <= 1000))),
  CONSTRAINT "email_receipts_message_key" UNIQUE (inbox_id, message_id),
  CONSTRAINT "email_receipts_outcome_check" CHECK ((outcome = ANY (ARRAY['forwarded'::text, 'linked'::text, 'started'::text, 'replied'::text, 'ignored'::text]))),
  CONSTRAINT "email_receipts_payload_sha256_check" CHECK ((payload_sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "email_receipts_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_receipts_processed" CHECK (((outcome IS NULL) = (processed_at IS NULL))),
  CONSTRAINT "email_receipts_thread_id_check" CHECK (((char_length(thread_id) >= 1) AND (char_length(thread_id) <= 500)))
);

ALTER TABLE "app"."email_receipts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."email_receivers" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "inbox_id"           text                     NOT NULL,
  "webhook_id"         text                     NOT NULL,
  "secret_fingerprint" text                     NOT NULL,
  "state"              text                     NOT NULL DEFAULT 'enabled'::text,
  "operator"           text                     NOT NULL,
  "environment"        text                     NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "disabled_at"        timestamp with time zone,
  "disabled_by"        text,
  CONSTRAINT "email_receivers_disabled_at" CHECK (((state = 'disabled'::text) = (disabled_at IS NOT NULL))),
  CONSTRAINT "email_receivers_disabled_by_check" CHECK (((char_length(disabled_by) >= 1) AND (char_length(disabled_by) <= 100))),
  CONSTRAINT "email_receivers_environment_check" CHECK (((char_length(environment) >= 1) AND (char_length(environment) <= 100))),
  CONSTRAINT "email_receivers_inbox_id_check" CHECK (((char_length(inbox_id) >= 1) AND (char_length(inbox_id) <= 320))),
  CONSTRAINT "email_receivers_operator_check" CHECK (((char_length(operator) >= 1) AND (char_length(operator) <= 100))),
  CONSTRAINT "email_receivers_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_receivers_secret_fingerprint_check" CHECK ((secret_fingerprint ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "email_receivers_state_check" CHECK ((state = ANY (ARRAY['enabled'::text, 'disabled'::text]))),
  CONSTRAINT "email_receivers_webhook_id_check" CHECK (((char_length(webhook_id) >= 1) AND (char_length(webhook_id) <= 200)))
);

ALTER TABLE "app"."email_receivers"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.operator_disable_email_receiver (
  receiver      uuid,
  operator_name text
)
  RETURNS TABLE (
    result_receiver_id uuid,
    result_inbox_id    text,
    result_state       text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  UPDATE app.email_receivers r
  SET state = 'disabled', disabled_at = now(), disabled_by = operator_name
  WHERE r.id = receiver AND r.state = 'enabled';

  RETURN QUERY SELECT r.id, r.inbox_id, r.state FROM app.email_receivers r WHERE r.id = receiver;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown receiver' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION app.operator_register_email_receiver (
  inbox         text,
  webhook       text,
  fingerprint   text,
  operator_name text,
  environment   text
)
  RETURNS TABLE (
    result_receiver_id uuid,
    result_inbox_id    text,
    result_state       text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  created uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('app.email_receiver:' || inbox, 0));

  UPDATE app.email_receivers r
  SET state = 'disabled', disabled_at = now(), disabled_by = operator_name
  WHERE r.inbox_id = inbox AND r.state = 'enabled';

  INSERT INTO app.email_receivers (inbox_id, webhook_id, secret_fingerprint, operator, environment)
  VALUES (inbox, webhook, fingerprint, operator_name, environment)
  RETURNING id INTO created;

  RETURN QUERY SELECT created, inbox, 'enabled'::text;
END;
$function$;

ALTER TABLE "app"."email_receipts"
  ADD CONSTRAINT "email_receipts_receiver_id_fkey" FOREIGN KEY (receiver_id) REFERENCES app.email_receivers(id);

CREATE INDEX email_receipts_received_idx ON app.email_receipts USING btree (received_at);

CREATE UNIQUE INDEX email_receivers_enabled_inbox_key ON app.email_receivers USING btree (inbox_id)
  WHERE (state = 'enabled'::text);

REVOKE ALL ON FUNCTION "app"."operator_disable_email_receiver"(uuid, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."operator_disable_email_receiver"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."operator_disable_email_receiver"(uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "app"."operator_register_email_receiver"(text, text, text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."operator_register_email_receiver"(text, text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."operator_register_email_receiver"(text, text, text, text, text) TO "postgres";
