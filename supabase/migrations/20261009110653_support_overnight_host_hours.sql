SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.validate_setup_patch (
  p_patch jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r jsonb; item jsonb; k text;
begin
 if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}' or exists(select 1 from jsonb_object_keys(p_patch) x where x not in ('handle','displayName','rules')) then raise exception 'INVALID_INPUT'; end if;
 if p_patch ? 'handle' and (jsonb_typeof(p_patch->'handle') is distinct from 'string' or not fmat.valid_public_handle(p_patch->>'handle')) then raise exception 'INVALID_INPUT'; end if;
 if p_patch ? 'displayName' and (jsonb_typeof(p_patch->'displayName') is distinct from 'string' or length(trim(p_patch->>'displayName')) not between 1 and 120) then raise exception 'INVALID_INPUT'; end if;
 if not p_patch ? 'rules' then return; end if;
 r:=p_patch->'rules';
 if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) x where x not in ('timezone','durationMinutes','availability','focusBlocks','bufferMinutes','travelMode','homeLocation','preferences','meetingMode','locationPolicy','locations','travelBufferMinutes')) then raise exception 'INVALID_INPUT'; end if;
 if r ? 'timezone' and (jsonb_typeof(r->'timezone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=r->>'timezone')) then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['durationMinutes','bufferMinutes','travelBufferMinutes'] loop
  if r ? k and (jsonb_typeof(r->k) is distinct from 'number' or r->>k !~ '^[0-9]+$' or (r->>k)::numeric not between case when k='durationMinutes' then 5 else 0 end and 240) then raise exception 'INVALID_INPUT'; end if;
 end loop;
 if r ? 'meetingMode' and coalesce(r->>'meetingMode','') not in ('online','in_person','either') then raise exception 'INVALID_INPUT'; end if;
 if r ? 'locationPolicy' and coalesce(r->>'locationPolicy','') not in ('per_meeting','preferred') then raise exception 'INVALID_INPUT'; end if;
 if r ? 'travelMode' and coalesce(r->>'travelMode','') not in ('DRIVE','TRANSIT','WALK','BICYCLE','PER_TRIP','NONE') then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['homeLocation','preferences'] loop
  if r ? k and (jsonb_typeof(r->k) is distinct from 'string' or length(r->>k)>case when k='homeLocation' then 2000 else 5000 end) then raise exception 'INVALID_INPUT'; end if;
 end loop;
 if r ? 'locations' then
  if jsonb_typeof(r->'locations') is distinct from 'array' or jsonb_array_length(r->'locations')>10 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'locations') loop
   if jsonb_typeof(item) is distinct from 'string' or length(trim(item#>>'{}')) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
 if r ? 'availability' then
  if jsonb_typeof(r->'availability') is distinct from 'array' or jsonb_array_length(r->'availability') not between 1 and 21 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'availability') loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) x where x not in ('days','start','end')) or jsonb_typeof(item->'days') is distinct from 'array' or jsonb_array_length(item->'days') not between 1 and 7
    or coalesce(item->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(item->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'start'=item->>'end' then raise exception 'INVALID_INPUT'; end if;
   if exists(select 1 from jsonb_array_elements(item->'days') d where jsonb_typeof(d) is distinct from 'number' or d::text !~ '^[0-6]$') then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
 if r ? 'focusBlocks' then
  if jsonb_typeof(r->'focusBlocks') is distinct from 'array' or jsonb_array_length(r->'focusBlocks')>100 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'focusBlocks') loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) x where x not in ('start','end')) or coalesce(item->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(item->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or (item->>'start')::timestamptz>=(item->>'end')::timestamptz then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;
$function$;
