SET local check_function_bodies = off;

CREATE TABLE "app"."email_links" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"        uuid                     NOT NULL,
  "code_hash"         text                     NOT NULL,
  "code_ciphertext"   text,
  "code_key_id"       text,
  "state"             text                     NOT NULL DEFAULT 'pending'::text,
  "expires_at"        timestamp with time zone NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at"          timestamp with time zone,
  "thread_binding_id" uuid,
  CONSTRAINT "email_links_code_hash_check" CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "email_links_code_hash_key" UNIQUE (code_hash),
  CONSTRAINT "email_links_ended" CHECK (((state = 'pending'::text) = (ended_at IS NULL))),
  CONSTRAINT "email_links_pending_code" CHECK (((state = 'pending'::text) OR (code_ciphertext IS NULL))),
  CONSTRAINT "email_links_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_links_sealed_code" CHECK (((code_ciphertext IS NULL) = (code_key_id IS NULL))),
  CONSTRAINT "email_links_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'consumed'::text, 'voided'::text])))
);

ALTER TABLE "app"."email_links"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."email_replies" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "kind"                text                     NOT NULL,
  "dedupe_key"          text                     NOT NULL,
  "request_id"          uuid,
  "binding_id"          uuid,
  "inbox_id"            text                     NOT NULL,
  "reply_to_message_id" text                     NOT NULL,
  "input_id"            uuid,
  "template"            text,
  "language"            text                     NOT NULL DEFAULT 'en'::text,
  "parameters"          jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "text"                text,
  "secret_ciphertext"   text,
  "secret_key_id"       text,
  "state"               text                     NOT NULL DEFAULT 'queued'::text,
  "evidence"            jsonb,
  "provider_message_id" text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "first_dispatched_at" timestamp with time zone,
  "completed_at"        timestamp with time zone,
  CONSTRAINT "email_replies_dedupe_key_check" CHECK (((char_length(dedupe_key) >= 1) AND (char_length(dedupe_key) <= 300))),
  CONSTRAINT "email_replies_final_cleared" CHECK (((completed_at IS NULL) OR ((text IS NULL) AND (secret_ciphertext IS NULL)))),
  CONSTRAINT "email_replies_final" CHECK (((state = ANY (ARRAY['accepted'::text, 'rejected'::text, 'uncertain'::text, 'suppressed'::text])) = (completed_at IS NOT NULL))),
  CONSTRAINT "email_replies_inbox_id_check" CHECK (((char_length(inbox_id) >= 1) AND (char_length(inbox_id) <= 320))),
  CONSTRAINT "email_replies_kind_check"
    CHECK ((kind = ANY (ARRAY['turn'::text, 'link_confirmation'::text, 'start_refusal'::text, 'closed'::text, 'too_long'::text, 'notice'::text]))),
  CONSTRAINT "email_replies_kind_dedupe_key_key" UNIQUE (kind, dedupe_key),
  CONSTRAINT "email_replies_language_check" CHECK ((language = ANY (ARRAY['en'::text, 'ko'::text]))),
  CONSTRAINT "email_replies_parameters_check" CHECK ((jsonb_typeof(parameters) = 'object'::text)),
  CONSTRAINT "email_replies_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_replies_reply_to_message_id_check" CHECK (((char_length(reply_to_message_id) >= 1) AND (char_length(reply_to_message_id) <= 1000))),
  CONSTRAINT "email_replies_sealed_secret" CHECK (((secret_ciphertext IS NULL) = (secret_key_id IS NULL))),
  CONSTRAINT "email_replies_state_check"
    CHECK ((state = ANY (ARRAY['waiting'::text, 'queued'::text, 'dispatching'::text, 'accepted'::text, 'rejected'::text, 'uncertain'::text, 'suppressed'::text]))),
  CONSTRAINT "email_replies_turn_input" CHECK (((kind <> 'turn'::text) OR (input_id IS NOT NULL) OR (completed_at IS NOT NULL)))
);

