-- KakaoTalk group chats the Mac relay's account is in
-- (kakaotalk-group-conversations design 2 to 5). A group is created when its
-- first member message arrives; it is the principal of one group_chat
-- discussion, owned by no host. room_hash is the keyed hash of the room ID in
-- the kakaotalk space namespace; the room ID itself is sealed
-- (room_ciphertext, context kakaotalk_group:{id}) for replies. left_at is set
-- when the account leaves, after which nothing more is recorded or answered.
CREATE TABLE "app"."kakaotalk_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "room_hash" text NOT NULL UNIQUE CHECK ("room_hash" ~ '^[0-9a-f]{64}$'),
  "room_ciphertext" text NOT NULL,
  "sealed_key_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "left_at" timestamptz
);

ALTER TABLE "app"."kakaotalk_groups" ENABLE ROW LEVEL SECURITY;

-- The recent messages of a group that did not call the assistant
-- (kakaotalk-group-conversations design 3): context for the next message
-- that does. Each is sealed (context kakaotalk_group_message:{id}) with the
-- sender's KakaoTalk name, and kept for 24 hours at most; the next call
-- consumes the ones it sends to the model.
CREATE TABLE "app"."kakaotalk_group_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" uuid NOT NULL REFERENCES "app"."kakaotalk_groups" ("id") ON DELETE CASCADE,
  "receipt_id" uuid NOT NULL UNIQUE,
  "text_ciphertext" text NOT NULL,
  "sealed_key_id" text NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "kakaotalk_group_messages_group_idx" ON "app"."kakaotalk_group_messages" ("group_id", "created_at");

ALTER TABLE "app"."kakaotalk_group_messages" ENABLE ROW LEVEL SECURITY;
