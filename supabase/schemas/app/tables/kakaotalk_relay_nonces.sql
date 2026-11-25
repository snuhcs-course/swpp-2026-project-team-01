-- Nonces the KakaoTalk relay phone signed its requests with (host-kakaotalk-
-- channel design 2, D2). A request is accepted only when its nonce is new, so a
-- correctly signed request replayed within the five-minute timestamp window is
-- refused. Rows older than ten minutes no longer guard anything (the timestamp
-- check refuses them first) and are deleted by the routes as they go. Only the
-- random nonce and its route class are kept, never a body or signature.
CREATE TABLE "app"."kakaotalk_relay_nonces" (
  "nonce" text PRIMARY KEY CHECK ("nonce" ~ '^[0-9a-f]{32}$'),
  "route_class" text NOT NULL CHECK ("route_class" IN ('inbound', 'outbox')),
  "seen_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "kakaotalk_relay_nonces_seen_idx" ON "app"."kakaotalk_relay_nonces" ("seen_at");

ALTER TABLE "app"."kakaotalk_relay_nonces" ENABLE ROW LEVEL SECURITY;
