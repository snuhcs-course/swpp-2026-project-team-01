-- Host suggestions stay private until an explicit authored review applies them.
-- These records are separate from requester extraction/review authority.
create table fmat.host_revision_drafts (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references fmat.requests(id) on delete cascade,
 host_id uuid not null references fmat.hosts(id),
 base_revision integer not null check(base_revision>0),
 input jsonb not null,
 before_details jsonb not null,
 proposed_details jsonb not null,
 idempotency_key text not null,
 status text not null default 'pending' check(status in ('pending','applied','dismissed','superseded')),
 decision_key uuid,
 result_revision integer,
 created_at timestamptz not null default clock_timestamp(),
 decided_at timestamptz,
 unique(request_id,host_id,idempotency_key)
);
create unique index host_revision_drafts_pending_idx on fmat.host_revision_drafts(request_id) where status='pending';
create index host_revision_drafts_host_idx on fmat.host_revision_drafts(host_id);
alter table fmat.host_revision_drafts enable row level security;
revoke all on fmat.host_revision_drafts from public,anon,authenticated,service_role;

create or replace function fmat.host_revision_view(p_draft fmat.host_revision_drafts)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p_draft.id,'baseRevision',p_draft.base_revision,'patch',p_draft.input->'patch',
 'details',p_draft.proposed_details,'clarifications',p_draft.input->'clarifications','status',p_draft.status,'resultRevision',p_draft.result_revision);
$$;
revoke all on function fmat.host_revision_view(fmat.host_revision_drafts) from public,anon,authenticated,service_role;

create or replace function fmat.propose_host_revision(p_actor jsonb,p_request uuid,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare r fmat.requests; draft fmat.host_revision_drafts; details jsonb;
begin
 if p_actor->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 r:=fmat.require_request(p_actor,p_request);
 if r.status in ('booking','booked','withdrawn','declined','expired') or r.expires_at<=clock_timestamp()
  or r.token_expires_at<=clock_timestamp() or r.token_revoked_at is not null then raise exception 'REQUEST_CLOSED';end if;
 if jsonb_typeof(p_input) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('patch','expectedRevision','clarifications','idempotencyKey'))
  or jsonb_typeof(p_input->'patch') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_input->'patch') k where k not in ('purpose','durationMinutes','timezone','windows','mode','location'))
  or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^[0-9]+$'
  or jsonb_typeof(p_input->'clarifications') is distinct from 'array' or jsonb_array_length(p_input->'clarifications')>10
  or exists(select 1 from jsonb_array_elements(p_input->'clarifications') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 500)
  or (p_input->'patch'='{}'::jsonb and p_input->'clarifications'='[]'::jsonb)
  or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string' or length(p_input->>'idempotencyKey') not between 1 and 200
  then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from jsonb_each(p_input->'patch') e where
  (key in ('purpose','timezone','mode','location') and jsonb_typeof(value)<>'string')
  or (key='durationMinutes' and value<>'null'::jsonb and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$')))
  then raise exception 'INVALID_INPUT';end if;
 select * into draft from fmat.host_revision_drafts where request_id=r.id and host_id=r.host_id and idempotency_key=p_input->>'idempotencyKey';
 if found then
  if draft.input is distinct from p_input-'idempotencyKey' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('revisionDraft',fmat.host_revision_view(draft));
 end if;
 if (p_input->>'expectedRevision')::integer<>r.revision then raise exception 'REVISION_CONFLICT';end if;
 details:=fmat.normalize_details(r.details||(p_input->'patch'));
 perform fmat.validate_request_review_windows(details);
 update fmat.host_revision_drafts set status='superseded',decided_at=clock_timestamp() where request_id=r.id and status='pending';
 insert into fmat.host_revision_drafts(request_id,host_id,base_revision,input,before_details,proposed_details,idempotency_key)
 values(r.id,r.host_id,r.revision,p_input-'idempotencyKey',r.details,details,p_input->>'idempotencyKey') returning * into draft;
 perform fmat.audit('host_revision_proposed',p_actor,r.id::text);
 return jsonb_build_object('revisionDraft',fmat.host_revision_view(draft));
end;
$$;
revoke all on function fmat.propose_host_revision(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
