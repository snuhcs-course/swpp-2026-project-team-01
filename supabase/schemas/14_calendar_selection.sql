alter table fmat.calendar_connections add column generation uuid not null default gen_random_uuid();

-- Server-only bridge for current host Calendar metadata and explicit choices.
-- Provider calls occur outside transactions; generation and rules revision fence
-- their results against reconnection, disconnection, logout and concurrent edits.
create or replace function public.fmat_calendar_access(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor jsonb; v_host fmat.hosts; v_connection fmat.calendar_connections; v_conflicts text[]; v_requested text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN'; end if;
  v_actor:=fmat.calendar_actor(p_credential);
  select * into strict v_host from fmat.hosts where id=(v_actor->>'id')::uuid;
  select * into v_connection from fmat.calendar_connections where principal_kind='host' and principal_id=v_host.id and revoked_at is null for update;
  if not found then raise exception 'RECONNECT_REQUIRED'; end if;
  if p_operation='read' then
    return jsonb_build_object('connectionId',v_connection.id,'generation',v_connection.generation,'principalId',v_host.id,'encryptedCredential',v_connection.encrypted_credential,
      'rulesVersion',v_host.rules_version,'conflictCalendarIds',to_jsonb(v_host.conflict_calendar_ids),'bookingCalendarId',v_host.booking_calendar_id);
  end if;
  if (p_input->>'connectionId')::uuid is distinct from v_connection.id or (p_input->>'generation')::uuid is distinct from v_connection.generation then raise exception 'REVISION_CONFLICT'; end if;
  if p_operation='check' then return jsonb_build_object('current',true);
  elsif p_operation='refresh' then
    if p_input->>'previousCredential' is distinct from v_connection.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
    if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=v_connection.id;
    return jsonb_build_object('refreshed',true);
  elsif p_operation='select' then
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'REVISION_CONFLICT'; end if;
    if jsonb_typeof(p_input->'conflictCalendarIds') is distinct from 'array' or jsonb_typeof(p_input->'verifiedCalendars') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    select array_agg(distinct value) into v_conflicts from jsonb_array_elements_text(p_input->'conflictCalendarIds');
    if coalesce(cardinality(v_conflicts),0) not between 1 and 50 then raise exception 'INVALID_INPUT'; end if;
    foreach v_requested in array v_conflicts loop
      if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=v_requested and c->>'accessRole' in ('freeBusyReader','reader','writer','writerWithoutPrivateAccess','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    end loop;
    if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=p_input->>'bookingCalendarId' and c->>'accessRole' in ('writer','writerWithoutPrivateAccess','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    update fmat.hosts set conflict_calendar_ids=v_conflicts,booking_calendar_id=p_input->>'bookingCalendarId',rules_version=rules_version+1,updated_at=clock_timestamp() where id=v_host.id returning * into v_host;
    perform fmat.audit('calendar_save',v_actor,v_host.id::text);
    return jsonb_build_object('saved',true,'rulesVersion',v_host.rules_version);
  end if;
  raise exception 'FORBIDDEN';
end;
$$;
revoke all on function public.fmat_calendar_access(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_calendar_access(text,jsonb,jsonb) to service_role;
