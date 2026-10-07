-- One intended receiver per project. Operators fence the old consumer before
-- enabling a replacement; no browser/model operation can change this registry.
create table fmat.photon_receivers (
  project_id uuid primary key,
  receiver_id uuid not null unique,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table fmat.photon_receivers enable row level security;

-- This is transport evidence, not account or conversation authority. Ingress
-- cannot create links, admit hosts, run tools, confirm settings or approve bookings.
create table fmat.photon_inbox (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references fmat.photon_receivers(project_id),
  message_id text not null check(length(message_id) between 1 and 512),
  sender_id text not null check(length(sender_id) between 1 and 512),
  space_id text not null check(length(space_id) between 1 and 512),
  line text not null check(length(line) between 1 and 512),
  text text not null check(length(text) between 1 and 4000),
  occurred_at timestamptz not null,
  received_order bigint generated always as identity unique,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(project_id,message_id)
);
create index photon_inbox_pending_idx on fmat.photon_inbox(project_id,line,space_id,received_order) where processed_at is null;
alter table fmat.photon_inbox enable row level security;

create or replace function public.fmat_photon_ingress(p_project_id uuid,p_receiver_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_receiver fmat.photon_receivers; v_inbox fmat.photon_inbox; v_new_id uuid; v_occurred timestamptz; v_job uuid;
begin
  select * into v_receiver from fmat.photon_receivers where project_id=p_project_id for share;
  if not found or not v_receiver.enabled or v_receiver.receiver_id is distinct from p_receiver_id then
    raise exception 'CONFIGURATION_UNAVAILABLE';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' or
    p_input-array['messageId','senderId','spaceId','line','text','occurredAt']<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array['messageId','senderId','spaceId','line','text','occurredAt']) k
    where jsonb_typeof(p_input->k) is distinct from 'string') then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array['messageId','senderId','spaceId','line']) k
    where length(p_input->>k) not between 1 and 512 or (p_input->>k)~'[[:cntrl:]]') or
    length(p_input->>'text') not between 1 and 4000 or btrim(p_input->>'text')='' then raise exception 'INVALID_INPUT'; end if;
  begin v_occurred:=(p_input->>'occurredAt')::timestamptz;
  exception when others then raise exception 'INVALID_INPUT'; end;
  if not isfinite(v_occurred) then raise exception 'INVALID_INPUT'; end if;

  -- Preserve receipt order within the provider conversation across concurrent
  -- deliveries. Provider timestamps are evidence, not a manufactured sequence.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('photon-ingress',p_project_id,p_input->>'line',p_input->>'spaceId')::text,0));
  insert into fmat.photon_inbox(project_id,message_id,sender_id,space_id,line,text,occurred_at)
    values(p_project_id,p_input->>'messageId',p_input->>'senderId',p_input->>'spaceId',p_input->>'line',p_input->>'text',v_occurred)
    on conflict(project_id,message_id) do nothing returning id into v_new_id;
  select * into strict v_inbox from fmat.photon_inbox where project_id=p_project_id and message_id=p_input->>'messageId';
  if v_inbox.sender_id<>p_input->>'senderId' or v_inbox.space_id<>p_input->>'spaceId' or v_inbox.line<>p_input->>'line'
    or v_inbox.text<>p_input->>'text' or v_inbox.occurred_at<>v_occurred then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_new_id is not null then
    v_job:=fmat.enqueue_job('photon_ingress','photon-ingress:'||v_inbox.id::text,jsonb_build_object('inboxId',v_inbox.id));
  end if;
  return jsonb_build_object('inboxId',v_inbox.id,'duplicate',v_new_id is null);
end;
$$;
revoke all on function public.fmat_photon_ingress(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_photon_ingress(uuid,uuid,jsonb) to service_role;
