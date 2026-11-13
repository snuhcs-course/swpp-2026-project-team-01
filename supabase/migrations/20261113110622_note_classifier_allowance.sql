ALTER TABLE "app"."model_reservations"
  DROP CONSTRAINT "model_reservations_work_kind_check";

ALTER TABLE "app"."model_reservations"
  ADD CONSTRAINT "model_reservations_work_kind_check"
    CHECK ((work_kind = ANY (ARRAY['conversation_input'::text, 'ranking_check'::text, 'calendar_ocr'::text, 'note_classification'::text])));
