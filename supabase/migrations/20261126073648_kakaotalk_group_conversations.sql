ALTER TABLE "app"."admission_windows"
  DROP CONSTRAINT "admission_windows_scope_check";

ALTER TABLE "app"."agent_sessions"
  DROP CONSTRAINT "agent_sessions_principal_type_check";

ALTER TABLE "app"."discussions"
  DROP CONSTRAINT "discussions_audience_check";

ALTER TABLE "app"."discussions"
  DROP CONSTRAINT "discussions_principal_type_check";

ALTER TABLE "app"."model_reservations"
  DROP CONSTRAINT "model_reservations_principal_type_check";

CREATE TABLE "app"."kakaotalk_group_messages" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "group_id"        uuid                     NOT NULL,
  "receipt_id"      uuid                     NOT NULL,
  "text_ciphertext" text                     NOT NULL,
  "sealed_key_id"   text                     NOT NULL,
  "sent_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "kakaotalk_group_messages_pkey" PRIMARY KEY (id),
  CONSTRAINT "kakaotalk_group_messages_receipt_id_key" UNIQUE (receipt_id)
);

ALTER TABLE "app"."kakaotalk_group_messages"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "app"."kakaotalk_groups" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "room_hash"       text                     NOT NULL,
  "room_ciphertext" text                     NOT NULL,
  "sealed_key_id"   text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "left_at"         timestamp with time zone,
  CONSTRAINT "kakaotalk_groups_pkey" PRIMARY KEY (id),
  CONSTRAINT "kakaotalk_groups_room_hash_check" CHECK ((room_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "kakaotalk_groups_room_hash_key" UNIQUE (room_hash)
);

ALTER TABLE "app"."kakaotalk_groups"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."admission_windows"
  ADD CONSTRAINT "admission_windows_scope_check" CHECK ((scope = ANY (ARRAY['host'::text, 'request'::text, 'intake'::text, 'group'::text, 'service'::text])));

ALTER TABLE "app"."agent_sessions"
  ADD CONSTRAINT "agent_sessions_principal_type_check"
    CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text, 'public_intake'::text, 'kakaotalk_group'::text])));

ALTER TABLE "app"."discussions"
  ADD CONSTRAINT "discussions_audience_check"
    CHECK ((audience = ANY (ARRAY['host_setup'::text, 'host_review'::text, 'public_intake'::text, 'requester'::text, 'group_chat'::text])));

ALTER TABLE "app"."discussions"
  ADD CONSTRAINT "discussions_principal_type_check"
    CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text, 'public_intake'::text, 'kakaotalk_group'::text])));

ALTER TABLE "app"."kakaotalk_group_messages"
  ADD CONSTRAINT "kakaotalk_group_messages_group_id_fkey" FOREIGN KEY (group_id) REFERENCES app.kakaotalk_groups(id) ON DELETE CASCADE;

ALTER TABLE "app"."model_reservations"
  ADD CONSTRAINT "model_reservations_principal_type_check"
    CHECK ((principal_type = ANY (ARRAY['host_account'::text, 'requester_request'::text, 'public_intake'::text, 'kakaotalk_group'::text])));

CREATE INDEX kakaotalk_group_messages_group_idx ON app.kakaotalk_group_messages USING btree (group_id, created_at);
