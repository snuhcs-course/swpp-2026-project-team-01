-- A sealed Telegram display name never outlives the sealed sender it belongs to
-- (host-telegram-channel design 3): every write that clears sender_ciphertext on
-- a link attempt or a binding (ending, unlinking, stop, a blocked bot, cleanup)
-- clears sender_name_ciphertext too, without each path naming it.
CREATE FUNCTION "app"."clear_sender_name"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.sender_ciphertext IS NULL THEN
    NEW.sender_name_ciphertext := NULL;
  END IF;
  RETURN NEW;
END;
$$;
