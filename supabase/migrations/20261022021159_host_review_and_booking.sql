ALTER TABLE "app"."discussions"
  DROP CONSTRAINT "discussions_audience_check";

ALTER TABLE "app"."discussions"
  DROP CONSTRAINT "discussions_principal_audience_key";

ALTER TABLE "app"."email_deliveries"
  DROP CONSTRAINT "email_deliveries_kind_check";

CREATE TABLE "app"."approvals" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"       uuid                     NOT NULL,
  "proposal_id"      uuid                     NOT NULL,
  "host_account_id"  uuid                     NOT NULL,
  "request_revision" integer                  NOT NULL,
  "retry_key"        text                     NOT NULL,
  "approved_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "spent_at"         timestamp with time zone,
  CONSTRAINT "approvals_pkey" PRIMARY KEY (id),
  CONSTRAINT "approvals_request_revision_check" CHECK ((request_revision >= 1)),
  CONSTRAINT "approvals_retry_key_check" CHECK (((char_length(retry_key) >= 1) AND (char_length(retry_key) <= 200)))
);

ALTER TABLE "app"."approvals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."bookings" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"       uuid                     NOT NULL,
  "proposal_id"      uuid                     NOT NULL,
  "approval_id"      uuid                     NOT NULL,
  "host_account_id"  uuid                     NOT NULL,
  "calendar_id"      text                     NOT NULL,
  "event_id"         text                     NOT NULL,
  "start_at"         timestamp with time zone NOT NULL,
  "end_at"           timestamp with time zone NOT NULL,
  "reserved_start"   timestamp with time zone NOT NULL,
  "reserved_end"     timestamp with time zone NOT NULL,
  "state"            text                     NOT NULL DEFAULT 'reserved'::text,
  "payload"          jsonb,
  "evidence"         jsonb,
  "failure_category" text,
  "attempts"         integer                  NOT NULL DEFAULT 0,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "dispatched_at"    timestamp with time zone,
  "confirmed_at"     timestamp with time zone,
  "settled_at"       timestamp with time zone,
  CONSTRAINT "bookings_confirmed" CHECK (((state = 'confirmed'::text) = (confirmed_at IS NOT NULL))),
  CONSTRAINT "bookings_dispatched" CHECK (((state = 'reserved'::text) OR (state = 'cancelled'::text) OR (dispatched_at IS NOT NULL) OR (state = 'failed'::text))),
  CONSTRAINT "bookings_event_id_check" CHECK (((event_id ~ '^[0-9a-v]{5,}$'::text) AND (char_length(event_id) <= 1024))),
  CONSTRAINT "bookings_event_id_key" UNIQUE (event_id),
  CONSTRAINT "bookings_evidence_check" CHECK ((jsonb_typeof(evidence) = 'object'::text)),
  CONSTRAINT "bookings_interval" CHECK (((start_at < end_at) AND (reserved_start <= start_at) AND (end_at <= reserved_end))),
  CONSTRAINT "bookings_payload_check" CHECK ((jsonb_typeof(payload) = 'object'::text)),
  CONSTRAINT "bookings_payload" CHECK (((state = ANY (ARRAY['reserved'::text, 'cancelled'::text, 'failed'::text])) OR (payload IS NOT NULL))),
  CONSTRAINT "bookings_pkey" PRIMARY KEY (id),
  CONSTRAINT "bookings_state_check" CHECK ((state = ANY (ARRAY['reserved'::text, 'dispatching'::text, 'confirmed'::text, 'failed'::text, 'cancelled'::text])))
);

ALTER TABLE "app"."bookings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."request_exceptions" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"        uuid                     NOT NULL,
  "host_account_id"   uuid                     NOT NULL,
  "kind"              text                     NOT NULL,
  "settings_revision" integer                  NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "invalidated_at"    timestamp with time zone,
  CONSTRAINT "request_exceptions_kind_check" CHECK ((kind = 'weekly_limit'::text)),
  CONSTRAINT "request_exceptions_pkey" PRIMARY KEY (id),
  CONSTRAINT "request_exceptions_settings_revision_check" CHECK ((settings_revision >= 1))
);

