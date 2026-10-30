-- The iMessage channel's retention (host-imessage-channel design 13, D14), run
-- every 15 minutes by pg_cron: it expires open link attempts past their window
-- (clearing their sealed values) and ends guest bindings 30 days after they were
-- made (guest-flow-completion design 2), and deletes receipts and outbound
-- messages older than 30 days whatever their state, and link attempts, bindings
-- and guest bindings that ended more than 30 days ago, at most row_limit rows of
-- each per run. Returns the number of rows deleted.
CREATE FUNCTION "app"."cleanup_imessage_records"("row_limit" integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  removed integer := 0;
  step integer;
BEGIN
  UPDATE app.imessage_links
  SET state = 'expired', ended_at = now(), code_ciphertext = NULL, phone_ciphertext = NULL,
      sender_ciphertext = NULL, space_ciphertext = NULL, fallback_code_hash = NULL
  WHERE (state = 'pending' AND expires_at <= now()) OR (state = 'received' AND confirm_by <= now());

  UPDATE app.requester_imessage_bindings
  SET state = 'ended', ended_at = now(), sender_ciphertext = NULL, space_ciphertext = NULL
  WHERE state = 'active' AND created_at <= now() - interval '30 days';

  DELETE FROM app.imessage_outbox
  WHERE id IN (
    SELECT id FROM app.imessage_outbox WHERE created_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.imessage_receipts
  WHERE id IN (
    SELECT id FROM app.imessage_receipts WHERE received_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.imessage_bindings
  WHERE id IN (
    SELECT id FROM app.imessage_bindings WHERE state = 'unlinked' AND ended_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.requester_imessage_bindings
  WHERE id IN (
    SELECT id FROM app.requester_imessage_bindings WHERE state <> 'active' AND ended_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  DELETE FROM app.imessage_links
  WHERE id IN (
    SELECT id FROM app.imessage_links WHERE ended_at < now() - interval '30 days' LIMIT row_limit
  );
  GET DIAGNOSTICS step = ROW_COUNT;
  removed := removed + step;

  RETURN removed;
END;
$$;
