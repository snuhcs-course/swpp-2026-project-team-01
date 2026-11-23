CREATE TRIGGER "host_accounts_clear_assistant_notes"
BEFORE INSERT OR UPDATE ON "app"."host_accounts"
FOR EACH ROW
EXECUTE FUNCTION "app"."clear_assistant_notes"();
