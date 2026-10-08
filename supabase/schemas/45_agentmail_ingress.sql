-- Operators must fence old consumers and verify downstream routing before enabling.
create table fmat.agentmail_receivers (
 inbox_id text primary key check(length(inbox_id) between 1 and 512),
 receiver_id uuid not null unique,
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table fmat.agentmail_receivers enable row level security;
create table fmat.agentmail_inbox (
 id uuid primary key default gen_random_uuid(),
 inbox_id text not null references fmat.agentmail_receivers(inbox_id),
 receiver_id uuid not null,
 event_id text not null,
 message_id text not null,
 thread_id text not null,
 occurred_at timestamptz not null,
 payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
 received_order bigint generated always as identity unique,
 received_at timestamptz not null default now(),
 processed_at timestamptz,
 unique(inbox_id,event_id),
 unique(inbox_id,message_id)
);
alter table fmat.agentmail_inbox enable row level security;
create index agentmail_inbox_pending_idx on fmat.agentmail_inbox(inbox_id,thread_id,received_order) where processed_at is null;
create table fmat.agentmail_deliveries (
 inbox_id text not null references fmat.agentmail_receivers(inbox_id),
 delivery_id text not null,
 receipt_id uuid not null references fmat.agentmail_inbox(id),
 primary key(inbox_id,delivery_id)
);
alter table fmat.agentmail_deliveries enable row level security;

create or replace function public.fmat_agentmail_ingress(p_receiver_id uuid,p_inbox_id text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare registration fmat.agentmail_receivers; receipt fmat.agentmail_inbox; delivery uuid; occurred timestamptz; fresh boolean:=false;
begin
 select * into registration from fmat.agentmail_receivers where inbox_id=p_inbox_id for share;
 if not found or not registration.enabled or registration.receiver_id is distinct from p_receiver_id then raise exception 'CONFIGURATION_UNAVAILABLE';end if;
 -- Null means an authenticated unsupported type: check the current fence before acknowledgment.
 if p_input is null then return jsonb_build_object('ignored',true);end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input-array['deliveryId','eventId','inboxId','threadId','messageId','occurredAt','payloadHash']<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from unnest(array['deliveryId','eventId','inboxId','threadId','messageId','occurredAt','payloadHash']) k where jsonb_typeof(p_input->k) is distinct from 'string') then raise exception 'INVALID_INPUT';end if;
 if p_input->>'inboxId' is distinct from p_inbox_id or exists(select 1 from unnest(array['deliveryId','eventId','inboxId','threadId','messageId']) k where length(p_input->>k) not between 1 and 512 or (p_input->>k)~'[[:space:][:cntrl:]]') or (p_input->>'payloadHash') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT';end if;
 begin occurred:=(p_input->>'occurredAt')::timestamptz;exception when others then raise exception 'INVALID_INPUT';end;
 if not isfinite(occurred) then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('agentmail-ingress',p_inbox_id)::text,0));
 select * into receipt from fmat.agentmail_inbox where inbox_id=p_inbox_id and message_id=p_input->>'messageId';
 if found then
  if receipt.event_id<>p_input->>'eventId' or receipt.thread_id<>p_input->>'threadId' or receipt.occurred_at<>occurred or receipt.payload_hash<>p_input->>'payloadHash' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 else
  if exists(select 1 from fmat.agentmail_inbox where inbox_id=p_inbox_id and event_id=p_input->>'eventId') then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  insert into fmat.agentmail_inbox(inbox_id,receiver_id,event_id,message_id,thread_id,occurred_at,payload_hash)
   values(p_inbox_id,p_receiver_id,p_input->>'eventId',p_input->>'messageId',p_input->>'threadId',occurred,p_input->>'payloadHash') returning * into receipt;
  fresh:=true;
 end if;
 select receipt_id into delivery from fmat.agentmail_deliveries where inbox_id=p_inbox_id and delivery_id=p_input->>'deliveryId';
 if found and delivery<>receipt.id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 insert into fmat.agentmail_deliveries(inbox_id,delivery_id,receipt_id) values(p_inbox_id,p_input->>'deliveryId',receipt.id) on conflict do nothing;
 if fresh then perform fmat.enqueue_job('agentmail_ingress','agentmail-ingress:'||receipt.id::text,jsonb_build_object('receiptId',receipt.id));end if;
 return jsonb_build_object('receiptId',receipt.id,'duplicate',not fresh);
end;
$$;
revoke all on function public.fmat_agentmail_ingress(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_agentmail_ingress(uuid,text,jsonb) to service_role;
