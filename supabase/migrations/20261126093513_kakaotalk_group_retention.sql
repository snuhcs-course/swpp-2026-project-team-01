SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION app.sweep_kakaotalk_group_messages()
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  DELETE FROM app.kakaotalk_group_messages WHERE created_at < now() - interval '24 hours';

  PERFORM app.delete_discussion_records(array(
    SELECT d.id FROM app.discussions d
    WHERE d.principal_type = 'kakaotalk_group' AND d.audience = 'group_chat'
      AND d.created_at < now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM app.conversation_inputs i
        WHERE i.discussion_id = d.id AND i.accepted_at >= now() - interval '30 days'
      )
  ));
END;
$function$;

REVOKE ALL ON FUNCTION "app"."sweep_kakaotalk_group_messages"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "app"."sweep_kakaotalk_group_messages"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "app"."sweep_kakaotalk_group_messages"() TO "postgres";

SELECT cron.schedule_in_database('app-kakaotalk-group-messages', '17 * * * *', 'select app.sweep_kakaotalk_group_messages()', 'postgres', NULL, true);
