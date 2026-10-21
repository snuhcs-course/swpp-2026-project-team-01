-- The requester's credential for one request (design decision 7). Lookup always
-- uses link_hash, the SHA-256 of the booking UUID. The UUID itself is sealed with
-- AES-256-GCM under the key named by link_key_id (context booking_link:{requestId})
-- and is opened only to resend the link or to finish the requester's Google
-- return, so a database read without the key yields no usable link. A link
-- expires 30 days after creation.
CREATE TABLE "app"."booking_links" (
  "request_id" uuid PRIMARY KEY REFERENCES "app"."requests" ("id") ON DELETE CASCADE,
  "link_hash" text NOT NULL UNIQUE,
  "link_ciphertext" text NOT NULL,
  "link_key_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

ALTER TABLE "app"."booking_links" ENABLE ROW LEVEL SECURITY;
