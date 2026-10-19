CREATE TABLE "app"."conversation_inputs" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "discussion_id"   uuid                     NOT NULL,
  "client_input_id" uuid                     NOT NULL,
  "fingerprint"     text                     NOT NULL,
  "message"         text                     NOT NULL,
  "state"           text                     NOT NULL DEFAULT 'accepted'::text,
  "session_id"      text,
  "accepted_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at"         timestamp with time zone,
  "completed_at"    timestamp with time zone,
  CONSTRAINT "conversation_inputs_client_input_key" UNIQUE (discussion_id, client_input_id),
  CONSTRAINT "conversation_inputs_pkey" PRIMARY KEY (id),
  CONSTRAINT "conversation_inputs_state_check" CHECK ((state = ANY (ARRAY['accepted'::text, 'sent'::text, 'completed'::text])))
);

ALTER TABLE "app"."conversation_inputs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."discussions" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "principal_type" text                     NOT NULL,
  "principal_id"   uuid                     NOT NULL,
  "audience"       text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "discussions_audience_check" CHECK ((audience = 'host_setup'::text)),
  CONSTRAINT "discussions_pkey" PRIMARY KEY (id),
  CONSTRAINT "discussions_principal_audience_key" UNIQUE (principal_type, principal_id, audience),
  CONSTRAINT "discussions_principal_type_check" CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text])))
);

ALTER TABLE "app"."discussions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."conversation_inputs"
  ADD CONSTRAINT "conversation_inputs_session_id_fkey" FOREIGN KEY (session_id) REFERENCES app.agent_sessions(session_id);

ALTER TABLE "app"."conversation_inputs"
  ADD CONSTRAINT "conversation_inputs_discussion_id_fkey" FOREIGN KEY (discussion_id) REFERENCES app.discussions(id);

CREATE INDEX conversation_inputs_session_state_idx ON app.conversation_inputs USING btree (session_id, state);
