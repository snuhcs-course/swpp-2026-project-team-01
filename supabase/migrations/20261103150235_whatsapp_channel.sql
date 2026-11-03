ALTER TABLE "app"."imessage_outbox"
  DROP CONSTRAINT "imessage_outbox_kind_check";

ALTER TABLE "app"."imessage_bindings"
  ADD COLUMN "channel" text NOT NULL DEFAULT 'imessage'::text;

ALTER TABLE "app"."imessage_links"
  ADD COLUMN "channel" text NOT NULL DEFAULT 'imessage'::text;

ALTER TABLE "app"."imessage_outbox"
  ADD COLUMN "channel" text NOT NULL DEFAULT 'imessage'::text;

ALTER TABLE "app"."imessage_outbox"
  ADD COLUMN "template_name" text;

ALTER TABLE "app"."imessage_receipts"
  ADD COLUMN "channel" text NOT NULL DEFAULT 'imessage'::text;

ALTER TABLE "app"."imessage_bindings"
  ADD CONSTRAINT "imessage_bindings_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text])));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text])));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_fallback_channel" CHECK (((method <> 'fallback'::text) OR (channel = 'imessage'::text)));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_request_channel" CHECK (((request_id IS NULL) OR (channel = 'imessage'::text)));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text])));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_kind_check"
    CHECK
    ((kind = ANY (ARRAY['link_received'::text, 'link_refused'::text, 'linked'::text, 'fallback_code'::text, 'unlinked_sender'::text, 'text_only'::text, 'command'::text,
    'turn'::text, 'notice'::text, 'contact_card'::text, 'template'::text])));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_template_name_check" CHECK ((template_name ~ '^[a-z0-9_]{1,100}$'::text));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_template" CHECK ((((kind = 'template'::text) = (template_name IS NOT NULL)) AND ((kind <> 'template'::text) OR (channel = 'whatsapp'::text))));

ALTER TABLE "app"."imessage_receipts"
  ADD CONSTRAINT "imessage_receipts_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text])));
