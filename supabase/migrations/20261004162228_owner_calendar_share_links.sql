SET local check_function_bodies = off;

ALTER TABLE "public"."share_links"
  ADD COLUMN "name" text NOT NULL DEFAULT '미팅 요청'::text;

ALTER TABLE "public"."share_links"
  ADD COLUMN "encrypted_code" text;

ALTER TABLE "public"."share_links"
  ADD COLUMN "availability_start" timestamp WITH time zone;

ALTER TABLE "public"."share_links"
  ADD COLUMN "availability_end" timestamp WITH time zone;

ALTER TABLE "public"."share_links"
  ADD COLUMN "availability_windows" jsonb;

ALTER TABLE "public"."share_links"
  ADD COLUMN "deleted_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION public.require_open_share_link()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  perform id from public.share_links
    where id = new.share_link_id and active and deleted_at is null
      and (availability_end is null or availability_end > now())
    for share;
  if not found then
    raise exception 'share_link_unavailable' using errcode = '23514';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."require_open_share_link"() FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."share_links"
  ADD CONSTRAINT "share_links_availability_check"
    CHECK ((((availability_start IS NULL) AND (availability_end IS NULL) AND (availability_windows IS NULL)) OR ((availability_start IS NOT NULL) AND (availability_end IS
    NOT NULL) AND (availability_windows IS NOT NULL) AND (availability_end > availability_start) AND (jsonb_typeof(availability_windows) = 'array'::text))));

ALTER TABLE "public"."share_links"
  ADD CONSTRAINT "share_links_name_check" CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 80)));

CREATE TRIGGER meeting_requests_require_open_link
  BEFORE INSERT ON public.meeting_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.require_open_share_link();

GRANT EXECUTE ON FUNCTION "public"."require_open_share_link"() TO "postgres", "service_role";
