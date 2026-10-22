-- The administrator CLI's AgentMail receiver writes (requester-email-channel
-- D10). Registering records an enabled receiver for the inbox with the signing
-- secret's fingerprint and disables the inbox's earlier receiver in the same
-- transaction; disabling turns one receiver off. Each returns the receiver's id,
-- inbox and state. Execution is revoked from PUBLIC; no web route calls them.
CREATE FUNCTION "app"."operator_register_email_receiver"(
  "inbox" text,
  "webhook" text,
  "fingerprint" text,
  "operator_name" text,
  "environment" text
)
RETURNS TABLE ("result_receiver_id" uuid, "result_inbox_id" text, "result_state" text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  created uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('app.email_receiver:' || inbox, 0));

  UPDATE app.email_receivers r
  SET state = 'disabled', disabled_at = now(), disabled_by = operator_name
  WHERE r.inbox_id = inbox AND r.state = 'enabled';

  INSERT INTO app.email_receivers (inbox_id, webhook_id, secret_fingerprint, operator, environment)
  VALUES (inbox, webhook, fingerprint, operator_name, environment)
  RETURNING id INTO created;

  RETURN QUERY SELECT created, inbox, 'enabled'::text;
END;
$$;

CREATE FUNCTION "app"."operator_disable_email_receiver"("receiver" uuid, "operator_name" text)
RETURNS TABLE ("result_receiver_id" uuid, "result_inbox_id" text, "result_state" text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE app.email_receivers r
  SET state = 'disabled', disabled_at = now(), disabled_by = operator_name
  WHERE r.id = receiver AND r.state = 'enabled';

  RETURN QUERY SELECT r.id, r.inbox_id, r.state FROM app.email_receivers r WHERE r.id = receiver;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown receiver' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
