-- Preserve existing canonical identity without inventing terminal state/usage.
-- Block concurrent bindings during this snapshot; later generation-zero binds
-- are enrolled by the recovery/binding boundary, never by guessing history.
do $$
begin
lock table fmat.conversation_scopes in share row exclusive mode;
insert into fmat.conversation_generations(conversation_id,generation,runtime_session_id,created_at)
 select id,0,runtime_session_id,created_at from fmat.conversation_scopes where runtime_generation=0
 on conflict(conversation_id,generation) do nothing;

end;
$$;
