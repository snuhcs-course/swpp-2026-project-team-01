ALTER TABLE "app"."imessage_links"
  DROP CONSTRAINT "imessage_links_request_channel";

ALTER TABLE "app"."requester_imessage_bindings"
  ADD COLUMN "channel" text NOT NULL DEFAULT 'imessage'::text;

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_line_number_channel" CHECK (((line_number IS NULL) OR (channel = 'imessage'::text)));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_request_channel" CHECK (((request_id IS NULL) OR (channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text]))));

ALTER TABLE "app"."requester_imessage_bindings"
  ADD CONSTRAINT "requester_imessage_bindings_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text])));
