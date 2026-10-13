SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fmat_runtime_dispatch (
  p_operation text,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_message fmat.runtime_messages; v_result jsonb:='[]'; v_generation bigint; v_scope uuid;
begin
  if p_operation='claim' then
    for v_message in select * from fmat.runtime_messages
      where status='pending' and next_dispatch_at<=clock_timestamp()
        and (dispatch_until is null or dispatch_until<=clock_timestamp())
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
$function$;

CREATE OR REPLACE FUNCTION public.fmat_runtime_successor (
  p_operation       text,
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select fmat.conversation_successor(p_operation,p_grant_id,p_conversation_id,p_input);
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_runtime_successor"(text, uuid, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fmat_runtime_successor"(text, uuid, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_runtime_successor"(text, uuid, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_runtime_successor"(text, uuid, uuid, jsonb) TO "service_role";
