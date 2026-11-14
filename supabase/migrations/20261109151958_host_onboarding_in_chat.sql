ALTER TABLE "app"."imessage_outbox"
  DROP CONSTRAINT "imessage_outbox_kind_check";

ALTER TABLE "app"."imessage_bindings"
  ADD COLUMN "hours_question_sent_at" timestamp WITH time zone;

ALTER TABLE "app"."imessage_outbox"
  ADD COLUMN "review_hash" text;

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_image_review" CHECK (((kind = 'image'::text) = (review_hash IS NOT NULL)));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_kind_check"
    CHECK
    ((kind = ANY (ARRAY['link_received'::text, 'link_refused'::text, 'linked'::text, 'fallback_code'::text, 'unlinked_sender'::text, 'text_only'::text, 'command'::text,
    'turn'::text, 'notice'::text, 'image'::text, 'contact_card'::text, 'signal'::text, 'template'::text, 'edit_markup'::text, 'callback_answer'::text])));

ALTER TABLE "app"."imessage_outbox"
  ADD CONSTRAINT "imessage_outbox_review_hash_check" CHECK ((review_hash ~ '^[0-9a-f]{64}$'::text));