ALTER TABLE "app"."request_exceptions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."shared_change_drafts" (
  "id"                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"            uuid                     NOT NULL,
  "source"                text                     NOT NULL,
  "base_revision"         integer                  NOT NULL,
  "base_proposal_version" integer,
  "changes"               jsonb                    NOT NULL,
  "state"                 text                     NOT NULL DEFAULT 'pending'::text,
  "evaluation_id"         uuid,
  "proposal_version"      integer,
  "rejection_reason"      text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at"           timestamp with time zone,
  CONSTRAINT "shared_change_drafts_base_revision_check" CHECK ((base_revision >= 1)),
  CONSTRAINT "shared_change_drafts_changes_check" CHECK ((jsonb_typeof(changes) = 'object'::text)),
  CONSTRAINT "shared_change_drafts_pkey" PRIMARY KEY (id),
  CONSTRAINT "shared_change_drafts_resolved" CHECK (((state = ANY (ARRAY['pending'::text, 'checking'::text])) = (resolved_at IS NULL))),
  CONSTRAINT "shared_change_drafts_source_check" CHECK ((source = ANY (ARRAY['assistant'::text, 'host'::text]))),
  CONSTRAINT "shared_change_drafts_state_check"
    CHECK ((state = ANY (ARRAY['pending'::text, 'checking'::text, 'shared'::text, 'dismissed'::text, 'superseded'::text, 'rejected'::text])))
);

ALTER TABLE "app"."shared_change_drafts"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."discussions"
  ADD COLUMN "request_id" uuid;

ALTER TABLE "app"."email_deliveries"
  ADD COLUMN "reply_to" text;

ALTER TABLE "app"."email_deliveries"
  ADD COLUMN "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "app"."approvals"
  ADD CONSTRAINT "approvals_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."approvals"
  ADD CONSTRAINT "approvals_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES app.proposals(id) ON DELETE CASCADE;

ALTER TABLE "app"."approvals"
  ADD CONSTRAINT "approvals_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."bookings"
  ADD CONSTRAINT "bookings_approval_id_fkey" FOREIGN KEY (approval_id) REFERENCES app.approvals(id) ON DELETE CASCADE;

ALTER TABLE "app"."bookings"
  ADD CONSTRAINT "bookings_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."bookings"
  ADD CONSTRAINT "bookings_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES app.proposals(id) ON DELETE CASCADE;

ALTER TABLE "app"."bookings"
  ADD CONSTRAINT "bookings_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."discussions"
  ADD CONSTRAINT "discussions_audience_check" CHECK ((audience = ANY (ARRAY['host_setup'::text, 'host_review'::text, 'public_intake'::text, 'requester'::text])));

ALTER TABLE "app"."discussions"
  ADD CONSTRAINT "discussions_host_review_request" CHECK (((audience = 'host_review'::text) = (request_id IS NOT NULL)));

ALTER TABLE "app"."discussions"
  ADD CONSTRAINT "discussions_principal_audience_key" UNIQUE NULLS NOT DISTINCT (principal_type, principal_id, audience, request_id);

ALTER TABLE "app"."discussions"
  ADD CONSTRAINT "discussions_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_attachments_check" CHECK ((jsonb_typeof(attachments) = 'array'::text));

ALTER TABLE "app"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_kind_check"
    CHECK
    ((kind = ANY (ARRAY['request_creation'::text, 'link_resend'::text, 'booking_confirmation'::text, 'status_new_version'::text, 'status_declined'::text, 'status_expired'::text,
    'status_pending'::text])));

ALTER TABLE "app"."request_exceptions"
  ADD CONSTRAINT "request_exceptions_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."request_exceptions"
  ADD CONSTRAINT "request_exceptions_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

ALTER TABLE "app"."shared_change_drafts"
  ADD CONSTRAINT "shared_change_drafts_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES app.evaluations(id) ON DELETE SET NULL;

ALTER TABLE "app"."shared_change_drafts"
  ADD CONSTRAINT "shared_change_drafts_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX approvals_one_live_idx ON app.approvals USING btree (proposal_id)
  WHERE (spent_at IS NULL);

CREATE INDEX approvals_request_idx ON app.approvals USING btree (request_id, approved_at DESC);

CREATE INDEX bookings_host_reserved_idx ON app.bookings USING btree (host_account_id, reserved_start)
  WHERE (state = ANY (ARRAY['dispatching'::text, 'confirmed'::text]));

CREATE UNIQUE INDEX bookings_one_live_idx ON app.bookings USING btree (request_id)
  WHERE (state = ANY (ARRAY['reserved'::text, 'dispatching'::text, 'confirmed'::text]));

CREATE UNIQUE INDEX request_exceptions_one_live_idx ON app.request_exceptions USING btree (request_id, kind)
  WHERE (invalidated_at IS NULL);

CREATE UNIQUE INDEX shared_change_drafts_one_open_idx ON app.shared_change_drafts USING btree (request_id)
  WHERE (state = ANY (ARRAY['pending'::text, 'checking'::text]));
