SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE OR REPLACE FUNCTION fmat.normalize_details (
  p_details jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_window jsonb; v_windows jsonb:=coalesce(p_details->'windows','[]'::jsonb); v_email text:=lower(trim(coalesce(p_details->>'requesterEmail','')));
begin
  if jsonb_typeof(p_details) is distinct from 'object' or jsonb_typeof(v_windows) is distinct from 'array' or jsonb_array_length(v_windows)>30
    or length(coalesce(p_details->>'requesterName',''))>200 or length(coalesce(p_details->>'purpose',''))>5000 or length(coalesce(p_details->>'location',''))>2000
    or length(v_email)>254 or (v_email<>'' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (coalesce(p_details->>'timezone','')<>'' and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_details->>'timezone'))
    or (p_details ? 'durationMinutes' and p_details->'durationMinutes'<>'null'::jsonb and coalesce((p_details->>'durationMinutes')::integer,0) not between 5 and 240)
    or coalesce(p_details->>'mode','') not in ('','online','in_person') then raise exception 'INVALID_INPUT'; end if;
  for v_window in select value from jsonb_array_elements(v_windows) loop
    if coalesce(v_window->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(v_window->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (v_window->>'start')::timestamptz>=(v_window->>'end')::timestamptz or (v_window->>'end')::timestamptz<=now()
      or (v_window->>'end')::timestamptz>(v_window->>'start')::timestamptz+interval '31 days' then raise exception 'INVALID_INPUT'; end if;
  end loop;
  if p_details->>'mode'='online' and coalesce(p_details->>'location','')<>'' and p_details->>'location' !~ '^https://[^[:space:]]+$' then raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('requesterName',trim(coalesce(p_details->>'requesterName','')),'requesterEmail',v_email,'purpose',trim(coalesce(p_details->>'purpose','')),
    'durationMinutes',p_details->'durationMinutes','timezone',coalesce(p_details->>'timezone',''),'windows',v_windows,'mode',coalesce(p_details->>'mode',''),'location',trim(coalesce(p_details->>'location','')));
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_INPUT';
end;
$function$;

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));
