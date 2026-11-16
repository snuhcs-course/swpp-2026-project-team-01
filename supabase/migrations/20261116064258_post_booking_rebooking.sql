DROP INDEX "app"."bookings_one_live_idx";

ALTER TABLE "app"."bookings"
  DROP CONSTRAINT "bookings_event_id_key";

ALTER TABLE "app"."email_deliveries"
  DROP CONSTRAINT "email_deliveries_kind_check";

ALTER TABLE "app"."bookings"
  ADD COLUMN "replaces_booking_id" uuid;

ALTER TABLE "app"."bookings"
  ADD CONSTRAINT "bookings_replaces_booking_id_fkey" FOREIGN KEY (replaces_booking_id) REFERENCES app.bookings(id) ON DELETE SET NULL;

ALTER TABLE "app"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_kind_check"
    CHECK
    ((kind = ANY (ARRAY['request_creation'::text, 'link_resend'::text, 'booking_confirmation'::text, 'status_new_version'::text, 'status_declined'::text, 'status_expired'::text,
    'status_pending'::text, 'status_cancelled'::text, 'booking_cancelled'::text, 'status_change_dropped'::text])));

CREATE UNIQUE INDEX bookings_event_idx ON app.bookings USING btree (event_id)
  WHERE (replaces_booking_id IS NULL);

CREATE UNIQUE INDEX bookings_one_confirmed_idx ON app.bookings USING btree (request_id)
  WHERE (state = 'confirmed'::text);

CREATE UNIQUE INDEX bookings_one_pending_idx ON app.bookings USING btree (request_id)
  WHERE (state = ANY (ARRAY['reserved'::text, 'dispatching'::text]));
