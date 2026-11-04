ALTER TABLE "app"."imessage_bindings"
  DROP CONSTRAINT "imessage_bindings_channel_check";

ALTER TABLE "app"."imessage_links"
  DROP CONSTRAINT "imessage_links_channel_check";

ALTER TABLE "app"."imessage_outbox"
  DROP CONSTRAINT "imessage_outbox_channel_check";

ALTER TABLE "app"."imessage_receipts"
  DROP CONSTRAINT "imessage_receipts_channel_check";

ALTER TABLE "app"."imessage_bindings"
  ADD CONSTRAINT "imessage_bindings_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text])));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text])));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text])));

ALTER TABLE "app"."imessage_receipts"
  ADD CONSTRAINT "imessage_receipts_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text])));
