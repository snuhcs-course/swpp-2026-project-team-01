-- The requester's agreement to one exact proposal version, written only by
-- request.agree; a message such as "yes" records nothing. request_revision is the
-- request revision the agreement was made at, and retry_key the card's retry
-- identity.
CREATE TABLE "app"."agreements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "proposal_id" uuid NOT NULL UNIQUE REFERENCES "app"."proposals" ("id") ON DELETE CASCADE,
  "request_revision" integer NOT NULL CHECK ("request_revision" >= 1),
  "retry_key" text NOT NULL CHECK (char_length("retry_key") BETWEEN 1 AND 200),
  "agreed_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "app"."agreements" ENABLE ROW LEVEL SECURITY;
