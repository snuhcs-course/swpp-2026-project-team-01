-- Recovery is driven by accepted input, including a crash before any runtime
-- session exists. Leases fence acknowledgment; runtime delivery stays deduplicated.
alter table fmat.runtime_messages
  add column dispatch_token uuid,
  add column dispatch_until timestamptz,
  add column next_dispatch_at timestamptz not null default (now()+interval '30 seconds'),
  add column dispatch_attempts integer not null default 0,
  add column dispatch_error text;
create index runtime_messages_due_idx on fmat.runtime_messages(next_dispatch_at) where status='pending';

create or replace function public.fmat_runtime_dispatch(p_operation text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_message fmat.runtime_messages; v_result jsonb:='[]'; v_generation bigint; v_scope uuid;
begin
  if p_operation='claim' then
    for v_message in select * from fmat.runtime_messages
      where status='pending' and next_dispatch_at<=clock_timestamp()
        and (dispatch_until is null or dispatch_until<=clock_timestamp())
        and not exists(select 1 from fmat.conversation_scopes s where s.id=conversation_id and s.runtime_generation>0 and s.runtime_session_id is null)
      order by next_dispatch_at,id limit 5 for update skip locked
    loop
      update fmat.runtime_messages set dispatch_token=gen_random_uuid(),
        dispatch_until=clock_timestamp()+interval '90 seconds',dispatch_attempts=dispatch_attempts+1,
        dispatch_generation=(select runtime_generation from fmat.conversation_scopes where id=v_message.conversation_id)
        where id=v_message.id returning * into v_message;
      v_result:=v_result||jsonb_build_array(jsonb_build_object('messageId',v_message.id,
        'conversationId',v_message.conversation_id,'grantId',v_message.grant_id,'text',fmat.protect_conversation_text(v_message.text),
        'leaseToken',v_message.dispatch_token,'sessionId',
        (select runtime_session_id from fmat.conversation_scopes where id=v_message.conversation_id)));
    end loop;
    return v_result;
  elsif p_operation='finish' then
    if p_input->>'outcome' is null or p_input->>'outcome' not in ('sent','retry','revoked') then raise exception 'INVALID_INPUT'; end if;
    select conversation_id into v_scope from fmat.runtime_messages where id=(p_input->>'messageId')::uuid;
    if not found then raise exception 'NOT_FOUND';end if;
    -- Match recovery ordering: never hold the message lock while waiting for
    -- the runtime advisory lock. Claims only read scopes and cannot invert it.
    perform pg_advisory_xact_lock(hashtextextended('runtime:'||v_scope::text,0));
    select runtime_generation into v_generation from fmat.conversation_scopes where id=v_scope;
    select * into v_message from fmat.runtime_messages where id=(p_input->>'messageId')::uuid for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if coalesce(v_message.dispatch_generation,0) is distinct from v_generation then raise exception 'LEASE_LOST';end if;
    if v_message.dispatch_token is distinct from (p_input->>'leaseToken')::uuid
      or v_message.dispatch_token is null or v_message.dispatch_until<=clock_timestamp() then raise exception 'LEASE_LOST'; end if;
    update fmat.runtime_messages set dispatch_token=null,dispatch_until=null,
      next_dispatch_at=clock_timestamp()+interval '5 minutes',
      dispatch_error=case p_input->>'outcome' when 'sent' then null when 'revoked' then 'ACCESS_REVOKED' else 'DISPATCH_RETRY' end,
      status=case when status='pending' and p_input->>'outcome'='revoked' then 'failed' else status end,
      settled_at=case when status='pending' and p_input->>'outcome'='revoked' then clock_timestamp() else settled_at end
      where id=v_message.id;
    return jsonb_build_object('recorded',true);
  else raise exception 'INVALID_INPUT'; end if;
end;
$$;
revoke execute on function public.fmat_runtime_dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_runtime_dispatch(text,jsonb) to service_role;

-- No configured Vault entries means no network activity (including local and
-- preview databases). The URL and narrowly scoped secret are provisioned only
-- after verifying the intended release deployment. Never embed secrets in cron.
create or replace function fmat.wake_runtime_dispatch()
returns bigint language plpgsql security definer set search_path='' as $$
declare v_url text; v_secret text;
begin
  if not exists(select 1 from fmat.runtime_messages where status='pending' and next_dispatch_at<=clock_timestamp()
    and (dispatch_until is null or dispatch_until<=clock_timestamp())) then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
  if v_url is null or v_secret is null then return null; end if;
  if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION'; end if;
  return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=10000);
end;
$$;
revoke all on function fmat.wake_runtime_dispatch() from public,anon,authenticated,service_role;

-- pg-delta tracks named cron definitions; retain this alongside its installer
-- migration so later unrelated diffs cannot unschedule recovery.
select cron.schedule('fmat-runtime-dispatch','* * * * *','select fmat.wake_runtime_dispatch();');
