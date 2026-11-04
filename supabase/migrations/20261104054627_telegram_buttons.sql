ALTER TABLE "app"."imessage_outbox"
  DROP CONSTRAINT "imessage_outbox_kind_check";

ALTER TABLE "app"."imessage_outbox"
  ADD COLUMN "buttons" jsonb;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_buttons"
    CHECK
    (((buttons IS NULL) OR ((channel = 'telegram'::text) AND (jsonb_typeof(buttons) = 'object'::text) AND ((buttons ->> 'kind'::text) = ANY (ARRAY['decision'::text,
    'settings'::text])))));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_kind_check"
    CHECK
    ((kind = ANY (ARRAY['link_received'::text, 'link_refused'::text, 'linked'::text, 'fallback_code'::text, 'unlinked_sender'::text, 'text_only'::text, 'command'::text,
    'turn'::text, 'notice'::text, 'contact_card'::text, 'signal'::text, 'template'::text, 'edit_markup'::text, 'callback_answer'::text])));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_telegram_kinds" CHECK (((kind <> ALL (ARRAY['edit_markup'::text, 'callback_answer'::text])) OR (channel = 'telegram'::text)));

CREATE INDEX imessage_outbox_buttons_idx ON app.imessage_outbox USING btree (request_id)
  WHERE (buttons IS NOT NULL);
