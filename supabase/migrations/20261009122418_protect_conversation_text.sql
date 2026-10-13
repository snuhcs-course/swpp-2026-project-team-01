SET local check_function_bodies = off;

ALTER TABLE "fmat"."runtime_messages"
  ADD COLUMN "input_fingerprint" text;

CREATE OR REPLACE FUNCTION fmat.conversation_ascii_name (
  p_text text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  STRICT
  SET search_path TO ''
  AS $function$
declare v_match text[]; v_result text:=p_text; v_byte integer;
begin
  for v_match in select regexp_matches(p_text,'%([a-f0-9]{2})','gi') loop
    v_byte:=get_byte(decode(v_match[1],'hex'),0);
    if v_byte between 48 and 57 or v_byte between 65 and 90 or v_byte between 97 and 122 or v_byte=95 then
      v_result:=replace(v_result,'%'||v_match[1],chr(v_byte));
    end if;
  end loop;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.conversation_input_fingerprint (
  p_scope  uuid,
  p_grant  uuid,
  p_client uuid,
  p_text   text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path TO ''
  AS $function$
  select encode(sha256(convert_to(jsonb_build_array('runtime-input:v1',p_scope,p_grant,p_client,p_text)::text,'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION fmat.protect_conversation_text (
  p_text text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  STRICT
  SET search_path TO ''
  AS $function$
declare v_text text; v_source text:=p_text; v_match text[]; v_offset integer; v_position integer;
begin
  if length(p_text) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
  -- [x] means removed credential material. It is shorter than every recognized
  -- shape, so protection never expands an accepted input past the ledger limit.
  -- Reconstruct by position: replacing a short match globally could remove only
  -- the prefix of another, longer credential and leave its suffix behind.
  v_text:=''; v_offset:=1;
  for v_match in select regexp_matches(v_source,'(https?://[^[:space:]<>#]+#([^[:space:]<>]+))','gi') loop
    v_position:=v_offset+strpos(substr(v_source,v_offset),v_match[1])-1;
    v_text:=v_text||substr(v_source,v_offset,v_position-v_offset);
    if fmat.conversation_ascii_name(v_match[2]) ~* 'token|code|state|secret|proof|recovery|invitation|imessage|credential' then
      v_text:=v_text||left(v_match[1],length(v_match[1])-length(v_match[2]))||'[x]';
    else v_text:=v_text||v_match[1]; end if;
    v_offset:=v_position+length(v_match[1]);
  end loop;
  v_source:=v_text||substr(v_source,v_offset); v_text:=''; v_offset:=1;
  for v_match in select regexp_matches(v_source,'(([[:alnum:]_%.-]+)=([^[:space:]&#<>]*))','g') loop
    v_position:=v_offset+strpos(substr(v_source,v_offset),v_match[1])-1;
    v_text:=v_text||substr(v_source,v_offset,v_position-v_offset);
    if fmat.conversation_ascii_name(v_match[2]) ~* 'token|code|state|secret|proof|recovery|invitation|credential' then
      v_text:=v_text||'[x]';
    else v_text:=v_text||v_match[1]; end if;
    v_offset:=v_position+length(v_match[1]);
  end loop;
  v_text:=v_text||substr(v_source,v_offset);
  v_text:=regexp_replace(v_text,'\mBearer[[:space:]]+[A-Za-z0-9._~+/-]+=*','[x]','gi');
  return regexp_replace(v_text,'\mLINK[[:space:]]+[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[[:space:]]+[A-Za-z0-9_-]{32,}','[x]','gi');
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_runtime_dispatch (
  p_operation text,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_message fmat.runtime_messages; v_result jsonb:='[]';
begin
  if p_operation='claim' then
    for v_message in select * from fmat.runtime_messages
      where status='pending' and next_dispatch_at<=clock_timestamp()
        and (dispatch_until is null or dispatch_until<=clock_timestamp())
      order by next_dispatch_at,id limit 5 for update skip locked
    loop
      update fmat.runtime_messages set dispatch_token=gen_random_uuid(),
        dispatch_until=clock_timestamp()+interval '90 seconds',dispatch_attempts=dispatch_attempts+1
        where id=v_message.id returning * into v_message;
      v_result:=v_result||jsonb_build_array(jsonb_build_object('messageId',v_message.id,
        'conversationId',v_message.conversation_id,'grantId',v_message.grant_id,'text',fmat.protect_conversation_text(v_message.text),
        'leaseToken',v_message.dispatch_token,'sessionId',
        (select runtime_session_id from fmat.conversation_scopes where id=v_message.conversation_id)));
    end loop;
    return v_result;
  elsif p_operation='finish' then
    if p_input->>'outcome' is null or p_input->>'outcome' not in ('sent','retry','revoked') then raise exception 'INVALID_INPUT'; end if;
    select * into v_message from fmat.runtime_messages where id=(p_input->>'messageId')::uuid for update;
    if not found then raise exception 'NOT_FOUND'; end if;
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
  if p_operation='settle' then
    -- A runtime may record completion after the originating grant expires.
    -- Reply preparation separately requires current private-channel authority.
    select * into v_scope from fmat.conversation_scopes where id=p_conversation_id;
    if v_scope.runtime_session_id is null or v_scope.runtime_session_id is distinct from p_input->>'sessionId' then raise exception 'FORBIDDEN'; end if;
    if p_input->>'status' is null or p_input->>'status' not in ('completed','failed') then raise exception 'INVALID_INPUT'; end if;
    -- Commit an eligible private reply in the same transaction as completion.
    -- A failed write leaves the input pending for checkpoint-based recovery.
    perform fmat.photon_reply_prepare(p_grant_id,p_conversation_id,p_input);
    perform fmat.requester_email_reply_prepare(p_grant_id,p_conversation_id,p_input);
    update fmat.runtime_messages set status=p_input->>'status',settled_at=clock_timestamp()
      where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id and status='pending';
    return jsonb_build_object('recorded',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('runtime:'||p_conversation_id::text,0));
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
    if v_scope.runtime_session_id is not null and v_scope.runtime_session_id<>v_session then raise exception 'FORBIDDEN'; end if;
    update fmat.conversation_scopes set runtime_session_id=v_session where id=p_conversation_id and runtime_session_id is null;
  else raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('id',v_message.id,'status',v_message.status,'text',fmat.protect_conversation_text(v_message.text));
end;
$function$;

ALTER TABLE "fmat"."runtime_messages"
  ADD CONSTRAINT "runtime_messages_input_fingerprint_check" CHECK ((input_fingerprint ~ '^[a-f0-9]{64}$'::text));

REVOKE ALL ON FUNCTION "fmat"."conversation_ascii_name"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."conversation_input_fingerprint"(uuid, uuid, uuid, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."protect_conversation_text"(text) FROM PUBLIC;
