-- Internal projection only. Callers must hold the authorized scope row lock and
-- recheck participant authority after any lock wait. No raw events or usage.
create or replace function fmat.conversation_history_timeline(p_scope fmat.conversation_scopes)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_rows jsonb; v_count bigint; v_min bigint; v_max bigint;
begin
 if p_scope.id is null then return null;end if;
 if p_scope.revoked_at is not null then raise exception 'NOT_FOUND';end if;
 if p_scope.runtime_generation=0 then
  -- Existing generation-zero runtimes can precede ledger enrollment.
  if exists(select 1 from fmat.conversation_generations where conversation_id=p_scope.id
    and (generation<>0 or retired_at is not null or (runtime_session_id is not null
      and runtime_session_id is distinct from p_scope.runtime_session_id))) then raise exception 'PROVIDER_UNAVAILABLE';end if;
  v_rows:=jsonb_build_array(jsonb_build_object('generation',0,'sessionId',p_scope.runtime_session_id,'terminalTail',null));
 else
  select count(*),min(generation),max(generation),jsonb_agg(jsonb_build_object(
    'generation',generation,'sessionId',runtime_session_id,'terminalTail',terminal_tail) order by generation)
    into v_count,v_min,v_max,v_rows from fmat.conversation_generations where conversation_id=p_scope.id;
  if v_count<>p_scope.runtime_generation+1 or v_min<>0 or v_max<>p_scope.runtime_generation
    or exists(select 1 from fmat.conversation_generations where conversation_id=p_scope.id and (
      (generation<p_scope.runtime_generation and (retired_at is null or runtime_session_id is null or terminal_tail is null))
      or (generation=p_scope.runtime_generation and (retired_at is not null or terminal_tail is not null
        or runtime_session_id is distinct from p_scope.runtime_session_id)))) then raise exception 'PROVIDER_UNAVAILABLE';end if;
 end if;
 return jsonb_build_object('conversationId',p_scope.id,'audience',p_scope.audience,
   'generation',p_scope.runtime_generation,'generations',v_rows);
end$$;
revoke all on function fmat.conversation_history_timeline(fmat.conversation_scopes) from public,anon,authenticated,service_role;
