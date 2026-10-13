-- Last accepted live totals are a monotone floor, not a second set of charges.
-- Retired totals in conversation_generations replace this floor in aggregation.
create table fmat.conversation_model_usage (
 conversation_id uuid not null,
 generation bigint not null,
 input_tokens bigint not null check(input_tokens between 0 and 9007199254740991),
 output_tokens bigint not null check(output_tokens between 0 and 9007199254740991),
 cache_read_tokens bigint not null check(cache_read_tokens between 0 and 9007199254740991),
 cache_write_tokens bigint not null check(cache_write_tokens between 0 and 9007199254740991),
 primary key(conversation_id,generation),
 foreign key(conversation_id,generation) references fmat.conversation_generations(conversation_id,generation) on delete cascade
);
alter table fmat.conversation_model_usage enable row level security;
revoke all on fmat.conversation_model_usage from public,anon,authenticated,service_role;

-- Caller already owns runtime advisory, authority, scope and message locks.
-- No caller-supplied generation or runtime can choose the accounting scope.
create or replace function fmat.require_model_usage(p_scope fmat.conversation_scopes,p_usage jsonb)
returns void language plpgsql set search_path='' as $$
declare key text; value numeric; prior fmat.conversation_model_usage;
 retired_count bigint; retired_input numeric; retired_output numeric;
begin
 if exists(select 1 from fmat.conversation_model_receipts where conversation_id=p_scope.id and generation=p_scope.runtime_generation and usage is null) then raise exception 'MODEL_LIMIT';end if;
 select * into prior from fmat.conversation_model_usage where conversation_id=p_scope.id and generation=p_scope.runtime_generation for update;
 if p_usage is null then
  if p_scope.runtime_generation<>0 then raise exception 'MODEL_LIMIT';end if;
  if prior.conversation_id is null then return;end if;
  p_usage:=jsonb_build_object('inputTokens',prior.input_tokens,'outputTokens',prior.output_tokens,'cacheReadTokens',prior.cache_read_tokens,'cacheWriteTokens',prior.cache_write_tokens);
 end if;
 if jsonb_typeof(p_usage) is distinct from 'object' or (p_usage-'inputTokens'-'outputTokens'-'cacheReadTokens'-'cacheWriteTokens')<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 foreach key in array array['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'] loop
  if jsonb_typeof(p_usage->key) is distinct from 'number' then raise exception 'INVALID_INPUT';end if;
  value:=(p_usage->>key)::numeric;
  if value<0 or value>9007199254740991 or trunc(value)<>value then raise exception 'INVALID_INPUT';end if;
 end loop;
 -- A restarted checkpoint may lag an acknowledged provider receipt. Retain
 -- the database floor; a stale runtime snapshot never subtracts reported use.
 p_usage:=jsonb_build_object('inputTokens',greatest((p_usage->>'inputTokens')::bigint,coalesce(prior.input_tokens,0)),
  'outputTokens',greatest((p_usage->>'outputTokens')::bigint,coalesce(prior.output_tokens,0)),
  'cacheReadTokens',greatest((p_usage->>'cacheReadTokens')::bigint,coalesce(prior.cache_read_tokens,0)),
  'cacheWriteTokens',greatest((p_usage->>'cacheWriteTokens')::bigint,coalesce(prior.cache_write_tokens,0)));
 select count(*),coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0) into retired_count,retired_input,retired_output
  from fmat.conversation_generations where conversation_id=p_scope.id and generation<p_scope.runtime_generation and retired_at is not null;
 if retired_count<>p_scope.runtime_generation then raise exception 'MODEL_LIMIT';end if;
 if retired_input+(p_usage->>'inputTokens')::numeric>=100000 or retired_output+(p_usage->>'outputTokens')::numeric>=8000 then raise exception 'MODEL_LIMIT';end if;
 insert into fmat.conversation_model_usage values(p_scope.id,p_scope.runtime_generation,(p_usage->>'inputTokens')::bigint,
  (p_usage->>'outputTokens')::bigint,(p_usage->>'cacheReadTokens')::bigint,(p_usage->>'cacheWriteTokens')::bigint)
 on conflict(conversation_id,generation) do update set input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,
  cache_read_tokens=excluded.cache_read_tokens,cache_write_tokens=excluded.cache_write_tokens;
end;
$$;
revoke all on function fmat.require_model_usage(fmat.conversation_scopes,jsonb) from public,anon,authenticated,service_role;
