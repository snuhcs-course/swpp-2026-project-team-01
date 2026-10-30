SET local check_function_bodies = off;

DROP INDEX "app"."imessage_links_open_starter_key";

ALTER TABLE "app"."imessage_links"
  DROP CONSTRAINT "imessage_links_owner";

CREATE TABLE "app"."requester_imessage_bindings" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"          uuid                     NOT NULL,
  "link_id"             uuid,
  "sender_hash"         text                     NOT NULL,
  "sender_ciphertext"   text,
  "space_ciphertext"    text,
  "sealed_key_id"       text,
  "state"               text                     NOT NULL DEFAULT 'active'::text,
  "moved_to_request_id" uuid,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "last_inbound_at"     timestamp with time zone,
  "last_notified_at"    timestamp with time zone,
  "ended_at"            timestamp with time zone,
  CONSTRAINT "requester_imessage_bindings_ended_cleared" CHECK (((ended_at IS NULL) OR ((sender_ciphertext IS NULL) AND (space_ciphertext IS NULL)))),
  CONSTRAINT "requester_imessage_bindings_ended" CHECK (((state = 'active'::text) = (ended_at IS NULL))),
  CONSTRAINT "requester_imessage_bindings_moved" CHECK (((state = 'moved'::text) = (moved_to_request_id IS NOT NULL))),
  CONSTRAINT "requester_imessage_bindings_pkey" PRIMARY KEY (id),
  CONSTRAINT "requester_imessage_bindings_sealed" CHECK (((state <> 'active'::text) OR ((sender_ciphertext IS NOT NULL) AND (sealed_key_id IS NOT NULL)))),
  CONSTRAINT "requester_imessage_bindings_sender_hash_check" CHECK ((sender_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "requester_imessage_bindings_state_check" CHECK ((state = ANY (ARRAY['active'::text, 'unlinked'::text, 'ended'::text, 'moved'::text])))
);

ALTER TABLE "app"."requester_imessage_bindings"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."imessage_links"
  ADD COLUMN "request_id" uuid;

ALTER TABLE "app"."imessage_outbox"
  ADD COLUMN "requester_binding_id" uuid;

ALTER TABLE "app"."requests"
  ADD COLUMN "revised_from_request_id" uuid;

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

  UPDATE app.requester_imessage_bindings
  SET state = 'ended', ended_at = now(), sender_ciphertext = NULL, space_ciphertext = NULL
  WHERE state = 'active' AND created_at <= now() - interval '30 days';

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

  DELETE FROM app.requester_imessage_bindings
  WHERE id IN (
    SELECT id FROM app.requester_imessage_bindings WHERE state <> 'active' AND ended_at < now() - interval '30 days' LIMIT row_limit
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

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_owner" CHECK ((((host_account_id IS NOT NULL) AND (request_id IS NULL)) OR ((request_id IS
    NOT NULL) AND (host_account_id IS NULL) AND (method = 'code'::text)) OR ((host_account_id IS NULL) AND (request_id IS NULL) AND (method = 'code'::text) AND (starter_hash IS
    NOT NULL) AND (source_hash IS NOT NULL))));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_one_binding" CHECK (((binding_id IS NULL) OR (requester_binding_id IS NULL)));

ALTER TABLE "app"."requester_imessage_bindings"
  ADD CONSTRAINT "requester_imessage_bindings_link_id_fkey" FOREIGN KEY (link_id) REFERENCES app.imessage_links(id) ON DELETE SET NULL;

ALTER TABLE "app"."requester_imessage_bindings"
  ADD CONSTRAINT "requester_imessage_bindings_moved_to_request_id_fkey" FOREIGN KEY (moved_to_request_id) REFERENCES app.requests(id) ON DELETE SET NULL;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_requester_binding_id_fkey" FOREIGN KEY (requester_binding_id) REFERENCES app.requester_imessage_bindings(id) ON DELETE CASCADE;

ALTER TABLE "app"."requester_imessage_bindings"
  ADD CONSTRAINT "requester_imessage_bindings_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_revised_from_request_id_fkey" FOREIGN KEY (revised_from_request_id) REFERENCES app.requests(id) ON DELETE SET NULL;

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_revised_from_request_id_key" UNIQUE (revised_from_request_id);

CREATE UNIQUE INDEX imessage_links_open_request_key ON app.imessage_links USING btree (request_id)
  WHERE (state = ANY (ARRAY['pending'::text, 'received'::text]));

CREATE UNIQUE INDEX imessage_links_open_starter_key ON app.imessage_links USING btree (starter_hash)
  WHERE ((host_account_id IS NULL) AND (request_id IS NULL) AND (state = ANY (ARRAY['pending'::text, 'received'::text])));

CREATE INDEX imessage_links_request_created_idx ON app.imessage_links USING btree (request_id, created_at)
  WHERE (request_id IS NOT NULL);

CREATE INDEX imessage_outbox_recipient_last_idx ON app.imessage_outbox USING btree (recipient_hash, created_at DESC);

CREATE UNIQUE INDEX requester_imessage_bindings_active_request_key ON app.requester_imessage_bindings USING btree (request_id)
  WHERE (state = 'active'::text);

CREATE INDEX requester_imessage_bindings_active_sender_idx ON app.requester_imessage_bindings USING btree (sender_hash, created_at DESC)
  WHERE (state = 'active'::text);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "app"."requester_imessage_bindings" TO "postgres";
