SET local check_function_bodies = off;

CREATE TABLE "fmat"."requester_email_replies" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "receipt_id"          uuid                     NOT NULL,
  "runtime_message_id"  uuid                     NOT NULL,
  "link_id"             uuid                     NOT NULL,
  "inbox_id"            text                     NOT NULL,
  "receiver_id"         uuid                     NOT NULL,
  "thread_id"           text                     NOT NULL,
  "parent_message_id"   text                     NOT NULL,
  "recipient"           text                     NOT NULL,
  "text"                text,
  "status"              text                     NOT NULL DEFAULT 'prepared'::text,
  "provider_message_id" text,
  "first_attempt_at"    timestamp with time zone,
  "accepted_at"         timestamp with time zone,
  "lease_token"         uuid,
  "lease_until"         timestamp with time zone,
  "checked_at"          timestamp with time zone,
  "created_at"          timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "suppressed_at"       timestamp with time zone,
  CONSTRAINT "requester_email_replies_check1" CHECK (((text IS NOT NULL) OR (suppressed_at IS NOT NULL))),
  CONSTRAINT "requester_email_replies_check2" CHECK (((status = 'prepared'::text) OR (first_attempt_at IS NOT NULL))),
  CONSTRAINT "requester_email_replies_check3" CHECK (((status <> 'accepted'::text) OR ((provider_message_id IS NOT NULL) AND (accepted_at IS NOT NULL)))),
  CONSTRAINT "requester_email_replies_check" CHECK (((lease_token IS NULL) = (lease_until IS NULL))),
  CONSTRAINT "requester_email_replies_parent_message_id_check" CHECK (((length(parent_message_id) >= 1) AND (length(parent_message_id) <= 512))),
  CONSTRAINT "requester_email_replies_pkey" PRIMARY KEY (id),
  CONSTRAINT "requester_email_replies_provider_message_id_check" CHECK (((length(provider_message_id) >= 1) AND (length(provider_message_id) <= 512))),
  CONSTRAINT "requester_email_replies_receipt_id_key" UNIQUE (receipt_id),
  CONSTRAINT "requester_email_replies_recipient_check" CHECK (((length(recipient) >= 1) AND (length(recipient) <= 320))),
  CONSTRAINT "requester_email_replies_runtime_message_id_key" UNIQUE (runtime_message_id),
  CONSTRAINT "requester_email_replies_status_check" CHECK ((status = ANY (ARRAY['prepared'::text, 'uncertain'::text, 'accepted'::text]))),
  CONSTRAINT "requester_email_replies_text_check" CHECK (((length(text) >= 1) AND (length(text) <= 10000))),
  CONSTRAINT "requester_email_replies_thread_id_check" CHECK (((length(thread_id) >= 1) AND (length(thread_id) <= 512)))
);

