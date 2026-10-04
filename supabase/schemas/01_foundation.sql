-- Private domain state. The sole Data API entry point is the service-only command RPC.
create schema if not exists fmat;
revoke all on schema fmat from public, anon, authenticated, service_role;
alter default privileges in schema fmat revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema fmat revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema fmat revoke execute on functions from public, anon, authenticated, service_role;

create extension if not exists pgmq;
create extension if not exists pg_cron;

create table fmat.audit_events (
  id bigint generated always as identity primary key,
  operation text not null,
  actor jsonb not null,
  subject_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table fmat.audit_events enable row level security;

create table fmat.idempotency (
  actor_scope text not null,
  operation text not null,
  key text not null check (length(key) between 1 and 200),
  input jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_scope, operation, key)
);
alter table fmat.idempotency enable row level security;

create table fmat.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','complete','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  worker_id text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'running') = (lease_token is not null and lease_until is not null and worker_id is not null))
);
create index jobs_due_idx on fmat.jobs (available_at) where status = 'pending';
create index jobs_lease_idx on fmat.jobs (lease_until) where status = 'running';
alter table fmat.jobs enable row level security;

create table fmat.queue_publications (
  id bigint generated always as identity primary key,
  job_id uuid not null references fmat.jobs(id),
  message_id bigint not null unique,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index queue_publications_job_idx on fmat.queue_publications (job_id, created_at desc);
alter table fmat.queue_publications enable row level security;

create table fmat.inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);
alter table fmat.inbox enable row level security;

create table fmat.outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  audience text not null check (audience in ('requester','host','operator')),
  recipient jsonb not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','uncertain','failed','suppressed')),
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table fmat.outbox enable row level security;

create or replace function fmat.audit(p_operation text, p_actor jsonb, p_subject text default null, p_metadata jsonb default '{}'::jsonb)
returns void language sql set search_path = '' as $$
  insert into fmat.audit_events(operation,actor,subject_id,metadata)
  values (p_operation, p_actor - 'tokenHash', p_subject, p_metadata);
$$;

create or replace function fmat.publish_job(p_job_id uuid)
returns void language plpgsql set search_path = '' as $$
declare v_message_id bigint;
begin
  select pgmq.send('fmat_jobs', jsonb_build_object('jobId',p_job_id)) into v_message_id;
  insert into fmat.queue_publications(job_id,message_id) values(p_job_id,v_message_id);
end;
$$;

create or replace function fmat.enqueue_job(p_kind text, p_dedupe_key text, p_payload jsonb default '{}'::jsonb, p_available_at timestamptz default now(), p_max_attempts integer default 5)
returns uuid language plpgsql set search_path = '' as $$
declare v_job fmat.jobs; v_new_id uuid;
begin
  if p_kind is null or length(p_kind) not between 1 and 100 or p_dedupe_key is null or length(p_dedupe_key) not between 1 and 300 then
    raise exception 'INVALID_INPUT';
  end if;
  insert into fmat.jobs(kind,dedupe_key,payload,available_at,max_attempts)
  values(p_kind,p_dedupe_key,p_payload,p_available_at,p_max_attempts)
  on conflict(dedupe_key) do nothing returning id into v_new_id;
  if v_new_id is not null then
    perform fmat.publish_job(v_new_id);
    return v_new_id;
  end if;
  select * into strict v_job from fmat.jobs where dedupe_key = p_dedupe_key;
  if v_job.kind <> p_kind or v_job.payload <> p_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return v_job.id;
end;
$$;

-- Recover missed queue wake-ups without releasing application reservations or asserting
-- that an expired worker did not reach an external provider.
create or replace function fmat.recover_jobs()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_job fmat.jobs; v_count integer := 0;
begin
  for v_job in select j.* from fmat.jobs j
    where ((j.status = 'pending' and j.available_at <= now()) or (j.status = 'running' and j.lease_until <= now()))
      and not exists(select 1 from fmat.queue_publications p where p.job_id=j.id and p.acknowledged_at is null and p.created_at > now()-interval '2 minutes')
    order by j.available_at limit 100 for update of j skip locked
  loop
    perform fmat.publish_job(v_job.id);
    v_count := v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Parent migration calls this after pg-delta creates functions. Extension queue/Cron
-- records are runtime data and cannot be inferred from the declarative schema diff.
create or replace function fmat.install_runtime()
returns void language plpgsql set search_path = '' as $$
begin
  perform pgmq.create('fmat_jobs');
  perform cron.schedule('fmat-job-recovery','* * * * *','select fmat.recover_jobs();');
end;
$$;

create or replace function fmat.foundation_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare v_job fmat.jobs; v_jobs jsonb := '[]'::jsonb; v_message record;
  v_limit integer; v_worker text; v_recovery boolean; v_retry_at timestamptz;
