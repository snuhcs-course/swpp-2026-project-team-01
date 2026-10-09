SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.validate_rules (
  p_rules jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_item jsonb;
begin
  if jsonb_typeof(p_rules) is distinct from 'object' or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_rules->>'timezone')
    or coalesce((p_rules->>'durationMinutes')::integer,0) not between 5 and 240
    or coalesce((p_rules->>'bufferMinutes')::integer,-1) not between 0 and 240
    or coalesce(p_rules->>'travelMode','') not in ('DRIVE','TRANSIT','WALK','BICYCLE','PER_TRIP','NONE')
    or jsonb_typeof(p_rules->'availability') is distinct from 'array' or jsonb_array_length(p_rules->'availability')=0
    or jsonb_typeof(p_rules->'focusBlocks') is distinct from 'array'
    or jsonb_typeof(p_rules->'preferences') is distinct from 'string' or length(p_rules->>'preferences')>5000 then raise exception 'INVALID_INPUT'; end if;
  for v_item in select value from jsonb_array_elements(p_rules->'availability') loop
    if jsonb_typeof(v_item->'days') is distinct from 'array' or jsonb_array_length(v_item->'days')=0
      or coalesce(v_item->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(v_item->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v_item->>'start') = (v_item->>'end') then raise exception 'INVALID_INPUT'; end if;
    if exists(select 1 from jsonb_array_elements_text(v_item->'days') d where d::integer not between 0 and 6) then raise exception 'INVALID_INPUT'; end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_rules->'focusBlocks') loop
    if (v_item->>'start')::timestamptz is null or (v_item->>'end')::timestamptz is null or (v_item->>'start')::timestamptz >= (v_item->>'end')::timestamptz then raise exception 'INVALID_INPUT'; end if;
  end loop;
end;
$function$;
