ALTER TABLE "app"."model_reservations"
  ALTER COLUMN "amount_usd" DROP DEFAULT;

ALTER TABLE "app"."model_reservations"
  ALTER COLUMN "amount_usd" TYPE numeric(12,6) USING "amount_usd"::numeric(12,6);
