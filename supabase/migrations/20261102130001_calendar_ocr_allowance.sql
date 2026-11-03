-- Allow request-scoped OCR attempts to reserve the same model spending budget
-- used by conversation and ranking calls. This migration was reviewed by hand
-- because the local pg-delta generator requires Docker.
ALTER TABLE "app"."model_reservations"
  DROP CONSTRAINT "model_reservations_work_kind_check";

ALTER TABLE "app"."model_reservations"
  ADD CONSTRAINT "model_reservations_work_kind_check"
  CHECK ((work_kind = ANY (ARRAY['conversation_input'::text, 'ranking_check'::text, 'calendar_ocr'::text])));
