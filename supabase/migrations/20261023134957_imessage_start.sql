ALTER TABLE "app"."imessage_links"
  ADD COLUMN "starter_hash" text;

ALTER TABLE "app"."imessage_links"
  ADD COLUMN "source_hash" text;

ALTER TABLE "app"."imessage_links"
  ALTER COLUMN "host_account_id" DROP NOT NULL;

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_owner" CHECK (((host_account_id IS NOT NULL) OR ((method = 'code'::text) AND (starter_hash IS NOT NULL) AND (source_hash IS NOT NULL))));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_source_hash_check" CHECK ((source_hash ~ '^[0-9a-f]{64}$'::text));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_starter_hash_check" CHECK ((starter_hash ~ '^[0-9a-f]{64}$'::text));

CREATE UNIQUE INDEX imessage_links_open_starter_key ON app.imessage_links USING btree (starter_hash)
  WHERE ((host_account_id IS NULL) AND (state = ANY (ARRAY['pending'::text, 'received'::text])));

CREATE INDEX imessage_links_source_created_idx ON app.imessage_links USING btree (source_hash, created_at)
  WHERE (source_hash IS NOT NULL);
