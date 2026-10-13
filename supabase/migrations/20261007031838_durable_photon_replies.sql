SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE TABLE "fmat"."photon_replies" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "inbox_id"           uuid                     NOT NULL,
  "project_id"         uuid                     NOT NULL,
  "text"               text,
  "status"             text                     NOT NULL DEFAULT 'prepared'::text,
  "provider_reference" text,
  "lease_token"        uuid,
  "lease_until"        timestamp with time zone,
  "checked_at"         timestamp with time zone,
  "created_at"         timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "revoked_at"         timestamp with time zone,
  CONSTRAINT "photon_replies_check1" CHECK (((text IS NOT NULL) OR (revoked_at IS NOT NULL) OR (status = ANY (ARRAY['delivered'::text, 'failed'::text])))),
  CONSTRAINT "photon_replies_check" CHECK (((lease_token IS NULL) = (lease_until IS NULL))),
  CONSTRAINT "photon_replies_inbox_id_key" UNIQUE (inbox_id),
  CONSTRAINT "photon_replies_pkey" PRIMARY KEY (id),
  CONSTRAINT "photon_replies_provider_reference_check" CHECK (((length(provider_reference) >= 1) AND (length(provider_reference) <= 512))),
  CONSTRAINT "photon_replies_status_check" CHECK ((status = ANY (ARRAY['prepared'::text, 'uncertain'::text, 'accepted'::text, 'delivered'::text, 'failed'::text]))),
  CONSTRAINT "photon_replies_text_check" CHECK (((length(text) >= 1) AND (length(text) <= 4000)))
);