ALTER TABLE "fmat"."requester_email_replies"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.requester_email_reply_prepare (
  p_grant uuid,
  p_scope uuid,
  p_input jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.agentmail_inbox; m fmat.runtime_messages; g fmat.conversation_grants; l fmat.requester_email_links; valid boolean:=true; reply text;
begin
 select * into m from fmat.runtime_messages where id=(p_input->>'messageId')::uuid and grant_id=p_grant and conversation_id=p_scope;
 if not found then return;end if;
 select * into i from fmat.agentmail_inbox where runtime_message_id=m.id and processing_outcome='accepted';
 if not found then return;end if;
 select * into g from fmat.conversation_grants where id=p_grant;
 if g.credential->>'kind' is distinct from 'requester_email' or g.credential->>'receiptId' is distinct from i.id::text
  or g.credential->>'linkId' is distinct from i.link_id::text or g.credential->>'receiverId' is distinct from i.receiver_id::text then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from fmat.requester_email_replies where receipt_id=i.id) then return;end if;
 begin perform public.fmat_conversation_check(p_grant,p_scope);
 exception when raise_exception then
  if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED','REQUEST_CLOSED','REQUEST_EXPIRED') then valid:=false;else raise;end if;
 end;
 -- Lock only after current request authority, matching command lock order.
 -- Historical completed turns have no frozen output; do not invent one now.
 select * into m from fmat.runtime_messages where id=m.id for update;
 if m.status<>'pending' then return;end if;
 select * into strict l from fmat.requester_email_links where id=i.link_id;
 if valid then
  if p_input->>'status'='completed' and p_input ? 'reply' and jsonb_typeof(p_input->'reply') not in ('string','null') then raise exception 'INVALID_INPUT';end if;
  reply:=case when p_input->>'status'='completed' then nullif(btrim(p_input->>'reply'),'') else null end;
  if reply is null then reply:='I could not complete this reply. Your saved changes are preserved. Open Find Me a Time in your browser to continue.';end if;
  if length(reply)>10000 then raise exception 'INVALID_INPUT';end if;
 end if;
 insert into fmat.requester_email_replies(receipt_id,runtime_message_id,link_id,inbox_id,receiver_id,thread_id,parent_message_id,recipient,text,suppressed_at)
 values(i.id,m.id,l.id,i.inbox_id,i.receiver_id,i.thread_id,i.message_id,l.email,reply,case when valid then null else clock_timestamp() end)
 on conflict(receipt_id) do nothing;
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
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'status',status,'createdAt',created_at,
        'mine',grant_id=p_grant_id) order by created_at,id),'[]'::jsonb) from fmat.runtime_messages where conversation_id=p_conversation_id));
  end if;
  if (v_access->>'readOnly')::boolean then raise exception 'REQUEST_CLOSED'; end if;
  if p_operation='accept' then
    if coalesce(p_input->>'clientId','')='' or jsonb_typeof(p_input->'text') is distinct from 'string'
      or length(trim(p_input->>'text')) not between 1 and 10000
      or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('clientId','text')) then raise exception 'INVALID_INPUT'; end if;
    select * into v_message from fmat.runtime_messages where conversation_id=p_conversation_id and grant_id=p_grant_id and client_id=(p_input->>'clientId')::uuid;
    if found then
      if v_message.text is distinct from p_input->>'text' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    else
      if exists(select 1 from fmat.runtime_messages where conversation_id=p_conversation_id and status='pending') then raise exception 'CONVERSATION_BUSY'; end if;
      -- Bounded inbox/checkpoint growth; the runtime has independent token caps.
      if (select count(*) from fmat.runtime_messages where conversation_id=p_conversation_id)>=200 then raise exception 'CONVERSATION_LIMIT'; end if;
      insert into fmat.runtime_messages(conversation_id,grant_id,client_id,text)
        values(p_conversation_id,p_grant_id,(p_input->>'clientId')::uuid,p_input->>'text') returning * into v_message;
    end if;
  elsif p_operation='deliver' then
    select * into v_message from fmat.runtime_messages where id=(p_input->>'messageId')::uuid and conversation_id=p_conversation_id and grant_id=p_grant_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_session:=p_input->>'sessionId';
    if length(coalesce(v_session,'')) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
    if v_scope.runtime_session_id is not null and v_scope.runtime_session_id<>v_session then raise exception 'FORBIDDEN'; end if;
    update fmat.conversation_scopes set runtime_session_id=v_session where id=p_conversation_id and runtime_session_id is null;
  else raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('id',v_message.id,'status',v_message.status,'text',v_message.text);
end;
$function$;

ALTER TABLE "fmat"."requester_email_replies"
  ADD CONSTRAINT "requester_email_replies_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.agentmail_receivers(inbox_id);

ALTER TABLE "fmat"."requester_email_replies"
  ADD CONSTRAINT "requester_email_replies_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.requester_email_links(id);

ALTER TABLE "fmat"."requester_email_replies"
  ADD CONSTRAINT "requester_email_replies_receipt_id_fkey" FOREIGN KEY (receipt_id) REFERENCES fmat.agentmail_inbox(id);

ALTER TABLE "fmat"."requester_email_replies"
  ADD CONSTRAINT "requester_email_replies_runtime_message_id_fkey" FOREIGN KEY (runtime_message_id) REFERENCES fmat.runtime_messages(id);

CREATE INDEX requester_email_replies_due_idx ON fmat.requester_email_replies USING btree (receiver_id, checked_at, created_at)
  WHERE ((suppressed_at IS NULL) AND (status = ANY (ARRAY['prepared'::text, 'uncertain'::text])));

CREATE INDEX requester_email_replies_link_idx ON fmat.requester_email_replies USING btree (link_id);

CREATE UNIQUE INDEX requester_email_replies_provider_idx ON fmat.requester_email_replies USING btree (inbox_id, provider_message_id)
  WHERE (provider_message_id IS NOT NULL);

REVOKE ALL ON FUNCTION "fmat"."requester_email_reply_prepare"(uuid, uuid, jsonb) FROM PUBLIC;
