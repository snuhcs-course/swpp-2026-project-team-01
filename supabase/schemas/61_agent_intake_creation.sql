-- Service-only initial intake adapter. All identifiers/claims originate in the
-- verified OAuth adapter, never in client tool input. No proof is returned.
create or replace function public.fmat_agent_intake(
 p_grant_id uuid,p_client_id uuid,p_resource text,p_intake_id uuid,
 p_scope text,p_token_expires_at bigint,p_operation text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i fmat.oauth_intakes; a fmat.oauth_grants; h fmat.hosts; g fmat.calendar_connections;
 r fmat.requests; receipt fmat.idempotency; result jsonb; actor jsonb; input_key uuid;
begin
 if p_operation is null or p_operation not in ('context','refresh','check','replay','create')
  or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if not fmat.oauth_scope_valid(p_scope) or not ('request:intake'=any(string_to_array(p_scope,' '))) then return '{"error":"invalid_scope"}';end if;
 if p_token_expires_at is null or p_token_expires_at<=extract(epoch from clock_timestamp()) then return '{"error":"invalid_token"}';end if;
 select * into i from fmat.oauth_intakes where id=p_intake_id for update;
 if not found or i.grant_id is distinct from p_grant_id then return '{"error":"invalid_grant"}';end if;
 select * into a from fmat.oauth_grants where id=p_grant_id;
 if not found or a.actor_kind<>'intake' or a.actor_id<>i.id or a.host_id<>i.host_id
  or a.client_id is distinct from p_client_id or a.resource is distinct from p_resource then return '{"error":"invalid_grant"}';end if;
 -- Acquire UPDATE initially: different intakes must not both hold SHARE and
 -- deadlock upgrading the Calendar connection while persisting a refresh.
 if i.request_id is null then
  perform 1 from auth.users where id=i.host_id for share;
  select * into h from fmat.hosts where id=i.host_id for share;
  select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=i.host_id and revoked_at is null for update;
 end if;
 a:=fmat.oauth_lock_grant(p_grant_id);
 if a.id is null or not(string_to_array(p_scope,' ') <@ string_to_array(a.scope,' ')) then return '{"error":"invalid_grant"}';end if;
 if p_token_expires_at<=extract(epoch from clock_timestamp()) or p_token_expires_at>floor(extract(epoch from a.expires_at)) then return '{"error":"invalid_token"}';end if;
 if p_operation in ('create','replay') then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('details','idempotencyKey','tokenHash','connectionId','generation','rulesVersion'))
   or (p_operation='replay' and exists(select 1 from jsonb_object_keys(p_input) k where k not in ('details','idempotencyKey')))
   or jsonb_typeof(p_input->'details') is distinct from 'object' or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string' then raise exception 'INVALID_INPUT';end if;
  input_key:=(p_input->>'idempotencyKey')::uuid;
  if i.request_id is not null then
   select * into receipt from fmat.idempotency where actor_scope='intake:'||i.id and operation='request_create' and key=input_key::text;
   if not found or receipt.input is distinct from jsonb_build_object('details',p_input->'details') or receipt.result is null then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return receipt.result;
  end if;
  if p_operation='replay' then return null;end if;
 else
  if i.request_id is not null then raise exception 'REVISION_CONFLICT';end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('connectionId','generation','rulesVersion','previousCredential','encryptedCredential'))
   or (p_operation='context' and p_input<>'{}'::jsonb)
   or (p_operation='check' and (p_input ? 'previousCredential' or p_input ? 'encryptedCredential')) then raise exception 'INVALID_INPUT';end if;
 end if;
 if p_operation='context' then
  return jsonb_build_object('reservedRequestId',i.reserved_request_id,
   'profile',jsonb_build_object('handle',h.handle,'displayName',h.display_name,'timezone',h.rules->>'timezone','durationMinutes',h.rules->'durationMinutes'),
   'grant',jsonb_build_object('principalId',h.id,'connectionId',g.id,'generation',g.generation,'encryptedCredential',g.encrypted_credential,
    'rulesVersion',h.rules_version,'conflictCalendarIds',to_jsonb(h.conflict_calendar_ids),'bookingCalendarId',h.booking_calendar_id));
 end if;
 if (p_input->>'connectionId')::uuid is distinct from g.id or (p_input->>'generation')::uuid is distinct from g.generation
  or (p_input->>'rulesVersion')::integer is distinct from h.rules_version then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='check' then return '{"current":true}';end if;
 -- Roll back every write if authority expires while a downstream trigger or
 -- constraint waits. Keep permanent grant revocation outside that rollback.
 begin
  if p_operation='refresh' then
   if p_input->>'previousCredential' is distinct from g.encrypted_credential then raise exception 'REVISION_CONFLICT';end if;
   if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT';end if;
   update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=g.id;
   result:='{"refreshed":true}';
  else
   if exists(select 1 from jsonb_object_keys(p_input->'details') k where k not in ('requesterName','requesterEmail','purpose','timezone','durationMinutes','mode','location','windows'))
    or length(trim(coalesce(p_input->'details'->>'requesterName','')))=0
    or length(trim(coalesce(p_input->'details'->>'requesterEmail','')))=0
    or length(trim(coalesce(p_input->'details'->>'purpose','')))=0
    or length(coalesce(p_input->'details'->>'timezone',''))=0
    or jsonb_typeof(p_input->'details'->'durationMinutes') is distinct from 'number' then raise exception 'INVALID_INPUT';end if;
   actor:=jsonb_build_object('kind','public','tokenHash',p_input->>'tokenHash','agentClientId',a.client_id,'agentGrantId',a.id);
   r:=fmat.insert_request(i.host_id,p_input->'details',p_input->>'tokenHash',actor,i.reserved_request_id);
   -- Enforce the pending deadline before the immutable binding constraint too.
   if i.create_expires_at<=clock_timestamp() then raise exception using errcode='PT401',message='INTAKE_EXPIRED';end if;
   update fmat.oauth_intakes set request_id=r.id,token_hash=r.token_hash,bound_at=clock_timestamp() where id=i.id;
   result:=jsonb_build_object('status','created','requestId',r.id);
   insert into fmat.idempotency(actor_scope,operation,key,input,result)
    values('intake:'||i.id,'request_create',input_key::text,jsonb_build_object('details',p_input->'details'),result);
  end if;
  if p_token_expires_at<=extract(epoch from clock_timestamp()) or a.expires_at<=clock_timestamp()
   or (p_operation='create' and i.create_expires_at<=clock_timestamp()) or not fmat.oauth_authority_current(a)
   then raise exception using errcode='PT401',message='INTAKE_EXPIRED';end if;
 exception when sqlstate 'PT401' then
  perform fmat.oauth_lock_grant(p_grant_id);
  return '{"error":"invalid_token"}';
 end;
 return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'INVALID_INPUT';
end$$;
revoke all on function public.fmat_agent_intake(uuid,uuid,text,uuid,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_agent_intake(uuid,uuid,text,uuid,text,bigint,text,jsonb) to service_role;
