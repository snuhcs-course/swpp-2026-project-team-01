CREATE TRIGGER "imessage_links_clear_sender_name"
BEFORE INSERT OR UPDATE ON "app"."imessage_links"
FOR EACH ROW
EXECUTE FUNCTION "app"."clear_sender_name"();

CREATE TRIGGER "imessage_bindings_clear_sender_name"
BEFORE INSERT OR UPDATE ON "app"."imessage_bindings"
FOR EACH ROW
EXECUTE FUNCTION "app"."clear_sender_name"();
