-- The KakaoTalk group retention sweep (kakaotalk-group-conversations design 3
-- and 7), run hourly by pg_cron: every group's context lines past 24 hours, and
-- each group's conversation with the assistant (its calls, the context sent with
-- them, sessions and recorded events) 30 days after its last call, so a group
-- that went quiet keeps nothing longer than the privacy policy says.
CREATE FUNCTION "app"."sweep_kakaotalk_group_messages"()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
$$;