ALTER TABLE "fmat"."photon_replies"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.photon_reply_prepare (
  p_grant uuid,
  p_scope uuid,
  p_input jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; m fmat.runtime_messages; g fmat.conversation_grants; valid boolean:=true; reply text;
begin
 select * into m from fmat.runtime_messages where id=(p_input->>'messageId')::uuid and grant_id=p_grant and conversation_id=p_scope;
 if not found then return; end if;
 select * into i from fmat.photon_inbox where runtime_message_id=m.id and processing_outcome='accepted';
 if not found then return; end if;
 select * into g from fmat.conversation_grants where id=p_grant;
 if g.credential->>'kind' is distinct from 'photon' or g.credential->>'inboxId' is distinct from i.id::text then raise exception 'FORBIDDEN'; end if;
 -- A replay returns the first frozen outcome; model retries cannot replace a
 -- text already queued or accepted by the provider.
 if exists(select 1 from fmat.photon_replies where inbox_id=i.id) then return; end if;
 begin perform public.fmat_conversation_check(p_grant,p_scope);
 exception when raise_exception then
  if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED') then valid:=false;else raise;end if;
 end;
 reply:=case when p_input->>'status'='completed' then nullif(btrim(p_input->>'reply'),'') else null end;
 if reply is null then reply:='I could not complete this reply. Your saved changes are preserved. Open Find Me a Time in your browser to continue.';end if;
 if length(reply)>4000 then raise exception 'INVALID_INPUT';end if;
 insert into fmat.photon_replies(inbox_id,project_id,text,revoked_at)
 values(i.id,i.project_id,case when valid then reply else null end,case when valid then null else clock_timestamp() end)
 on conflict(inbox_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.wake_photon_replies()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_url text;v_secret text;
begin
 if not exists(select 1 from fmat.photon_replies where revoked_at is null and status in ('prepared','uncertain','accepted')
  and (lease_until is null or lease_until<=clock_timestamp()) and (checked_at is null or checked_at<=clock_timestamp()-interval '30 seconds')) then return null;end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if v_url is null or v_secret is null then return null;end if;
 if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 v_url:=replace(v_url,'/api/internal/conversations/dispatch','/api/internal/photon/replies');
 return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_photon_reply_delivery (
  p_operation  text,
  p_project_id uuid,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.photon_replies; i fmat.photon_inbox; m fmat.runtime_messages; valid boolean:=true; action text;
begin
 if p_operation='claim' then
  select r0.* into r from fmat.photon_replies r0 join fmat.photon_inbox i0 on i0.id=r0.inbox_id
  where r0.project_id=p_project_id and r0.revoked_at is null and r0.status in ('prepared','uncertain','accepted')
   and (r0.lease_until is null or r0.lease_until<=clock_timestamp())
   and (r0.checked_at is null or r0.checked_at<=clock_timestamp()-interval '30 seconds')
   -- Once acceptance is known, a later reply may send; unknown acceptance
   -- holds later replies so recovery never silently reverses their order.
   and not exists(select 1 from fmat.photon_replies prior join fmat.photon_inbox pi on pi.id=prior.inbox_id
    where pi.project_id=i0.project_id and pi.line=i0.line and pi.space_id=i0.space_id and pi.received_order<i0.received_order
     and prior.revoked_at is null and prior.status in ('prepared','uncertain'))
  order by coalesce(r0.checked_at,r0.created_at),i0.received_order limit 1;
  if not found then return jsonb_build_object('action','idle');end if;
 else
  select * into r from fmat.photon_replies where id=(p_input->>'replyId')::uuid and project_id=p_project_id;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 select * into strict i from fmat.photon_inbox where id=r.inbox_id;
 select * into strict m from fmat.runtime_messages where id=i.runtime_message_id;
 if p_operation in ('claim','authorize') then
  -- Same host/scope/reply order as settlement and revocation; never acquire
  -- the reply lock before waiting on host authority.
  begin perform public.fmat_conversation_check(m.grant_id,m.conversation_id);
  exception when raise_exception then
   if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED') then valid:=false;else raise;end if;
  end;
 end if;
 select * into r from fmat.photon_replies where id=r.id for update;
 if p_operation='claim' then
  if r.revoked_at is not null or r.status not in ('prepared','uncertain','accepted') or r.lease_until>clock_timestamp()
   or r.checked_at>clock_timestamp()-interval '30 seconds' then return jsonb_build_object('action','idle');end if;
  if not valid then
   update fmat.photon_replies set revoked_at=clock_timestamp(),text=null,lease_token=null,lease_until=null where id=r.id;
   return jsonb_build_object('action','suppressed');
  end if;
  action:=case when r.status='prepared' then 'send' else 'reconcile' end;
  update fmat.photon_replies set status=case when action='send' then 'uncertain' else status end,
   lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',checked_at=clock_timestamp()
   where id=r.id returning * into r;
  return jsonb_build_object('action',action,'replyId',r.id,'projectId',r.project_id,'leaseToken',r.lease_token,
   'phone',i.sender_id,'line',i.line,'spaceId',i.space_id,'text',case when action='send' then r.text else null end,'providerReference',r.provider_reference);
 end if;
 if r.lease_token is null or r.lease_token is distinct from (p_input->>'leaseToken')::uuid or r.lease_until<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='authorize' then
  if not valid or r.revoked_at is not null then raise exception 'FORBIDDEN';end if;
  return '{}'::jsonb;
 elsif p_operation='finish' then
  if p_input->>'status' is null or p_input->>'status' not in ('accepted','delivered','failed','uncertain','revoked') then raise exception 'INVALID_INPUT';end if;
  if r.provider_reference is not null and p_input->>'providerReference' is not null and r.provider_reference<>p_input->>'providerReference' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  update fmat.photon_replies set
   status=case when p_input->>'status'='revoked' then status when status='accepted' and p_input->>'status'='uncertain' then status else p_input->>'status' end,
   revoked_at=case when p_input->>'status'='revoked' then coalesce(revoked_at,clock_timestamp()) else revoked_at end,
   text=case when p_input->>'status' in ('delivered','failed','revoked') then null else text end,
   provider_reference=coalesce(p_input->>'providerReference',provider_reference),lease_token=null,lease_until=null where id=r.id;
  return '{}'::jsonb;
 end if;
 raise exception 'INVALID_INPUT';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_reply_delivery"(text, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

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

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."photon_replies"
  ADD CONSTRAINT "photon_replies_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.photon_inbox(id);

ALTER TABLE "fmat"."photon_replies"
  ADD CONSTRAINT "photon_replies_project_id_fkey" FOREIGN KEY (project_id) REFERENCES fmat.photon_receivers(project_id);

CREATE INDEX photon_replies_due_idx ON fmat.photon_replies USING btree (project_id, checked_at, created_at)
  WHERE ((revoked_at IS NULL) AND (status = ANY (ARRAY['prepared'::text, 'uncertain'::text, 'accepted'::text])));

REVOKE ALL ON FUNCTION "fmat"."photon_reply_prepare"(uuid, uuid, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."wake_photon_replies"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_photon_reply_delivery"(text, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_reply_delivery"(text, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_reply_delivery"(text, uuid, jsonb) TO "service_role";

SELECT cron.schedule_in_database('fmat-photon-replies', '* * * * *', 'select fmat.wake_photon_replies();', 'postgres', NULL, true);
