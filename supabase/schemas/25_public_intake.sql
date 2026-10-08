-- Only trusted adapters can obtain provider context or start an account-free
-- request. The browser supplies neither an actor nor a provider result.
create or replace function public.fmat_public_intake(p_operation text,p_token_hash text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h fmat.hosts; g fmat.calendar_connections; u auth.users; r fmat.requests;
 v_result jsonb; v_details jsonb; v_record fmat.idempotency; v_host uuid; v_state jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or not fmat.valid_public_handle(p_input->>'handle')
  or p_operation is null or p_operation not in ('context','check','refresh','create','replay','resume') then raise exception 'INVALID_INPUT'; end if;
 if p_operation in ('create','replay','resume') then
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'UNAUTHORIZED'; end if;
  -- Serialize recovery and submission even before a request row exists.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-intake:'||p_token_hash,0));
  select q.* into r from fmat.requests q join fmat.hosts host on host.id=q.host_id
   where q.token_hash=p_token_hash and host.handle=p_input->>'handle' for update of q;
  if found then
   if r.token_expires_at<=clock_timestamp() then raise exception 'NOT_FOUND'; end if;
   if p_operation in ('create','replay') then
    select * into v_record from fmat.idempotency where actor_scope='public:'||p_token_hash and operation='request_create' and key='browser-intake';
    if not found or v_record.input->'details' is distinct from p_input->'details' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   end if;
   v_state:=public.fmat_browser_command('guest_state',jsonb_build_object('kind','guest','requestId',r.id,'tokenHash',p_token_hash),'{}');
   return jsonb_build_object('requestId',r.id,'tokenExpiresAt',r.token_expires_at,'closed',v_state->'closed');
  end if;
  if exists(select 1 from fmat.requests where token_hash=p_token_hash) then raise exception 'NOT_FOUND'; end if;
  -- A rotated token is no longer on its request row. Its creation receipt must
  -- not be mistaken for an unused proof and offered a second creation attempt.
  if exists(select 1 from fmat.idempotency where actor_scope='public:'||p_token_hash and operation='request_create' and key='browser-intake' and result is not null) then raise exception 'NOT_FOUND'; end if;
  if p_operation in ('resume','replay') then return null; end if;
 end if;
 -- Match Auth -> host -> connection ordering used by authenticated setup.
 -- Session logout is irrelevant to a published profile, account revocation is not.
 select id into v_host from fmat.hosts where handle=p_input->>'handle';
 select * into u from auth.users where id=v_host for share;
 if not found or u.deleted_at is not null or u.banned_until>clock_timestamp() or u.email_confirmed_at is null then raise exception 'NOT_FOUND'; end if;
 select * into h from fmat.hosts where id=v_host and handle=p_input->>'handle' for share;
 if not found or not fmat.host_ready(h) then raise exception 'NOT_FOUND'; end if;
 select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=h.id and revoked_at is null for update;
 if not found or not fmat.host_ready(h) then raise exception 'NOT_FOUND'; end if;
 if p_operation='context' then
  return jsonb_build_object('profile',jsonb_build_object('handle',h.handle,'displayName',h.display_name,'timezone',h.rules->>'timezone','durationMinutes',h.rules->'durationMinutes'),
   'grant',jsonb_build_object('principalId',h.id,'connectionId',g.id,'generation',g.generation,'encryptedCredential',g.encrypted_credential,
    'rulesVersion',h.rules_version,'conflictCalendarIds',to_jsonb(h.conflict_calendar_ids),'bookingCalendarId',h.booking_calendar_id));
 end if;
 if (p_input->>'connectionId')::uuid is distinct from g.id or (p_input->>'generation')::uuid is distinct from g.generation
  or (p_input->>'rulesVersion')::integer is distinct from h.rules_version then raise exception 'REVISION_CONFLICT'; end if;
 if p_operation='check' then return jsonb_build_object('current',true); end if;
 if p_operation='refresh' then
  if p_input->>'previousCredential' is distinct from g.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
  if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
  update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=g.id;
  return jsonb_build_object('refreshed',true);
 end if;
 if p_operation='create' then
  if jsonb_typeof(p_input->'details') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input->'details') k
   where k not in ('requesterName','requesterEmail','purpose','timezone','durationMinutes','mode','location','windows')) then raise exception 'INVALID_INPUT'; end if;
  v_details:=fmat.normalize_details(p_input->'details');
  v_result:=public.fmat_command('request_create',jsonb_build_object('kind','public','tokenHash',p_token_hash),
   jsonb_build_object('handle',h.handle,'details',p_input->'details','tokenHash',p_token_hash,'idempotencyKey','browser-intake'));
  select * into strict r from fmat.requests where id=(v_result->>'id')::uuid;
  perform fmat.apply_intake_identity(r.id,h.handle,p_token_hash);
  return jsonb_build_object('requestId',r.id,'tokenExpiresAt',r.token_expires_at,'closed',false);
 end if;
 raise exception 'FORBIDDEN';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_INPUT';
end;
$$;
revoke all on function public.fmat_public_intake(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_public_intake(text,text,jsonb) to service_role;
