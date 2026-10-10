-- A native contact share has no provider idempotency or reconciliation handle.
-- This row is the durable work item; dispatching can never become queued again.
create table fmat.photon_contact_shares (
 id uuid primary key default gen_random_uuid(),
 link_id uuid not null unique references fmat.photon_links(id),
 host_id uuid not null references fmat.hosts(id) on delete cascade,
 project_id uuid not null references fmat.photon_receivers(project_id),
 credential jsonb not null,
 phone text not null check(phone~'^\+[1-9][0-9]{7,14}$'),
 line text not null check(length(line)>=1 and length(line)<=512),
 space_id text not null check(space_id='any;-;'||phone),
 status text not null default 'queued' check(status in ('queued','dispatching','accepted','failed','revoked','uncertain')),
 attempts integer not null default 0 check(attempts>=0 and attempts<=3),
 available_at timestamptz not null default clock_timestamp(),
 lease_token uuid,
 lease_until timestamptz,
 dispatched_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((lease_token is null)=(lease_until is null)),
 check((status in ('dispatching','accepted','uncertain'))=(dispatched_at is not null)),
 check(status in ('queued','dispatching') or lease_token is null)
);
create index photon_contact_shares_due_idx on fmat.photon_contact_shares(project_id,available_at,id) where status in ('queued','dispatching');
create index photon_contact_shares_host_idx on fmat.photon_contact_shares(host_id);
alter table fmat.photon_contact_shares enable row level security;

-- Remember every browser retry key, including concurrent clicks with distinct
-- keys, so no key can later be repurposed for a replacement link.
create table fmat.photon_contact_request_keys (
 host_id uuid not null references fmat.hosts(id) on delete cascade,
 request_key uuid not null,
 share_id uuid not null references fmat.photon_contact_shares(id) on delete cascade,
 primary key(host_id,request_key)
);
create index photon_contact_request_keys_share_idx on fmat.photon_contact_request_keys(share_id);
alter table fmat.photon_contact_request_keys enable row level security;

create or replace function fmat.photon_contact_view(p_share fmat.photon_contact_shares)
returns jsonb language sql stable set search_path='' as $$
 select case when p_share.id is null then null else jsonb_build_object('id',p_share.id,'linkId',p_share.link_id,
  'status',case when p_share.status='dispatching' then 'uncertain' else p_share.status end,
  'requestedAt',p_share.created_at) end;
$$;
revoke all on function fmat.photon_contact_view(fmat.photon_contact_shares) from public,anon,authenticated,service_role;

