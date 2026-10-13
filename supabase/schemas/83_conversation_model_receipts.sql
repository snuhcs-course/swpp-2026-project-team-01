create table fmat.conversation_model_receipts (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null,
 generation bigint not null,
 message_id uuid not null references fmat.runtime_messages(id) on delete cascade,
 usage jsonb,
 foreign key(conversation_id,generation) references fmat.conversation_generations(conversation_id,generation) on delete cascade
);
create index conversation_model_receipts_open_idx on fmat.conversation_model_receipts(conversation_id,generation) where usage is null;
create index conversation_model_receipts_message_idx on fmat.conversation_model_receipts(message_id);
alter table fmat.conversation_model_receipts enable row level security;
revoke all on fmat.conversation_model_receipts from public,anon,authenticated,service_role;

-- A provider receipt only records reported usage. It cannot authorize a tool,
-- renew a participant, accept input or perform another model call. Recording
-- after grant expiry is allowed for the exact already-charged canonical call.
create or replace function public.fmat_conversation_model_usage(p_conversation_id uuid,p_message_id uuid,p_session_id text,p_attempt_id uuid,p_usage jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope fmat.conversation_scopes; receipt fmat.conversation_model_receipts; key text; value numeric;
begin
 if jsonb_typeof(p_usage) is distinct from 'object' or (p_usage-'inputTokens'-'outputTokens'-'cacheReadTokens'-'cacheWriteTokens')<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 foreach key in array array['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'] loop
  if jsonb_typeof(p_usage->key) is distinct from 'number' then raise exception 'INVALID_INPUT';end if;
  value:=(p_usage->>key)::numeric;
  if value<0 or value>9007199254740991 or trunc(value)<>value then raise exception 'INVALID_INPUT';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 select * into scope from fmat.conversation_scopes where id=p_conversation_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 perform fmat.require_runtime_generation(scope,p_session_id);
 select * into receipt from fmat.conversation_model_receipts where id=p_attempt_id and conversation_id=scope.id and generation=scope.runtime_generation and message_id=p_message_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if receipt.usage is not null then
  if receipt.usage<>p_usage then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('recorded',true);
 end if;
 insert into fmat.conversation_model_usage values(scope.id,scope.runtime_generation,0,0,0,0) on conflict do nothing;
 -- The storage bounds reject overflow rather than wrapping into fresh quota.
 update fmat.conversation_model_usage set input_tokens=input_tokens+(p_usage->>'inputTokens')::bigint,
  output_tokens=output_tokens+(p_usage->>'outputTokens')::bigint,cache_read_tokens=cache_read_tokens+(p_usage->>'cacheReadTokens')::bigint,
  cache_write_tokens=cache_write_tokens+(p_usage->>'cacheWriteTokens')::bigint where conversation_id=scope.id and generation=scope.runtime_generation;
 update fmat.conversation_model_receipts set usage=p_usage where id=receipt.id;
 return jsonb_build_object('recorded',true);
end;
$$;
revoke all on function public.fmat_conversation_model_usage(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_conversation_model_usage(uuid,uuid,text,uuid,jsonb) to service_role;