begin
  if p_actor->>'kind' not in ('worker','operator') or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  case p_operation
  when 'foundation_ping' then
    perform fmat.audit(p_operation,p_actor,null,jsonb_build_object('label',p_input->>'label'));
    return jsonb_build_object('jobId',fmat.enqueue_job('ping','foundation:'||(p_actor->>'id')||':'||(p_input->>'idempotencyKey'),jsonb_build_object('label',p_input->>'label')));
  when 'jobs_enqueue' then
    return jsonb_build_object('jobId',fmat.enqueue_job(p_input->>'kind',p_input->>'dedupeKey',coalesce(p_input->'payload','{}'),coalesce((p_input->>'availableAt')::timestamptz,now()),coalesce((p_input->>'maxAttempts')::integer,5)));
  when 'jobs_recover' then
    return jsonb_build_object('published',fmat.recover_jobs());
  when 'jobs_claim' then
    v_worker := p_input->>'workerId';
    if v_worker is distinct from p_actor->>'id' then raise exception 'FORBIDDEN'; end if;
    v_limit := least(greatest(coalesce((p_input->>'limit')::integer,5),1),10);
    -- Read queue messages to hide them while claiming their authoritative job rows.
    -- Due-row fallback handles a lost or prematurely archived wake-up.
    for v_message in select * from pgmq.read('fmat_jobs',90,v_limit*2) loop
      perform pgmq.archive('fmat_jobs',v_message.msg_id);
      update fmat.queue_publications set acknowledged_at=now() where message_id=v_message.msg_id;
    end loop;
    for v_job in select * from fmat.jobs
      where ((status='pending' and available_at <= now()) or (status='running' and lease_until <= now()))
      order by available_at,created_at limit v_limit for update skip locked
    loop
      v_recovery := v_job.status='running';
      if v_job.attempts >= v_job.max_attempts then
        update fmat.jobs set status='dead',lease_token=null,lease_until=null,worker_id=null,last_error='RETRY_EXHAUSTED',updated_at=now() where id=v_job.id;
        perform fmat.audit('job_exhausted',p_actor,v_job.id::text);
        continue;
      end if;
      update fmat.jobs set status='running',attempts=attempts+1,worker_id=v_worker,
        lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now()
        where id=v_job.id returning * into v_job;
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object('id',v_job.id,'kind',v_job.kind,'payload',v_job.payload,'leaseToken',v_job.lease_token,'attempts',v_job.attempts,'recovery',v_recovery));
    end loop;
    return jsonb_build_object('jobs',v_jobs);
  when 'jobs_complete','jobs_fail' then
    select * into v_job from fmat.jobs where id=(p_input->>'jobId')::uuid for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_job.status <> 'running' or v_job.lease_token is distinct from (p_input->>'leaseToken')::uuid or v_job.worker_id is distinct from p_actor->>'id' or v_job.lease_until <= now() then raise exception 'LEASE_LOST'; end if;
    if p_operation='jobs_complete' then
      update fmat.jobs set status='complete',result=p_input->'result',lease_token=null,lease_until=null,worker_id=null,updated_at=now() where id=v_job.id;
    else
      v_retry_at := coalesce((p_input->>'retryAt')::timestamptz,now()+make_interval(secs=>least(3600,(5*power(2,v_job.attempts))::integer)));
      v_retry_at := greatest(now()+interval '1 second',least(v_retry_at,now()+interval '1 hour'));
      update fmat.jobs set status=case when attempts>=max_attempts then 'dead' else 'pending' end,
        available_at=v_retry_at,last_error=left(coalesce(p_input->>'errorCode','WORKER_FAILED'),100),
        lease_token=null,lease_until=null,worker_id=null,updated_at=now() where id=v_job.id;
      if v_job.attempts < v_job.max_attempts then perform fmat.publish_job(v_job.id); end if;
    end if;
    perform fmat.audit(p_operation,p_actor,v_job.id::text);
    return jsonb_build_object('ok',true);
  else raise exception 'UNKNOWN_OPERATION';
  end case;
end;
$$;

-- Later phase files replace this dispatcher, retaining the foundation branch.
create or replace function fmat.dispatch_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
  return fmat.foundation_command(p_operation,p_actor,p_input);
end;
$$;

-- Every phase extends this guard alongside its dispatcher. It runs even for an
-- idempotent replay so revoked ownership cannot expose an earlier saved result.
create or replace function fmat.authorize_command(p_operation text,p_actor jsonb,p_input jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then
    if p_actor->>'kind' not in ('worker','operator') or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  else
    raise exception 'UNKNOWN_OPERATION';
  end if;
end;
$$;

create or replace function public.fmat_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_scope text; v_key text; v_record fmat.idempotency; v_result jsonb;
begin
  if jsonb_typeof(p_actor) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object'
    or p_actor->>'kind' is null or p_actor->>'kind' not in ('host','guest','worker','operator','public') then raise exception 'INVALID_INPUT'; end if;
  perform fmat.authorize_command(p_operation,p_actor,p_input);
  -- Internal lease transitions deliberately use fencing rather than replaying cached results.
  if p_operation like 'jobs_%' then return fmat.dispatch_command(p_operation,p_actor,p_input); end if;
  if p_operation in ('host_public','setup_read','calendar_read','requests_list','request_read') then
    return fmat.dispatch_command(p_operation,p_actor,p_input);
  end if;
  v_key := p_input->>'idempotencyKey';
  if v_key is null or length(v_key) not between 1 and 200 then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  v_scope := coalesce(p_actor->>'kind','')||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash',p_actor->>'email','public');
  insert into fmat.idempotency(actor_scope,operation,key,input) values(v_scope,p_operation,v_key,p_input) on conflict do nothing;
  select * into strict v_record from fmat.idempotency where actor_scope=v_scope and operation=p_operation and key=v_key for update;
  if v_record.input <> p_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_record.result is not null then return v_record.result; end if;
  v_result := fmat.dispatch_command(p_operation,p_actor,p_input);
  update fmat.idempotency set result=v_result where actor_scope=v_scope and operation=p_operation and key=v_key;
  return v_result;
end;
$$;
revoke all on all tables in schema fmat from public,anon,authenticated,service_role;
revoke all on all sequences in schema fmat from public,anon,authenticated,service_role;
revoke execute on all functions in schema fmat from public,anon,authenticated,service_role;
revoke execute on function public.fmat_command(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_command(text,jsonb,jsonb) to service_role;
