ALTER TABLE "app"."imessage_links"
  ADD COLUMN "line_number" text;

ALTER TABLE "app"."imessage_links"
  ADD CONSTRAINT "imessage_links_line_number_check" CHECK ((line_number ~ '^\+[1-9][0-9]{6,14}$'::text));
