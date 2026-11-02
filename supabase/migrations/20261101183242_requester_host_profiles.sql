CREATE TABLE "app"."requester_host_profiles" (
  "request_id"      uuid                     NOT NULL,
  "host_account_id" uuid                     NOT NULL,
  "items"           text[]                   NOT NULL DEFAULT '{}'::text[],
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "decided_at"      timestamp with time zone,
  CONSTRAINT "requester_host_profiles_items_check" CHECK ((items <@ ARRAY['calendars'::text, 'details'::text])),
  CONSTRAINT "requester_host_profiles_pkey" PRIMARY KEY (request_id)
);

ALTER TABLE "app"."requester_host_profiles"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."requester_host_profiles"
  ADD CONSTRAINT "requester_host_profiles_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

ALTER TABLE "app"."requester_host_profiles"
  ADD CONSTRAINT "requester_host_profiles_request_id_fkey" FOREIGN KEY (request_id) REFERENCES app.requests(id) ON DELETE CASCADE;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "app"."requester_host_profiles" TO "postgres";
