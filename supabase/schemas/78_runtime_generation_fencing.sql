-- Callers hold the conversation's runtime advisory lock for their transaction.
-- Session IDs are immutable eve identities; the ledger resolves their server-
-- owned generation. Never trust a model/browser-supplied generation number.
create or replace function fmat.require_runtime_generation(p_scope fmat.conversation_scopes,p_session_id text,p_allow_legacy boolean default false)
returns bigint language plpgsql set search_path='' as $$
begin
 if p_scope.id is null then raise exception 'NOT_FOUND';end if;
 if p_session_id is null and p_allow_legacy and p_scope.runtime_generation=0 then return 0;end if;
 if length(coalesce(p_session_id,'')) not between 1 and 200 or p_scope.runtime_session_id is distinct from p_session_id then raise exception 'FORBIDDEN';end if;
 if p_scope.runtime_generation>0 and not exists(select 1 from fmat.conversation_generations
  where conversation_id=p_scope.id and generation=p_scope.runtime_generation and runtime_session_id=p_session_id and retired_at is null)
  then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from fmat.conversation_generations where conversation_id=p_scope.id and generation=p_scope.runtime_generation
  and (retired_at is not null or (runtime_session_id is not null and runtime_session_id<>p_session_id))) then raise exception 'FORBIDDEN';end if;
 return p_scope.runtime_generation;
end;
$$;
revoke all on function fmat.require_runtime_generation(fmat.conversation_scopes,text,boolean) from public,anon,authenticated,service_role;

-- Old claims have NULL here and may finish only on a generation-zero scope.
alter table fmat.runtime_messages add column dispatch_generation bigint check(dispatch_generation between 0 and 9007199254740991);
