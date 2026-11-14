CREATE TABLE "app"."calendar_note_weekly_reviews" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_account_id" uuid                     NOT NULL,
  "week"            date                     NOT NULL,
  "analysis_id"     uuid,
  "timezone"        text                     NOT NULL,
  "items"           jsonb                    NOT NULL,
  "pending_choice"  jsonb,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_note_weekly_reviews_host" UNIQUE (host_account_id),
  CONSTRAINT "calendar_note_weekly_reviews_items_check" CHECK (((jsonb_typeof(items) = 'array'::text) AND ((jsonb_array_length(items) >= 1) AND (jsonb_array_length(items) <= 100)))),
  CONSTRAINT "calendar_note_weekly_reviews_pending_choice_check" CHECK (((pending_choice IS NULL) OR (jsonb_typeof(pending_choice) = 'object'::text))),
  CONSTRAINT "calendar_note_weekly_reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "calendar_note_weekly_reviews_timezone_check" CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 100)))
);

ALTER TABLE "app"."calendar_note_weekly_reviews"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app"."calendar_note_weekly_reviews"
  ADD CONSTRAINT "calendar_note_weekly_reviews_host_account_id_fkey" FOREIGN KEY (host_account_id) REFERENCES app.host_accounts(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION app.publish_weekly_note_checks()
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  environment text;
  this_week text;
  published integer;
BEGIN
  environment := CASE
    WHEN EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'worker_url' AND coalesce(decrypted_secret, '') <> ''
    ) THEN 'production'
    ELSE 'local'
  END;
  this_week := to_char(date_trunc('week', now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD');

  INSERT INTO app.jobs (kind, payload, dedupe_key, producer_environment)
  SELECT 'weekly_note_check',
         jsonb_build_object('hostAccountId', a.id, 'week', this_week),
         'weekly_note_check:' || a.id::text || ':' || this_week,
         environment
  FROM app.host_accounts a
  JOIN app.host_settings s ON s.host_account_id = a.id
  JOIN app.provider_grants g ON g.host_account_id = a.id
  WHERE a.status = 'active' AND g.refresh_token_ciphertext IS NOT NULL AND g.invalidated_at IS NULL
  ON CONFLICT (kind, dedupe_key) DO NOTHING;

  GET DIAGNOSTICS published = ROW_COUNT;
  RETURN published;
END;
$function$;

REVOKE ALL ON FUNCTION "app"."publish_weekly_note_checks"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."publish_weekly_note_checks"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."publish_weekly_note_checks"() TO "postgres";
