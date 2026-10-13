-- Runtime-only wrapper. Callers use server-captured input/runtime identity; no
-- browser or model operation can supply creation permissions or terminal claims.
create or replace function public.fmat_runtime_successor(p_operation text,p_grant_id uuid,p_conversation_id uuid,p_input jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select fmat.conversation_successor(p_operation,p_grant_id,p_conversation_id,p_input);
$$;
revoke all on function public.fmat_runtime_successor(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_runtime_successor(text,uuid,uuid,jsonb) to service_role;
