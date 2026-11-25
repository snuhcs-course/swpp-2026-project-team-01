-- Add the guest's agreement receipt to the existing email outbox kinds.
-- Hand-authored because pg-delta could not run without Docker in this workspace.
ALTER TABLE "app"."email_deliveries" DROP CONSTRAINT "email_deliveries_kind_check";

ALTER TABLE "app"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_kind_check"
    CHECK ((kind = ANY (ARRAY[
      'request_creation'::text, 'link_resend'::text, 'agreement_receipt'::text,
      'booking_confirmation'::text, 'status_new_version'::text, 'status_declined'::text,
      'status_expired'::text, 'status_pending'::text, 'status_cancelled'::text,
      'booking_cancelled'::text, 'status_change_dropped'::text,
      'account_deletion_scheduled'::text, 'account_deletion_cancelled'::text,
      'account_deletion_completed'::text, 'host_account_closed'::text
    ])));
