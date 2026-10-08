SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION fmat.wake_requester_email_replies()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare url text; secret text;
begin
 if not exists(select 1 from fmat.requester_email_replies reply join fmat.agentmail_receivers receiver
  on receiver.inbox_id=reply.inbox_id and receiver.receiver_id=reply.receiver_id and receiver.enabled
  join fmat.agentmail_inbox incoming on incoming.id=reply.receipt_id
  where reply.suppressed_at is null and reply.status in ('prepared','uncertain')
   and (reply.first_attempt_at is null or reply.first_attempt_at>clock_timestamp()-interval '23 hours')
   and (reply.lease_until is null or reply.lease_until<=clock_timestamp())
   and (reply.checked_at is null or reply.checked_at<=clock_timestamp()-interval '30 seconds')
   and not exists(select 1 from fmat.requester_email_replies prior join fmat.agentmail_inbox pi on pi.id=prior.receipt_id
    where prior.link_id=reply.link_id and pi.received_order<incoming.received_order and prior.suppressed_at is null and prior.status in ('prepared','uncertain'))) then return null;end if;
 select decrypted_secret into url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if url is null or secret is null then return null;end if;
 if url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 return net.http_post(url:=replace(url,'/api/internal/conversations/dispatch','/api/internal/agentmail/replies'),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_requester_email_reply_delivery (
  p_operation   text,
  p_receiver_id uuid,
  p_inbox_id    text,
  p_input       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r fmat.requester_email_replies; m fmat.runtime_messages; valid boolean:=true;
begin
 if p_operation is null or p_operation not in ('claim','authorize','finish') or p_receiver_id is null or coalesce(p_inbox_id,'')=''
  or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation='claim' then
  if p_input<>'{}' then raise exception 'INVALID_INPUT';end if;
  select pending.* into r from fmat.requester_email_replies pending join fmat.agentmail_inbox incoming on incoming.id=pending.receipt_id
  where pending.receiver_id=p_receiver_id and pending.inbox_id=p_inbox_id and pending.suppressed_at is null and pending.status in ('prepared','uncertain')
   and (pending.first_attempt_at is null or pending.first_attempt_at>clock_timestamp()-interval '23 hours')
   and (pending.lease_until is null or pending.lease_until<=clock_timestamp())
   and (pending.checked_at is null or pending.checked_at<=clock_timestamp()-interval '30 seconds')
   and not exists(select 1 from fmat.requester_email_replies prior join fmat.agentmail_inbox pi on pi.id=prior.receipt_id
    where prior.link_id=pending.link_id and pi.received_order<incoming.received_order and prior.suppressed_at is null and prior.status in ('prepared','uncertain'))
  order by coalesce(pending.checked_at,pending.created_at),incoming.received_order limit 1;
  if not found then return jsonb_build_object('action','idle');end if;
 else
  if p_input-array['replyId','leaseToken','status','messageId','threadId']<>'{}'
   or (p_operation='authorize' and p_input-array['replyId','leaseToken']<>'{}') then raise exception 'INVALID_INPUT';end if;
  select * into r from fmat.requester_email_replies where id=(p_input->>'replyId')::uuid and receiver_id=p_receiver_id and inbox_id=p_inbox_id;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 select * into strict m from fmat.runtime_messages where id=r.runtime_message_id;
 if p_operation in ('claim','authorize') then
  -- Authority locks precede reply locking, as in settlement. Never hold a
  -- reply row while waiting for a request whose settlement needs that row.
  begin perform public.fmat_conversation_check(m.grant_id,m.conversation_id);
  exception when raise_exception then
   if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED','REQUEST_CLOSED','REQUEST_EXPIRED') then valid:=false;else raise;end if;
  end;
 end if;
 select * into r from fmat.requester_email_replies where id=r.id for update;
 if p_operation='claim' then
  if r.suppressed_at is not null or r.status not in ('prepared','uncertain') or r.lease_until>clock_timestamp()
   or r.checked_at>clock_timestamp()-interval '30 seconds' or r.first_attempt_at<=clock_timestamp()-interval '23 hours' then return jsonb_build_object('action','idle');end if;
 else
  if r.lease_token is null or r.lease_token is distinct from (p_input->>'leaseToken')::uuid or r.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 end if;
 if p_operation in ('claim','authorize') and valid then
  -- Repeat wall-clock authority checks after any reply-row lock wait.
  begin perform public.fmat_conversation_check(m.grant_id,m.conversation_id);
  exception when raise_exception then
   if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED','REQUEST_CLOSED','REQUEST_EXPIRED') then valid:=false;else raise;end if;
  end;
  if not exists(select 1 from fmat.agentmail_inbox i join fmat.requester_email_links l on l.id=i.link_id
   where i.id=r.receipt_id and i.runtime_message_id=m.id and i.processing_outcome='accepted' and m.status in ('completed','failed')
    and r.link_id=l.id and r.inbox_id=i.inbox_id and r.receiver_id=i.receiver_id and r.thread_id=i.thread_id
    and r.parent_message_id=i.message_id and r.recipient=l.email) then valid:=false;end if;
 end if;
 if p_operation='claim' then
  if not valid then
   update fmat.requester_email_replies set suppressed_at=clock_timestamp(),text=null,lease_token=null,lease_until=null where id=r.id;
   return jsonb_build_object('action','suppressed');
  end if;
  update fmat.requester_email_replies set status='uncertain',first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),
   lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',checked_at=clock_timestamp() where id=r.id returning * into r;
  return jsonb_build_object('action','send','receiverId',r.receiver_id,'leaseToken',r.lease_token,'reply',jsonb_build_object(
   'id',r.id,'inboxId',r.inbox_id,'threadId',r.thread_id,'parentMessageId',r.parent_message_id,'recipient',r.recipient,'text',r.text,'firstAttemptAt',r.first_attempt_at));
 elsif p_operation='authorize' then
  if not valid or r.suppressed_at is not null then raise exception 'FORBIDDEN';end if;
  if r.status<>'uncertain' or r.first_attempt_at<=clock_timestamp()-interval '23 hours' or r.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
  return '{}'::jsonb;
 end if;
 if coalesce(p_input->>'status','') not in ('accepted','uncertain','suppressed') then raise exception 'INVALID_INPUT';end if;
 if r.status<>'uncertain' or r.suppressed_at is not null then raise exception 'LEASE_LOST';end if;
 if p_input->>'status'='accepted' then
  if jsonb_typeof(p_input->'messageId') is distinct from 'string' or length(p_input->>'messageId') not between 1 and 512
   or p_input->>'messageId' ~ '[[:space:][:cntrl:]]' or p_input->>'messageId' in ('.','..')
   or p_input->>'messageId'=r.parent_message_id or p_input->>'threadId' is distinct from r.thread_id then raise exception 'INVALID_INPUT';end if;
  if r.provider_message_id is not null and r.provider_message_id<>p_input->>'messageId' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  if exists(select 1 from fmat.requester_email_replies where inbox_id=r.inbox_id and provider_message_id=p_input->>'messageId' and id<>r.id) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 elsif p_input->>'messageId' is not null or p_input->>'threadId' is not null then raise exception 'INVALID_INPUT';end if;
 update fmat.requester_email_replies set status=case when p_input->>'status'='accepted' then 'accepted' else status end,
  provider_message_id=case when p_input->>'status'='accepted' then p_input->>'messageId' else provider_message_id end,
  accepted_at=case when p_input->>'status'='accepted' then clock_timestamp() else accepted_at end,
  suppressed_at=case when p_input->>'status'='suppressed' then clock_timestamp() else suppressed_at end,
  text=case when p_input->>'status'='suppressed' then null else text end,lease_token=null,lease_until=null where id=r.id;
 -- A unique-provider-identity wait can outlive the lease during the UPDATE.
 -- Reject the whole transaction if that happened, preserving the old state.
 if r.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST';end if;
 return '{}'::jsonb;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_requester_email_reply_delivery"(text, uuid, text, jsonb) FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "fmat"."wake_requester_email_replies"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_requester_email_reply_delivery"(text, uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_email_reply_delivery"(text, uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_requester_email_reply_delivery"(text, uuid, text, jsonb) TO "service_role";

SELECT cron.schedule_in_database('fmat-requester-email-replies', '* * * * *', 'select fmat.wake_requester_email_replies();', 'postgres', NULL, true);
