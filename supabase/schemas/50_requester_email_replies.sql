-- One immutable private answer per authorized input. This ledger is not a
-- transcript and never grants recipient authority by itself.
create table fmat.requester_email_replies (
 id uuid primary key default gen_random_uuid(),
 receipt_id uuid not null unique references fmat.agentmail_inbox(id),
 runtime_message_id uuid not null unique references fmat.runtime_messages(id),
 link_id uuid not null references fmat.requester_email_links(id),
 inbox_id text not null references fmat.agentmail_receivers(inbox_id),
 receiver_id uuid not null,
 thread_id text not null check(length(thread_id) between 1 and 512),
 parent_message_id text not null check(length(parent_message_id) between 1 and 512),
 recipient text not null check(length(recipient) between 1 and 320),
 text text check(length(text) between 1 and 10000),
 status text not null default 'prepared' check(status in ('prepared','uncertain','accepted')),
 provider_message_id text check(length(provider_message_id) between 1 and 512),
 first_attempt_at timestamptz,
 accepted_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 checked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 suppressed_at timestamptz,
 check((lease_token is null)=(lease_until is null)),
 check(text is not null or suppressed_at is not null),
 check(status='prepared' or first_attempt_at is not null),
 check(status<>'accepted' or (provider_message_id is not null and accepted_at is not null))
);
create index requester_email_replies_link_idx on fmat.requester_email_replies(link_id);
create unique index requester_email_replies_provider_idx on fmat.requester_email_replies(inbox_id,provider_message_id) where provider_message_id is not null;
create index requester_email_replies_due_idx on fmat.requester_email_replies(receiver_id,checked_at,created_at) where suppressed_at is null and status in ('prepared','uncertain');
alter table fmat.requester_email_replies enable row level security;
revoke all on fmat.requester_email_replies from public,anon,authenticated,service_role;

create or replace function fmat.requester_email_reply_prepare(p_grant uuid,p_scope uuid,p_input jsonb)
returns void language plpgsql set search_path='' as $$
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
$$;
revoke all on function fmat.requester_email_reply_prepare(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
