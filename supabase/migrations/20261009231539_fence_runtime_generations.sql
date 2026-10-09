SET local check_function_bodies = off;

DROP FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb);

ALTER TABLE "fmat"."runtime_messages"
  ADD COLUMN "dispatch_generation" bigint;

CREATE OR REPLACE FUNCTION fmat.require_runtime_generation (
  p_scope        fmat.conversation_scopes,
  p_session_id   text,
  p_allow_legacy boolean                  DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_model_reserve (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_message_id      uuid,
  p_session_id      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare access jsonb; scope fmat.conversation_scopes; message fmat.runtime_messages;
begin
 if p_grant_id is null or p_conversation_id is null or p_message_id is null
  or length(coalesce(p_session_id,'')) not between 1 and 200 then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 select * into strict scope from fmat.conversation_scopes where id=p_conversation_id for update;
 perform fmat.require_runtime_generation(scope,p_session_id);
 select * into message from fmat.runtime_messages where id=p_message_id and conversation_id=p_conversation_id and grant_id=p_grant_id for update;
 if not found or message.status<>'pending' then raise exception 'NOT_FOUND';end if;
 perform fmat.model_budget_reserve(access->>'actorKind',case when access->>'actorKind'='host' then scope.host_id else scope.request_id end,'conversation',message.id);
 -- Time may expire while the service counter is contended. All charges roll
 -- back if the original authority is no longer valid after that wait.
 access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
 if (access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
 return jsonb_build_object('reserved',true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_tool (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_operation       text,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select public.fmat_conversation_tool(p_grant_id,p_conversation_id,p_operation,p_input,null::text);
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_conversation_tool (
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_operation       text,
  p_input           jsonb,
  p_session_id      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_access jsonb; v_actor jsonb; v_input jsonb; v_result jsonb; v_request_id uuid; v_scope fmat.conversation_scopes;
begin
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  select * into strict v_scope from fmat.conversation_scopes where id=p_conversation_id;
  perform fmat.require_runtime_generation(v_scope,p_session_id,true);
  v_actor:=v_access->'actor'; v_request_id:=(v_access->>'requestId')::uuid;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  case p_operation
  when 'context_read' then
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
    return jsonb_build_object('audience',v_access->'audience','requestId',v_access->'requestId','readOnly',v_access->'readOnly');
  when 'host_requests_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_request_model_page((v_actor->>'id')::uuid,p_input);
  when 'setup_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.host_setup_operation('read',v_actor,'{}','assistant');
  when 'setup_analysis_read' then
    if v_access->>'audience' not in ('host_setup','host_private') or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    return fmat.calendar_scan_model_view((v_actor->>'id')::uuid);
  when 'setup_draft' then
    if v_access->>'audience'<>'host_setup' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    return fmat.host_setup_operation('draft',v_actor,p_input,'assistant');
  when 'request_read' then
    if v_request_id is null then raise exception 'FORBIDDEN'; end if;
    if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
    -- Host identity does not make a shared conversation private. Project for
    -- the audience at the database boundary before any model sees the result.
    v_result:=fmat.request_view(v_request_id,case when v_access->>'audience'='request_shared' then '{"kind":"guest"}'::jsonb else v_actor end);
    if v_actor->>'kind'='guest' then
      v_result:=v_result||jsonb_build_object('review',(select fmat.request_detail_review_view(r) from fmat.request_detail_reviews r
        where r.request_id=v_request_id and r.authority_key=v_actor->>'tokenHash' order by r.created_at desc,r.id desc limit 1));
    end if;
    if v_access->>'audience'='host_private' and v_actor->>'kind'='host' then
      v_result:=v_result||jsonb_build_object('revisionDraft',(select fmat.host_revision_view(d) from fmat.host_revision_drafts d
        where d.request_id=v_request_id and d.host_id=(v_actor->>'id')::uuid order by d.created_at desc,d.id desc limit 1));
    end if;
    return v_result;
  when 'host_revision_propose' then
    if v_access->>'audience'<>'host_private' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN';end if;
    if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED';end if;
    return fmat.propose_host_revision(v_actor,v_request_id,p_input);
  when 'private_note_save' then
    if v_access->>'audience'<>'host_private' or v_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('text','expectedRevision','idempotencyKey')) then raise exception 'INVALID_INPUT'; end if;
    if jsonb_typeof(p_input->'text') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  when 'details_propose' then
    if v_access->>'audience'<>'request_shared' or v_actor->>'kind'<>'guest' then raise exception 'FORBIDDEN'; end if;
    if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
    return fmat.propose_request_details(v_actor,p_input);
  else
    -- Approval, agreement, confirmed settings, travel exceptions and worker or
    -- provider outcomes require separate authored application operations.
    raise exception 'FORBIDDEN';
  end case;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if jsonb_typeof(p_input->'expectedRevision') is distinct from 'number'
    or (p_input->>'expectedRevision') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  v_input:=p_input||jsonb_build_object('requestId',v_request_id);
  v_result:=public.fmat_command(p_operation,v_actor,v_input);
  if v_access->>'audience'='request_shared' then
    -- Also scrub cached idempotency results; these may have been produced by
    -- the host's same command from a private application surface.
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_result from jsonb_each(v_result)
      where key=any(array['id','hostId','revision','status','details','candidates','proposal','requesterAgreed','hostApproved','contactVerified','calendarConnected','event','messages','nextAction','receipt']);
  end if;
  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb, text) FROM PUBLIC, "anon", "authenticated";

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
$function$;

CREATE OR REPLACE FUNCTION public.fmat_runtime_message (
  p_operation       text,
  p_grant_id        uuid,
  p_conversation_id uuid,
  p_input           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_access jsonb; v_message fmat.runtime_messages; v_scope fmat.conversation_scopes; v_session text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
  if p_operation='settle' then
    -- A runtime may record completion after the originating grant expires.
    -- Reply preparation separately requires current private-channel authority.
    select * into v_scope from fmat.conversation_scopes where id=p_conversation_id;
    perform fmat.require_runtime_generation(v_scope,p_input->>'sessionId');
    if p_input->>'status' is null or p_input->>'status' not in ('completed','failed') then raise exception 'INVALID_INPUT'; end if;
    -- Commit an eligible private reply in the same transaction as completion.
    -- A failed write leaves the input pending for checkpoint-based recovery.
    perform fmat.photon_reply_prepare(p_grant_id,p_conversation_id,p_input);
    perform fmat.requester_email_reply_prepare(p_grant_id,p_conversation_id,p_input);
    update fmat.runtime_messages set status=p_input->>'status',settled_at=clock_timestamp()
      where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id and status='pending';
    return jsonb_build_object('recorded',true);
  end if;
  v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
  -- Serialize accept/bind against other participants on this shared scope.
  select * into v_scope from fmat.conversation_scopes where id=p_conversation_id for update;
  if p_operation='inspect' then
    return jsonb_build_object('sessionId',v_scope.runtime_session_id,'messages',(
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',fmat.protect_conversation_text(text),'status',status,'createdAt',created_at,
        'mine',grant_id=p_grant_id) order by created_at,id),'[]'::jsonb) from fmat.runtime_messages where conversation_id=p_conversation_id));
  end if;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if p_operation='accept' then
    if coalesce(p_input->>'clientId','')='' or jsonb_typeof(p_input->'text') is distinct from 'string'
      or length(p_input->>'text') not between 1 and 10000 or length(trim(p_input->>'text'))=0
      or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('clientId','text')) then raise exception 'INVALID_INPUT'; end if;
    select * into v_message from fmat.runtime_messages where conversation_id=p_conversation_id and grant_id=p_grant_id and client_id=(p_input->>'clientId')::uuid;
    if found then
      if coalesce(v_message.input_fingerprint,fmat.conversation_input_fingerprint(p_conversation_id,p_grant_id,v_message.client_id,v_message.text))
        is distinct from fmat.conversation_input_fingerprint(p_conversation_id,p_grant_id,v_message.client_id,p_input->>'text')
        then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    else
      if exists(select 1 from fmat.runtime_messages where conversation_id=p_conversation_id and status='pending') then raise exception 'CONVERSATION_BUSY'; end if;
      -- Bounded inbox/checkpoint growth; the runtime has independent token caps.
      if (select count(*) from fmat.runtime_messages where conversation_id=p_conversation_id)>=200 then raise exception 'CONVERSATION_LIMIT'; end if;
      perform fmat.conversation_budget_charge(v_access->>'actorKind',
        case when v_access->>'actorKind'='host' then v_scope.host_id else v_scope.request_id end);
      -- Quota contention may outlast a grant, Auth session or request deadline.
      v_access:=public.fmat_conversation_check(p_grant_id,p_conversation_id);
      if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
      insert into fmat.runtime_messages(conversation_id,grant_id,client_id,text,input_fingerprint)
        values(p_conversation_id,p_grant_id,(p_input->>'clientId')::uuid,fmat.protect_conversation_text(p_input->>'text'),
          fmat.conversation_input_fingerprint(p_conversation_id,p_grant_id,(p_input->>'clientId')::uuid,p_input->>'text')) returning * into v_message;
    end if;
  elsif p_operation='deliver' then
    select * into v_message from fmat.runtime_messages where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_session:=p_input->>'sessionId';
    if length(coalesce(v_session,'')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
    if v_scope.runtime_generation>0 and v_scope.runtime_session_id is null then raise exception 'RECONCILIATION_PENDING';end if;
    if v_scope.runtime_session_id is not null then perform fmat.require_runtime_generation(v_scope,v_session);end if;
    update fmat.conversation_scopes set runtime_session_id=v_session where id=p_conversation_id and runtime_session_id is null;
    insert into fmat.conversation_generations(conversation_id,generation,runtime_session_id)
      values(p_conversation_id,v_scope.runtime_generation,v_session) on conflict(conversation_id,generation) do update
      set runtime_session_id=excluded.runtime_session_id where conversation_generations.generation=0
        and conversation_generations.runtime_session_id is null and conversation_generations.retired_at is null;
  else raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('id',v_message.id,'status',v_message.status,'text',fmat.protect_conversation_text(v_message.text));
end;
$function$;

ALTER TABLE "fmat"."runtime_messages"
  ADD CONSTRAINT "runtime_messages_dispatch_generation_check" CHECK (((dispatch_generation >= 0) AND (dispatch_generation <= '9007199254740991'::bigint)));

REVOKE ALL ON FUNCTION "fmat"."require_runtime_generation"(fmat.conversation_scopes, text, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_tool"(uuid, uuid, text, jsonb, text) TO "service_role";
