SET local check_function_bodies = off;

CREATE TABLE "app"."imessage_bindings" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id"     uuid                     NOT NULL,
  "link_id"             uuid,
  "sender_hash"         text                     NOT NULL,
  "sender_ciphertext"   text,
  "space_ciphertext"    text,
  "sealed_key_id"       text,
  "selected_request_id" uuid,
  "state"               text                     NOT NULL DEFAULT 'active'::text,
  "linked_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "last_inbound_at"     timestamp with time zone,
  "ended_at"            timestamp with time zone,
  CONSTRAINT "imessage_bindings_ended_cleared" CHECK (((ended_at IS NULL) OR ((sender_ciphertext IS NULL) AND (space_ciphertext IS NULL)))),
  CONSTRAINT "imessage_bindings_ended" CHECK (((state = 'active'::text) = (ended_at IS NULL))),
  CONSTRAINT "imessage_bindings_pkey" PRIMARY KEY (id),
  CONSTRAINT "imessage_bindings_sealed" CHECK (((state <> 'active'::text) OR ((sender_ciphertext IS NOT NULL) AND (sealed_key_id IS NOT NULL)))),
  CONSTRAINT "imessage_bindings_sender_hash_check" CHECK ((sender_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_bindings_state_check" CHECK ((state = ANY (ARRAY['active'::text, 'unlinked'::text])))
);

ALTER TABLE "app"."imessage_bindings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."imessage_links" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id"        uuid                     NOT NULL,
  "method"                 text                     NOT NULL,
  "state"                  text                     NOT NULL DEFAULT 'pending'::text,
  "code_hash"              text,
  "code_ciphertext"        text,
  "phone_hash"             text,
  "phone_ciphertext"       text,
  "sealed_key_id"          text,
  "fallback_code_hash"     text,
  "fallback_expires_at"    timestamp with time zone,
  "sends"                  integer                  NOT NULL DEFAULT 0,
  "last_sent_at"           timestamp with time zone,
  "wrong_entries"          integer                  NOT NULL DEFAULT 0,
  "sender_hash"            text,
  "sender_ciphertext"      text,
  "space_ciphertext"       text,
  "sender_key_id"          text,
  "received_by_receipt_id" uuid,
  "binding_id"             uuid,
  "expires_at"             timestamp with time zone NOT NULL,
  "confirm_by"             timestamp with time zone,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at"               timestamp with time zone,
  CONSTRAINT "imessage_links_code_hash_check" CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_links_code_hash_key" UNIQUE (code_hash),
  CONSTRAINT "imessage_links_ended_cleared"
    CHECK
    (((ended_at IS NULL) OR ((code_ciphertext IS NULL) AND (phone_ciphertext IS NULL) AND (sender_ciphertext IS NULL) AND (space_ciphertext IS NULL) AND (fallback_code_hash IS
    NULL)))),
  CONSTRAINT "imessage_links_ended" CHECK (((state = ANY (ARRAY['pending'::text, 'received'::text])) = (ended_at IS NULL))),
  CONSTRAINT "imessage_links_fallback_code_hash_check" CHECK ((fallback_code_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_links_method_check" CHECK ((method = ANY (ARRAY['code'::text, 'fallback'::text]))),
  CONSTRAINT "imessage_links_method_values" CHECK ((((method = 'code'::text) AND (code_hash IS
    NOT NULL) AND (phone_hash IS NULL)) OR ((method = 'fallback'::text) AND (code_hash IS NULL) AND (phone_hash IS NOT NULL)))),
  CONSTRAINT "imessage_links_phone_hash_check" CHECK ((phone_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_links_pkey" PRIMARY KEY (id),
  CONSTRAINT "imessage_links_received" CHECK (((state <> 'received'::text) OR ((sender_hash IS NOT NULL) AND (confirm_by IS NOT NULL)))),
  CONSTRAINT "imessage_links_sender_hash_check" CHECK ((sender_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_links_sends_check" CHECK ((sends >= 0)),
  CONSTRAINT "imessage_links_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'received'::text, 'linked'::text, 'voided'::text, 'expired'::text, 'cancelled'::text]))),
  CONSTRAINT "imessage_links_wrong_entries_check" CHECK ((wrong_entries >= 0))
);

ALTER TABLE "app"."imessage_links"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."imessage_outbox" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "kind"                 text                     NOT NULL,
  "dedupe_key"           text                     NOT NULL,
  "host_account_id"      uuid,
  "binding_id"           uuid,
  "link_id"              uuid,
  "request_id"           uuid,
  "input_id"             uuid,
  "recipient_hash"       text                     NOT NULL,
  "recipient_ciphertext" text,
  "text_ciphertext"      text,
  "sealed_key_id"        text,
  "state"                text                     NOT NULL DEFAULT 'queued'::text,
  "failure_category"     text,
  "provider_message_id"  text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "dispatched_at"        timestamp with time zone,
  "completed_at"         timestamp with time zone,
  CONSTRAINT "imessage_outbox_dedupe_key_check" CHECK (((char_length(dedupe_key) >= 1) AND (char_length(dedupe_key) <= 300))),
  CONSTRAINT "imessage_outbox_failure_category_check" CHECK (((char_length(failure_category) >= 1) AND (char_length(failure_category) <= 60))),
  CONSTRAINT "imessage_outbox_final_cleared" CHECK (((completed_at IS NULL) OR ((recipient_ciphertext IS NULL) AND (text_ciphertext IS NULL)))),
  CONSTRAINT "imessage_outbox_final" CHECK (((state = ANY (ARRAY['accepted'::text, 'failed'::text, 'uncertain'::text, 'suppressed'::text])) = (completed_at IS NOT NULL))),
  CONSTRAINT "imessage_outbox_kind_check"
    CHECK
    ((kind = ANY (ARRAY['link_received'::text, 'link_refused'::text, 'linked'::text, 'fallback_code'::text, 'unlinked_sender'::text, 'text_only'::text, 'command'::text,
    'turn'::text, 'notice'::text, 'contact_card'::text]))),
  CONSTRAINT "imessage_outbox_kind_dedupe_key_key" UNIQUE (kind, dedupe_key),
  CONSTRAINT "imessage_outbox_pkey" PRIMARY KEY (id),
  CONSTRAINT "imessage_outbox_provider_message_id_check" CHECK (((char_length(provider_message_id) >= 1) AND (char_length(provider_message_id) <= 500))),
  CONSTRAINT "imessage_outbox_recipient_hash_check" CHECK ((recipient_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_outbox_state_check"
    CHECK ((state = ANY (ARRAY['waiting'::text, 'queued'::text, 'dispatching'::text, 'accepted'::text, 'failed'::text, 'uncertain'::text, 'suppressed'::text]))),
  CONSTRAINT "imessage_outbox_turn_input" CHECK (((kind <> 'turn'::text) OR (input_id IS NOT NULL) OR (completed_at IS NOT NULL)))
);

ALTER TABLE "app"."imessage_outbox"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."imessage_receipts" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "message_id"        text                     NOT NULL,
  "webhook_id"        text                     NOT NULL,
  "sender_hash"       text                     NOT NULL,
  "space_hash"        text                     NOT NULL,
  "space_type"        text                     NOT NULL,
  "content_type"      text                     NOT NULL,
  "provider_sent_at"  timestamp with time zone,
  "payload_sha256"    text                     NOT NULL,
  "text_ciphertext"   text,
  "sender_ciphertext" text,
  "space_ciphertext"  text,
  "sealed_key_id"     text,
  "outcome"           text,
  "received_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at"      timestamp with time zone,
  CONSTRAINT "imessage_receipts_content_type_check" CHECK (((char_length(content_type) >= 1) AND (char_length(content_type) <= 50))),
  CONSTRAINT "imessage_receipts_message_id_check" CHECK (((char_length(message_id) >= 1) AND (char_length(message_id) <= 500))),
  CONSTRAINT "imessage_receipts_message_key" UNIQUE (message_id),
  CONSTRAINT "imessage_receipts_outcome_check"
    CHECK ((outcome = ANY (ARRAY['link_received'::text, 'link_refused'::text, 'unlinked_reply'::text, 'command'::text, 'forwarded'::text, 'replied'::text, 'ignored'::text]))),
  CONSTRAINT "imessage_receipts_payload_sha256_check" CHECK ((payload_sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_receipts_pkey" PRIMARY KEY (id),
  CONSTRAINT "imessage_receipts_processed_cleared" CHECK (((processed_at IS NULL) OR ((text_ciphertext IS NULL) AND (sender_ciphertext IS NULL) AND (space_ciphertext IS NULL)))),
  CONSTRAINT "imessage_receipts_processed" CHECK (((outcome IS NULL) = (processed_at IS NULL))),
  CONSTRAINT "imessage_receipts_sealed" CHECK ((((sender_ciphertext IS NULL) = (sealed_key_id IS NULL)) OR (processed_at IS NOT NULL))),
  CONSTRAINT "imessage_receipts_sender_hash_check" CHECK ((sender_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_receipts_space_hash_check" CHECK ((space_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "imessage_receipts_space_type_check" CHECK ((space_type = ANY (ARRAY['dm'::text, 'group'::text]))),
  CONSTRAINT "imessage_receipts_webhook_id_check" CHECK (((char_length(webhook_id) >= 1) AND (char_length(webhook_id) <= 200)))
);

ALTER TABLE "app"."imessage_receipts"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.cleanup_imessage_records (
  row_limit integer
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  removed integer := 0;
  step integer;
BEGIN
  UPDATE app.imessage_links
  SET state = 'expired', ended_at = now(), code_ciphertext = NULL, phone_ciphertext = NULL,
      sender_ciphertext = NULL, space_ciphertext = NULL, fallback_code_hash = NULL
  WHERE (state = 'pending' AND expires_at <= now()) OR (state = 'received' AND confirm_by <= now());

  DELETE FROM app.imessage_outbox
  WHERE id IN (
    SELECT id FROM app.imessage_outbox WHERE created_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.imessage_receipts
  WHERE id IN (
    SELECT id FROM app.imessage_receipts WHERE received_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.imessage_bindings
  WHERE id IN (
    SELECT id FROM app.imessage_bindings WHERE state = 'unlinked' AND ended_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.imessage_links
  WHERE id IN (
    SELECT id FROM app.imessage_links WHERE ended_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  RETURN removed;
END;
$function$;

ALTER TABLE "app"."imessage_bindings"
  ADD CONSTRAINT "imessage_bindings_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."imessage_bindings"
  ADD CONSTRAINT "imessage_bindings_selected_request_id_fkey" FOREIGN KEY (selected_request_id) REFERENCES app.requests(id) ON DELETE SET NULL;

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."imessage_bindings"
  ADD CONSTRAINT "imessage_bindings_link_id_fkey" FOREIGN KEY (link_id) REFERENCES app.imessage_links(id) ON DELETE SET NULL;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_binding_id_fkey" FOREIGN KEY (binding_id) REFERENCES app.imessage_bindings(id) ON DELETE CASCADE;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_input_id_fkey" FOREIGN KEY (input_id) REFERENCES app.conversation_inputs(id) ON DELETE SET NULL;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_link_id_fkey" FOREIGN KEY (link_id) REFERENCES app.imessage_links(id) ON DELETE SET NULL;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX imessage_bindings_active_host_key ON app.imessage_bindings USING btree (host_account_id)
  WHERE (state = 'active'::text);

CREATE UNIQUE INDEX imessage_bindings_active_sender_key ON app.imessage_bindings USING btree (sender_hash)
  WHERE (state = 'active'::text);

CREATE INDEX imessage_links_fallback_sent_idx ON app.imessage_links USING btree (last_sent_at)
  WHERE (method = 'fallback'::text);

CREATE INDEX imessage_links_host_created_idx ON app.imessage_links USING btree (host_account_id, created_at);

CREATE UNIQUE INDEX imessage_links_open_host_key ON app.imessage_links USING btree (host_account_id)
  WHERE (state = ANY (ARRAY['pending'::text, 'received'::text]));

CREATE INDEX imessage_outbox_created_idx ON app.imessage_outbox USING btree (created_at);

CREATE INDEX imessage_outbox_host_idx ON app.imessage_outbox USING btree (host_account_id, created_at);

CREATE INDEX imessage_outbox_input_idx ON app.imessage_outbox USING btree (input_id)
  WHERE (state = 'waiting'::text);

CREATE INDEX imessage_outbox_recipient_idx ON app.imessage_outbox USING btree (recipient_hash, created_at)
  WHERE (kind = 'unlinked_sender'::text);

CREATE INDEX imessage_receipts_received_idx ON app.imessage_receipts USING btree (received_at);

CREATE INDEX imessage_receipts_space_idx ON app.imessage_receipts USING btree (space_hash, received_at)
  WHERE (outcome IS NULL);

REVOKE ALL ON FUNCTION "app"."cleanup_imessage_records"(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."cleanup_imessage_records"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."cleanup_imessage_records"(integer) TO "postgres";

SELECT cron.schedule_in_database('app-imessage-cleanup', '*/15 * * * *', 'select app.cleanup_imessage_records(500)', 'postgres', NULL, true);
