SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE OR REPLACE FUNCTION fmat.calendar_scan_model_view (
  p_host uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare result jsonb:=fmat.calendar_scan_view(p_host);
begin
 if result->'scan'='null'::jsonb then return result;end if;
 result:=jsonb_set(result,'{scan,scope}',((result->'scan'->'scope')-'calendarIds')||jsonb_build_object('calendarCount',jsonb_array_length(result->'scan'->'scope'->'calendarIds')));
 if result->'scan'->'summary'<>'null'::jsonb then result:=jsonb_set(result,'{scan,summary}',(result->'scan'->'summary')-'locations');end if;
 return result;
end;
$function$;

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));
