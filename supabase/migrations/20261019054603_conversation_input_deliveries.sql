ALTER TABLE "app"."conversation_inputs"
  ADD COLUMN "delivery_ids" text[] NOT NULL DEFAULT '{}'::text[];
