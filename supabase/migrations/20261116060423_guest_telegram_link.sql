ALTER TABLE "app"."imessage_links"
  DROP CONSTRAINT "imessage_links_request_channel";

ALTER TABLE "app"."requester_imessage_bindings"
  DROP CONSTRAINT "requester_imessage_bindings_channel_check";

ALTER TABLE "app"."requester_imessage_bindings"
  ADD COLUMN "sender_name_ciphertext" text;

ALTER TABLE "app"."requester_imessage_bindings"
  ADD CONSTRAINT "requester_imessage_bindings_channel_check" CHECK ((channel = ANY (ARRAY['imessage'::text, 'whatsapp'::text, 'telegram'::text])));

ALTER TABLE "app"."requester_imessage_bindings"
  ADD CONSTRAINT "requester_imessage_bindings_sender_name" CHECK (((sender_name_ciphertext IS NULL) OR (sender_ciphertext IS NOT NULL)));

CREATE TRIGGER requester_imessage_bindings_clear_sender_name
  BEFORE INSERT OR UPDATE ON app.requester_imessage_bindings
  FOR EACH ROW
  EXECUTE FUNCTION app.clear_sender_name();
