CREATE TABLE "app"."command_outcomes" (
  "actor"       text                     NOT NULL,
  "retry_key"   text                     NOT NULL,
  "operation"   text                     NOT NULL,
  "resource_id" text                     NOT NULL,
  "input_hash"  text                     NOT NULL,
  "result"      jsonb                    NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "command_outcomes_pkey" PRIMARY KEY (actor, retry_key),
  CONSTRAINT "command_outcomes_retry_key_check" CHECK (((char_length(retry_key) >= 1) AND (char_length(retry_key) <= 200)))
);

ALTER TABLE "app"."command_outcomes"
  ENABLE ROW LEVEL SECURITY;
