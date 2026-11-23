-- A deleted host keeps no notes for Thyme (host-preference-notes; data-
-- stewardship: deletion on request): every write that marks the account
-- deleted clears them, without the deletion function naming them.
CREATE FUNCTION "app"."clear_assistant_notes"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.assistant_notes := NULL;
    NEW.assistant_notes_updated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
