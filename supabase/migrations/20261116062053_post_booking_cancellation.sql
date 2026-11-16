ALTER TABLE "app"."bookings"
  DROP CONSTRAINT "bookings_confirmed";

ALTER TABLE "app"."email_deliveries"
  DROP CONSTRAINT "email_deliveries_kind_check";

ALTER TABLE "app"."requests"
  DROP CONSTRAINT "requests_closed";

ALTER TABLE "app"."requests"
  DROP CONSTRAINT "requests_state_check";

ALTER TABLE "app"."bookings"
  ADD CONSTRAINT "bookings_confirmed" CHECK ((((state <> 'confirmed'::text) OR (confirmed_at IS
    NOT NULL)) AND ((state = ANY (ARRAY['confirmed'::text, 'cancelled'::text])) OR (confirmed_at IS NULL))));

ALTER TABLE "app"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_kind_check"
    CHECK
    ((kind = ANY (ARRAY['request_creation'::text, 'link_resend'::text, 'booking_confirmation'::text, 'status_new_version'::text, 'status_declined'::text, 'status_expired'::text,
    'status_pending'::text, 'status_cancelled'::text, 'booking_cancelled'::text])));

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_closed" CHECK (((state = ANY (ARRAY['booked'::text, 'declined'::text, 'withdrawn'::text, 'expired'::text, 'cancelled'::text])) = (closed_at IS
    NOT NULL)));

ALTER TABLE "app"."requests"
  ADD CONSTRAINT "requests_state_check"
    CHECK
    ((state = ANY (ARRAY['draft'::text, 'gathering'::text, 'negotiating'::text, 'awaiting_host_approval'::text, 'booking'::text, 'booked'::text, 'declined'::text,
    'withdrawn'::text, 'expired'::text, 'cancelled'::text])));