ALTER TABLE "app"."email_replies"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."email_threads" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"          uuid                     NOT NULL,
  "inbox_id"            text                     NOT NULL,
  "thread_id"           text                     NOT NULL,
  "origin"              text                     NOT NULL,
  "sender_hash"         text                     NOT NULL,
  "state"               text                     NOT NULL DEFAULT 'active'::text,
  "bound_by_receipt_id" uuid                     NOT NULL,
  "last_message_id"     text                     NOT NULL,
  "closed_notice_at"    timestamp with time zone,
  "bound_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at"            timestamp with time zone,
  CONSTRAINT "email_threads_ended" CHECK (((state = 'active'::text) = (ended_at IS NULL))),
  CONSTRAINT "email_threads_inbox_id_check" CHECK (((char_length(inbox_id) >= 1) AND (char_length(inbox_id) <= 320))),
  CONSTRAINT "email_threads_last_message_id_check" CHECK (((char_length(last_message_id) >= 1) AND (char_length(last_message_id) <= 1000))),
  CONSTRAINT "email_threads_origin_check" CHECK ((origin = ANY (ARRAY['started'::text, 'linked'::text]))),
  CONSTRAINT "email_threads_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_threads_sender_hash_check" CHECK ((sender_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "email_threads_state_check" CHECK ((state = ANY (ARRAY['active'::text, 'unlinked'::text]))),
  CONSTRAINT "email_threads_thread_id_check" CHECK (((char_length(thread_id) >= 1) AND (char_length(thread_id) <= 500)))
);

ALTER TABLE "app"."email_threads"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.cleanup_email_records (
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
  DELETE FROM app.email_replies
  WHERE id IN (
    SELECT id FROM app.email_replies
    WHERE completed_at IS NOT NULL AND created_at < now() - interval '30 days'
    LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.email_links
  WHERE id IN (
    SELECT l.id FROM app.email_links l JOIN app.requests r ON r.id = l.request_id
    WHERE l.state <> 'pending' AND r.created_at < now() - interval '30 days'
    LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.email_threads
  WHERE id IN (
    SELECT t.id FROM app.email_threads t JOIN app.requests r ON r.id = t.request_id
    WHERE r.created_at < now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM app.email_replies e WHERE e.binding_id = t.id AND e.completed_at IS NULL)
    LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.email_receipts
  WHERE id IN (
    SELECT id FROM app.email_receipts WHERE received_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  RETURN removed;
END;
$function$;

ALTER TABLE "app"."email_links"
  ADD CONSTRAINT "email_links_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."email_replies"
  ADD CONSTRAINT "email_replies_input_id_fkey" FOREIGN KEY (input_id) REFERENCES app.conversation_inputs(id) ON DELETE SET NULL;

ALTER TABLE "app"."email_replies"
  ADD CONSTRAINT "email_replies_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."email_links"
  ADD CONSTRAINT "email_links_thread_binding_id_fkey" FOREIGN KEY (thread_binding_id) REFERENCES app.email_threads(id) ON DELETE SET NULL;

ALTER TABLE "app"."email_replies"
  ADD CONSTRAINT "email_replies_binding_id_fkey" FOREIGN KEY (binding_id) REFERENCES app.email_threads(id) ON DELETE CASCADE;

ALTER TABLE "app"."email_threads"
  ADD CONSTRAINT "email_threads_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX email_links_pending_request_key ON app.email_links USING btree (request_id)
  WHERE (state = 'pending'::text);

CREATE INDEX email_links_request_created_idx ON app.email_links USING btree (request_id, created_at);

CREATE INDEX email_replies_created_idx ON app.email_replies USING btree (created_at);

CREATE INDEX email_replies_input_idx ON app.email_replies USING btree (input_id)
  WHERE (state = 'waiting'::text);

CREATE UNIQUE INDEX email_threads_active_request_key ON app.email_threads USING btree (request_id)
  WHERE (state = 'active'::text);

CREATE UNIQUE INDEX email_threads_active_thread_key ON app.email_threads USING btree (inbox_id, thread_id)
  WHERE (state = 'active'::text);

CREATE INDEX email_threads_request_idx ON app.email_threads USING btree (request_id, bound_at);

REVOKE ALL ON FUNCTION "app"."cleanup_email_records"(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."cleanup_email_records"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."cleanup_email_records"(integer) TO "postgres";

SELECT cron.schedule_in_database('app-email-cleanup', '*/15 * * * *', 'select app.cleanup_email_records(500)', 'postgres', NULL, true);
