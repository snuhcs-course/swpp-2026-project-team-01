SET local check_function_bodies = off;

ALTER TABLE "app"."imessage_bindings"
  ADD COLUMN "sender_name_ciphertext" text;

ALTER TABLE "app"."imessage_links"
  ADD COLUMN "sender_name_ciphertext" text;

CREATE OR REPLACE FUNCTION app.clear_sender_name()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  IF NEW.sender_ciphertext IS NULL THEN
    NEW.sender_name_ciphertext := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE "app"."imessage_bindings"
  ADD CONSTRAINT "imessage_bindings_sender_name" CHECK (((sender_name_ciphertext IS NULL) OR (sender_ciphertext IS NOT NULL)));

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_sender_name" CHECK (((sender_name_ciphertext IS NULL) OR (sender_ciphertext IS NOT NULL)));

CREATE TRIGGER imessage_bindings_clear_sender_name
  BEFORE INSERT OR UPDATE ON app.imessage_bindings
  FOR EACH ROW
  EXECUTE FUNCTION app.clear_sender_name();

CREATE TRIGGER imessage_links_clear_sender_name
  BEFORE INSERT OR UPDATE ON app.imessage_links
  FOR EACH ROW
  EXECUTE FUNCTION app.clear_sender_name();

REVOKE ALL ON FUNCTION "app"."clear_sender_name"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."clear_sender_name"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."clear_sender_name"() TO "postgres";
