ALTER TABLE "app"."requests"
  DROP CONSTRAINT "requests_identified_contact";

ALTER TABLE "app"."host_settings"
  ADD COLUMN "tutorial_offered" boolean NOT NULL DEFAULT false;

ALTER TABLE "app"."host_settings"
  ADD COLUMN "tutorial_binding_id" uuid;

ALTER TABLE "app"."requests"
  ADD COLUMN "is_sample" boolean NOT NULL DEFAULT false;

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_identified_contact" CHECK (((state = 'draft'::text) OR ((requester_name IS NOT NULL) AND (is_sample OR (contact_email IS NOT NULL)))));

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_sample_no_contact" CHECK (((NOT is_sample) OR ((contact_email IS NULL) AND (contact_confirmed_email IS NULL))));

CREATE UNIQUE INDEX requests_one_sample_per_host_idx ON app.requests USING btree (host_account_id)
  WHERE is_sample;
