-- guest-flow-completion U15: a requester status notice goes from the product
-- inbox, starting a thread bound to the request when it has none (origin
-- notified, no binding receipt; a reply with no message to reply to).
ALTER TABLE "app"."email_threads" DROP CONSTRAINT "email_threads_origin_check";
ALTER TABLE "app"."email_threads" ADD CONSTRAINT "email_threads_origin_check" CHECK ("origin" IN ('started', 'linked', 'notified'));
ALTER TABLE "app"."email_threads" ALTER COLUMN "bound_by_receipt_id" DROP NOT NULL;
ALTER TABLE "app"."email_threads" ADD CONSTRAINT "email_threads_receipt" CHECK ("origin" = 'notified' OR "bound_by_receipt_id" IS NOT NULL);
ALTER TABLE "app"."email_replies" ALTER COLUMN "reply_to_message_id" DROP NOT NULL;
