ALTER TABLE "public"."meeting_requests"
  DROP CONSTRAINT "meeting_requests_status_check";

ALTER TABLE "public"."meeting_requests"
  ADD CONSTRAINT "meeting_requests_status_check"
    CHECK ((status = ANY (ARRAY['needs_owner_review'::text, 'confirming'::text, 'approved'::text, 'declined'::text, 'calendar_conflict'::text])));