create or replace function public.fmat_photon_contact(p_operation text,p_credential jsonb,p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jsonb; host uuid; l fmat.photon_links; s fmat.photon_contact_shares; prior uuid;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 actor:=fmat.calendar_actor(p_credential);host:=(actor->>'id')::uuid;
 if p_operation not in ('read','request') or p_operation is null or jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_input->'linkId') is distinct from 'string'
  or (p_operation='read' and (p_input-'linkId')<>'{}'::jsonb)
  or (p_operation='request' and ((p_input-'linkId'-'idempotencyKey')<>'{}'::jsonb or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string')) then raise exception 'INVALID_INPUT';end if;
 -- Host authority before receiver/link locks matches existing link commands.
 if p_operation='request' then
  perform 1 from fmat.photon_receivers where project_id=p_project_id and enabled for share;
  if not found then raise exception 'CONFIGURATION_UNAVAILABLE';end if;
 end if;
 select * into l from fmat.photon_links where id=(p_input->>'linkId')::uuid and host_id=host and project_id=p_project_id and revoked_at is null for share;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential); -- deadlines after any lock wait
 select * into s from fmat.photon_contact_shares where link_id=l.id;
 if p_operation='read' then return fmat.photon_contact_view(s);end if;
 select share_id into prior from fmat.photon_contact_request_keys where host_id=host and request_key=(p_input->>'idempotencyKey')::uuid;
 if found and prior is distinct from s.id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 if s.id is null then
  insert into fmat.photon_contact_shares(link_id,host_id,project_id,credential,phone,line,space_id)
   values(l.id,host,l.project_id,p_credential,l.phone,l.line,l.space_id) returning * into s;
  insert into fmat.audit_events(operation,actor,subject_id,metadata)
   values('photon_contact_requested',jsonb_build_object('kind','host','id',host),s.id::text,jsonb_build_object('linkId',l.id));
 end if;
 insert into fmat.photon_contact_request_keys(host_id,request_key,share_id)
  values(host,(p_input->>'idempotencyKey')::uuid,s.id) on conflict(host_id,request_key) do nothing;
 return fmat.photon_contact_view(s);
end;
$$;
revoke all on function public.fmat_photon_contact(text,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_photon_contact(text,jsonb,uuid,jsonb) to service_role;

create or replace function fmat.photon_contact_authorized(p_share fmat.photon_contact_shares)
returns boolean language plpgsql volatile set search_path='' as $$
declare actor jsonb; l fmat.photon_links;
begin
 if p_share.credential->>'kind' is distinct from 'host' or p_share.credential->>'subject' is distinct from p_share.host_id::text then return false;end if;
 actor:=fmat.calendar_actor(p_share.credential);
 perform 1 from fmat.photon_receivers where project_id=p_share.project_id and enabled for share;
 if not found then return false;end if;
 select * into l from fmat.photon_links where id=p_share.link_id for share;
 if not found or l.revoked_at is not null or l.host_id<>p_share.host_id or l.project_id<>p_share.project_id
  or l.phone<>p_share.phone or l.line<>p_share.line or l.space_id<>p_share.space_id then return false;end if;
 perform fmat.calendar_actor(p_share.credential);
 return true;
exception when raise_exception then
 if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED') then return false;end if;
 raise;
end;
$$;
revoke all on function fmat.photon_contact_authorized(fmat.photon_contact_shares) from public,anon,authenticated,service_role;

create or replace function public.fmat_photon_contact_delivery(p_operation text,p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s fmat.photon_contact_shares; valid boolean; outcome text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or p_operation is null or p_operation not in ('claim','dispatch','finish') then raise exception 'INVALID_INPUT';end if;
 if p_operation='claim' then
  if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
  select * into s from fmat.photon_contact_shares where project_id=p_project_id and status in ('queued','dispatching')
   and available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) order by available_at,id limit 1;
  if not found then return jsonb_build_object('action','idle');end if;
 else
  if jsonb_typeof(p_input->'shareId') is distinct from 'string' or jsonb_typeof(p_input->'leaseToken') is distinct from 'string'
   or (p_operation='dispatch' and (p_input-'shareId'-'leaseToken')<>'{}'::jsonb)
   or (p_operation='finish' and ((p_input-'shareId'-'leaseToken'-'status')<>'{}'::jsonb or jsonb_typeof(p_input->'status') is distinct from 'string')) then raise exception 'INVALID_INPUT';end if;
  select * into s from fmat.photon_contact_shares where id=(p_input->>'shareId')::uuid and project_id=p_project_id;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 -- Never lock an intent before waiting on host authority. Finish and uncertain
 -- recovery take only the intent lock and do not acquire authority afterward.
 if s.status='queued' and p_operation in ('claim','dispatch') then valid:=fmat.photon_contact_authorized(s);end if;
 select * into s from fmat.photon_contact_shares where id=s.id for update;
 if p_operation='claim' then
  if s.status not in ('queued','dispatching') or s.available_at>clock_timestamp() or s.lease_until>clock_timestamp() then return jsonb_build_object('action','idle');end if;
  if s.status='dispatching' then outcome:='uncertain';
  elsif not valid then outcome:='revoked';
  elsif s.attempts>=3 then outcome:='failed';
  else
   -- Repeat time-sensitive checks after waiting for the intent lock.
   if not fmat.photon_contact_authorized(s) then outcome:='revoked';end if;
  end if;
  if outcome is not null then
   update fmat.photon_contact_shares set status=outcome,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=s.id;
   insert into fmat.audit_events(operation,actor,subject_id,metadata) values('photon_contact_settled','{"kind":"system"}',s.id::text,jsonb_build_object('status',outcome));
   return jsonb_build_object('action',outcome);
  end if;
  update fmat.photon_contact_shares set attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() where id=s.id returning * into s;
  return jsonb_build_object('action','send','shareId',s.id,'projectId',s.project_id,'leaseToken',s.lease_token,'phone',s.phone,'line',s.line,'spaceId',s.space_id);
 end if;
 if s.lease_token is null or s.lease_token is distinct from (p_input->>'leaseToken')::uuid or s.lease_until<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='dispatch' then
  -- A repeated dispatch acknowledgement must never authorize a second call.
  if s.status<>'queued' then raise exception 'REVISION_CONFLICT';end if;
  if not valid or not fmat.photon_contact_authorized(s) then
   update fmat.photon_contact_shares set status='revoked',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=s.id;
   insert into fmat.audit_events(operation,actor,subject_id,metadata) values('photon_contact_settled','{"kind":"system"}',s.id::text,'{"status":"revoked"}');
   return jsonb_build_object('authorized',false);
  end if;
  update fmat.photon_contact_shares set status='dispatching',dispatched_at=clock_timestamp(),updated_at=clock_timestamp() where id=s.id;
  insert into fmat.audit_events(operation,actor,subject_id,metadata) values('photon_contact_dispatched','{"kind":"system"}',s.id::text,'{}');
  return jsonb_build_object('authorized',true);
 end if;
 outcome:=p_input->>'status';
 if s.status='dispatching' then
  if outcome not in ('accepted','uncertain') then raise exception 'INVALID_INPUT';end if;
 elsif s.status='queued' then
  if outcome not in ('retry','failed','revoked') then raise exception 'INVALID_INPUT';end if;
  if outcome='retry' then outcome:=case when s.attempts>=3 then 'failed' else 'queued' end;end if;
 else raise exception 'REVISION_CONFLICT';end if;
 update fmat.photon_contact_shares set status=outcome,lease_token=null,lease_until=null,available_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() where id=s.id;
 insert into fmat.audit_events(operation,actor,subject_id,metadata) values('photon_contact_settled','{"kind":"system"}',s.id::text,jsonb_build_object('status',outcome));
 return '{}'::jsonb;
end;
$$;
revoke all on function public.fmat_photon_contact_delivery(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_photon_contact_delivery(text,uuid,jsonb) to service_role;

create or replace function fmat.wake_photon_contacts()
returns bigint language plpgsql security definer set search_path='' as $$
declare v_url text;v_secret text;
begin
 if not exists(select 1 from fmat.photon_contact_shares where status in ('queued','dispatching')
  and available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp())) then return null;end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if v_url is null or v_secret is null then return null;end if;
 if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION';end if;
 v_url:=replace(v_url,'/api/internal/conversations/dispatch','/api/internal/photon/contacts');
 return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$$;
revoke all on function fmat.wake_photon_contacts() from public,anon,authenticated,service_role;
select cron.schedule('fmat-photon-contacts','* * * * *','select fmat.wake_photon_contacts();');

-- Keep the existing operational v1 contract unchanged. This is a separate,
-- strictly projected snapshot with no provider route, credentials or raw errors.
create or replace function public.fmat_photon_contact_snapshot(p_sample_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_sample_limit is null or p_sample_limit<0 or p_sample_limit>20 then raise exception 'INVALID_INPUT';end if;
 with categories as (
  select category,ordinal from unnest(array['aged_contact_shares','failed_contact_shares','uncertain_contact_shares']) with ordinality as c(category,ordinal)
 ), observations as materialized (
  select 'aged_contact_shares'::text category,id,created_at since from fmat.photon_contact_shares where status='queued' and created_at<=statement_timestamp()-interval '5 minutes'
  union all select 'failed_contact_shares',id,updated_at from fmat.photon_contact_shares where status='failed'
  union all select 'uncertain_contact_shares',id,dispatched_at from fmat.photon_contact_shares where status in ('dispatching','uncertain')
 ), ranked as (
  select *,row_number() over(partition by category order by since,id) rank from observations
 ), summaries as (
  select category,count(*) total,min(since) oldest,
   coalesce(jsonb_agg(jsonb_build_object('id',id,'since',since) order by since,id) filter(where rank<=p_sample_limit),'[]'::jsonb) samples
  from ranked group by category
 )
 select jsonb_build_object('version',1,'scope','photon_contacts','observedAt',statement_timestamp(),'ageThresholdSeconds',300,'sampleLimit',p_sample_limit,
  'coverage',jsonb_build_object('deviceDelivery','not_observed','contactSaving','not_observed','releaseReadiness','not_assessed'),
  'signals',jsonb_agg(jsonb_build_object('category',c.category,'count',coalesce(s.total,0),'oldestAt',s.oldest,'samples',coalesce(s.samples,'[]'::jsonb)) order by c.ordinal))
 into result from categories c left join summaries s using(category);
 return result;
end;
$$;
revoke all on function public.fmat_photon_contact_snapshot(integer) from public,anon,authenticated;
grant execute on function public.fmat_photon_contact_snapshot(integer) to service_role;
