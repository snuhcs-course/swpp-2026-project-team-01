-- Server-only recovery inspection and exact browser-intent reconciliation.
-- The public HTTP layer never accepts terminal evidence or runtime identities.
create or replace function fmat.conversation_recovery_read(p_grant_id uuid,p_conversation_id uuid,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare scope fmat.conversation_scopes; access jsonb; receipt fmat.conversation_recoveries;
 current_recovery uuid; expected numeric; retry uuid; retired_input numeric; retired_output numeric;
 live fmat.conversation_model_usage;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or (p_input-'expectedGeneration'-'idempotencyKey')<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 if p_input<>'{}'::jsonb then
  if jsonb_typeof(p_input->'expectedGeneration') is distinct from 'number'
   or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string'
   or (p_input->>'idempotencyKey') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'INVALID_INPUT';end if;
  expected:=(p_input->>'expectedGeneration')::numeric;
  if expected<0 or expected>9007199254740990 or trunc(expected)<>expected then raise exception 'INVALID_INPUT';end if;
  retry:=(p_input->>'idempotencyKey')::uuid;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 select * into strict scope from fmat.conversation_scopes where id=p_conversation_id for share;
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 -- Also validate that the scope pointer and complete generation ledger agree.
 perform fmat.conversation_history_timeline(scope);
 if retry is not null then
  select * into receipt from fmat.conversation_recoveries where conversation_id=scope.id and grant_id=p_grant_id and request_key=retry;
  if found then
   if receipt.source_generation<>expected then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  elsif scope.runtime_generation<>expected then raise exception 'STALE_REVISION';end if;
 end if;
 select id into current_recovery from fmat.conversation_recoveries where conversation_id=scope.id and target_generation=scope.runtime_generation;
 if scope.runtime_generation>0 and current_recovery is null then raise exception 'PROVIDER_UNAVAILABLE';end if;
 select coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0) into retired_input,retired_output
  from fmat.conversation_generations where conversation_id=scope.id and retired_at is not null;
 select * into live from fmat.conversation_model_usage where conversation_id=scope.id and generation=scope.runtime_generation;
 return jsonb_build_object('generation',scope.runtime_generation,'sessionId',scope.runtime_session_id,'recoveryId',current_recovery,
  'receipt',case when receipt.id is null then null else jsonb_build_object('recoveryId',receipt.id,'sourceGeneration',receipt.source_generation,'generation',receipt.target_generation) end,
  'retiredUsage',jsonb_build_object('inputTokens',least(retired_input,100000),'outputTokens',least(retired_output,8000)),
  'liveUsage',jsonb_build_object('inputTokens',least(coalesce(live.input_tokens,0),100000),'outputTokens',least(coalesce(live.output_tokens,0),8000)),
  'usagePending',exists(select 1 from fmat.conversation_model_receipts where conversation_id=scope.id and generation=scope.runtime_generation and usage is null));
end;
$$;
revoke all on function fmat.conversation_recovery_read(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.fmat_conversation_recovery(p_operation text,p_grant_id uuid,p_conversation_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_operation='read' then return fmat.conversation_recovery_read(p_grant_id,p_conversation_id,p_input);end if;
 if p_operation='begin' then return fmat.conversation_recovery_begin(p_grant_id,p_conversation_id,p_input);end if;
 raise exception 'NOT_FOUND';
end;
$$;
revoke all on function public.fmat_conversation_recovery(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_conversation_recovery(text,uuid,uuid,jsonb) to service_role;
