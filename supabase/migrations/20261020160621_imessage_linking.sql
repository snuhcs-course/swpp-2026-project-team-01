CREATE TABLE "app"."imessage_inbound_events" (
  "id"           bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "webhook_id"   text                     NOT NULL,
  "message_id"   text                     NOT NULL,
  "sender"       text                     NOT NULL,
  "space_id"     text                     NOT NULL,
  "space_type"   text                     NOT NULL,
  "line"         text,
  "content_type" text                     NOT NULL,
  "body"         text,
  "sent_at"      timestamp with time zone,
  "state"        text                     NOT NULL DEFAULT 'received'::text,
  "received_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at" timestamp with time zone,
  CONSTRAINT "imessage_inbound_events_dedupe_key" UNIQUE (webhook_id, message_id),
  CONSTRAINT "imessage_inbound_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "imessage_inbound_events_state_check" CHECK ((state = ANY (ARRAY['received'::text, 'applied'::text, 'ignored'::text])))
);

ALTER TABLE "app"."imessage_inbound_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."imessage_links" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id"   uuid                     NOT NULL,
  "phone_e164"        text                     NOT NULL,
  "status"            text                     NOT NULL DEFAULT 'pending'::text,
  "valid_codes"       jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "code"              text,
  "expires_at"        timestamp with time zone NOT NULL,
  "retry_eligible_at" timestamp with time zone,
  "failure"           text,
  "wrong_replies"     integer                  NOT NULL DEFAULT 0,
  "space_id"          text,
  "line"              text,
  "revision"          integer                  NOT NULL DEFAULT 0,
  "connected_at"      timestamp with time zone,
  "closed_at"         timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "imessage_links_code_check" CHECK (((code IS NULL) OR (code ~ '^[0-9]{2}$'::text))),
  CONSTRAINT "imessage_links_phone_e164_check" CHECK ((phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text)),
  CONSTRAINT "imessage_links_pkey" PRIMARY KEY (id),
  CONSTRAINT "imessage_links_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'uncertain'::text, 'connected'::text, 'failed'::text, 'closed'::text]))),
  CONSTRAINT "imessage_links_wrong_replies_check" CHECK ((wrong_replies >= 0))
);

ALTER TABLE "app"."imessage_links"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."imessage_notify_requests" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "host_account_id" uuid                     NOT NULL,
  "link_id"         uuid,
  "channel"         text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "notified_at"     timestamp with time zone,
  CONSTRAINT "imessage_notify_requests_channel_check" CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text]))),
  CONSTRAINT "imessage_notify_requests_pkey" PRIMARY KEY (id)
);

ALTER TABLE "app"."imessage_notify_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."imessage_sends" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "link_id"             uuid                     NOT NULL,
  "host_account_id"     uuid                     NOT NULL,
  "scheduled_at"        timestamp with time zone NOT NULL,
  "state"               text                     NOT NULL DEFAULT 'queued'::text,
  "failure"             text,
  "provider_message_id" text,
  "sent_at"             timestamp with time zone,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "imessage_sends_pkey" PRIMARY KEY (id),
  CONSTRAINT "imessage_sends_state_check" CHECK ((state = ANY (ARRAY['queued'::text, 'sent'::text, 'uncertain'::text, 'failed'::text, 'skipped'::text])))
);

ALTER TABLE "app"."imessage_sends"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."imessage_notify_requests"
  ADD CONSTRAINT "imessage_notify_requests_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."imessage_notify_requests"
  ADD CONSTRAINT "imessage_notify_requests_link_id_fkey" FOREIGN KEY (link_id) REFERENCES app.imessage_links(id) ON DELETE SET NULL;

ALTER TABLE "app"."imessage_sends"
  ADD CONSTRAINT "imessage_sends_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."imessage_sends"
  ADD CONSTRAINT "imessage_sends_link_id_fkey" FOREIGN KEY (link_id) REFERENCES app.imessage_links(id) ON DELETE CASCADE;

CREATE INDEX imessage_inbound_events_received_idx ON app.imessage_inbound_events USING btree (received_at);

CREATE INDEX imessage_links_checking_idx ON app.imessage_links USING btree (phone_e164)
  WHERE (status = ANY (ARRAY['pending'::text, 'sent'::text, 'uncertain'::text, 'failed'::text]));

CREATE UNIQUE INDEX imessage_links_one_linked_idx ON app.imessage_links USING btree (phone_e164)
  WHERE (status = 'connected'::text);

CREATE UNIQUE INDEX imessage_links_one_open_idx ON app.imessage_links USING btree (host_account_id)
  WHERE (status <> 'closed'::text);

CREATE UNIQUE INDEX imessage_notify_requests_open_idx ON app.imessage_notify_requests USING btree (host_account_id, channel)
  WHERE (notified_at IS NULL);

CREATE INDEX imessage_sends_host_idx ON app.imessage_sends USING btree (host_account_id, scheduled_at);

CREATE INDEX imessage_sends_link_idx ON app.imessage_sends USING btree (link_id);
