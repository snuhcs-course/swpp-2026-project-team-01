alter table fmat.requests add column availability_mode text not null default 'manual' check(availability_mode in ('manual','calendar'));
alter table fmat.requests add column availability_failed boolean not null default false;
alter table fmat.calendar_connections add column selected_calendar_ids text[] not null default '{}';
-- Existing connected requests are backfilled in a separate versioned data migration.

create or replace function fmat.close_requester_calendar()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status in ('booked','declined','withdrawn','expired') or new.token_revoked_at is not null or new.token_hash is distinct from old.token_hash then
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=clock_timestamp(),selected_calendar_ids='{}',updated_at=clock_timestamp() where principal_kind='guest' and principal_id=new.id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,clock_timestamp()),encrypted_verifier=null where actor->>'kind'='guest' and actor->>'requestId'=new.id::text and saved_at is null;
  end if;
  return new;
end;
$$;
create trigger close_requester_calendar after update of status,token_hash,token_revoked_at on fmat.requests for each row execute function fmat.close_requester_calendar();
revoke all on function fmat.close_requester_calendar() from public,anon,authenticated,service_role;

create or replace function public.fmat_requester_availability(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor jsonb; v_request fmat.requests; v_connection fmat.calendar_connections; v_ids text[]; v_id text; v_details jsonb;
begin
  if p_credential->>'kind' is distinct from 'guest' or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'FORBIDDEN'; end if;
  v_actor:=fmat.calendar_actor(p_credential);
  select * into strict v_request from fmat.requests where id=(v_actor->>'requestId')::uuid;
  select * into v_connection from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null and guest_authority_key=p_credential->>'tokenHash' for update;
  if p_operation='status' then
    return jsonb_build_object('revision',v_request.revision,'mode',v_request.availability_mode,'failed',v_request.availability_failed,'connected',v_connection.id is not null,'selectedCalendarIds',to_jsonb(coalesce(v_connection.selected_calendar_ids,'{}')),'timezone',coalesce(v_request.details->>'timezone',''),'windows',coalesce(v_request.details->'windows','[]'));
  end if;
  if p_operation='manual' then
    if (p_input->>'revision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
    if p_input->>'confirmed' is distinct from 'true' or jsonb_typeof(p_input->'windows') is distinct from 'array' or jsonb_array_length(p_input->'windows') not between 1 and 30 or coalesce(p_input->>'timezone','')='' then raise exception 'INVALID_INPUT'; end if;
    v_details:=fmat.normalize_details(v_request.details||jsonb_build_object('windows',p_input->'windows','timezone',p_input->>'timezone'));
    perform fmat.request_command('request_calendar_disconnect',v_actor,jsonb_build_object('requestId',v_request.id,'expectedRevision',v_request.revision));
    update fmat.requests set details=v_details,availability_mode='manual',availability_failed=false,expires_at=fmat.request_expiry(v_details,created_at),status=case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end where id=v_request.id returning * into v_request;
    perform fmat.audit('manual_availability',v_actor,v_request.id::text);
    return jsonb_build_object('saved',true,'revision',v_request.revision);
  end if;
  if v_connection.id is null or v_request.availability_mode<>'calendar' then raise exception 'RECONNECT_REQUIRED'; end if;
  if p_operation='read' then
    return jsonb_build_object('connectionId',v_connection.id,'generation',v_connection.generation,'principalId',v_request.id,'encryptedCredential',v_connection.encrypted_credential,'revision',v_request.revision,'selectedCalendarIds',to_jsonb(v_connection.selected_calendar_ids),'windows',coalesce(v_request.details->'windows','[]'));
  end if;
  if (p_input->>'connectionId')::uuid is distinct from v_connection.id or (p_input->>'generation')::uuid is distinct from v_connection.generation or (p_input->>'revision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
  if p_operation='check' then return jsonb_build_object('current',true);
  elsif p_operation='read_success' then
    update fmat.requests set availability_failed=false where id=v_request.id;
    return jsonb_build_object('current',true);
  elsif p_operation='read_failure' then
    update fmat.requests set availability_failed=true,revision=revision+1,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,updated_at=clock_timestamp() where id=v_request.id returning * into v_request;
    insert into fmat.request_history(request_id,revision,operation,actor) values(v_request.id,v_request.revision,'requester_calendar_failed',v_actor-'tokenHash');
    perform fmat.audit('requester_calendar_failed',v_actor,v_request.id::text);
    return jsonb_build_object('paused',true);
  elsif p_operation='refresh' then
    if p_input->>'previousCredential' is distinct from v_connection.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
    if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=v_connection.id;
    return jsonb_build_object('refreshed',true);
  elsif p_operation='select' then
    if jsonb_typeof(p_input->'calendarIds') is distinct from 'array' or jsonb_typeof(p_input->'verifiedCalendarIds') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    select array_agg(distinct value) into v_ids from jsonb_array_elements_text(p_input->'calendarIds');
    if coalesce(cardinality(v_ids),0) not between 1 and 50 then raise exception 'INVALID_INPUT'; end if;
    foreach v_id in array v_ids loop
      if not exists(select 1 from jsonb_array_elements_text(p_input->'verifiedCalendarIds') c where c.value=v_id) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    end loop;
    update fmat.calendar_connections set selected_calendar_ids=v_ids,updated_at=clock_timestamp() where id=v_connection.id;
    -- Reuse the request revision/history boundary to invalidate prior decisions.
    perform fmat.request_command('details_update',v_actor,jsonb_build_object('requestId',v_request.id,'expectedRevision',v_request.revision,'details',v_request.details));
    update fmat.requests set availability_failed=false where id=v_request.id;
    perform fmat.audit('requester_calendar_select',v_actor,v_request.id::text);
    return jsonb_build_object('saved',true,'revision',v_request.revision+1);
  end if;
  raise exception 'FORBIDDEN';
end;
$$;
revoke all on function public.fmat_requester_availability(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_requester_availability(text,jsonb,jsonb) to service_role;
