SET local check_function_bodies = off;

CREATE SCHEMA "fmat";

CREATE EXTENSION "pg_cron";

CREATE EXTENSION "pgmq";

CREATE TABLE "fmat"."audit_events" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "operation"  text                     NOT NULL,
  "actor"      jsonb                    NOT NULL,
  "subject_id" text,
  "metadata"   jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "audit_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "fmat"."audit_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."idempotency" (
  "actor_scope" text                     NOT NULL,
  "operation"   text                     NOT NULL,
  "key"         text                     NOT NULL,
  "input"       jsonb                    NOT NULL,
  "result"      jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "idempotency_key_check" CHECK (((length(key) >= 1) AND (length(key) <= 200))),
  CONSTRAINT "idempotency_pkey" PRIMARY KEY (actor_scope, operation, key)
);

ALTER TABLE "fmat"."idempotency"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."inbox" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "provider"          text                     NOT NULL,
  "provider_event_id" text                     NOT NULL,
  "payload"           jsonb                    NOT NULL,
  "received_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at"      timestamp with time zone,
  CONSTRAINT "inbox_pkey" PRIMARY KEY (id),
  CONSTRAINT "inbox_provider_provider_event_id_key" UNIQUE (PROVIDER, provider_event_id)
);

ALTER TABLE "fmat"."inbox"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."jobs" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "kind"         text                     NOT NULL,
  "dedupe_key"   text                     NOT NULL,
  "payload"      jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "status"       text                     NOT NULL DEFAULT 'pending'::text,
  "attempts"     integer                  NOT NULL DEFAULT 0,
  "max_attempts" integer                  NOT NULL DEFAULT 5,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "lease_token"  uuid,
  "lease_until"  timestamp with time zone,
  "worker_id"    text,
  "last_error"   text,
  "result"       jsonb,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "jobs_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "jobs_check" CHECK (((status = 'running'::text) = ((lease_token IS NOT NULL) AND (lease_until IS NOT NULL) AND (worker_id IS NOT NULL)))),
  CONSTRAINT "jobs_dedupe_key_key" UNIQUE (dedupe_key),
  CONSTRAINT "jobs_max_attempts_check" CHECK (((max_attempts >= 1) AND (max_attempts <= 20))),
  CONSTRAINT "jobs_pkey" PRIMARY KEY (id),
  CONSTRAINT "jobs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'complete'::text, 'dead'::text])))
);

ALTER TABLE "fmat"."jobs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."outbox" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "dedupe_key"         text                     NOT NULL,
  "audience"           text                     NOT NULL,
  "recipient"          jsonb                    NOT NULL,
  "payload"            jsonb                    NOT NULL,
  "status"             text                     NOT NULL DEFAULT 'pending'::text,
  "provider_reference" text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "outbox_audience_check" CHECK ((audience = ANY (ARRAY['requester'::text, 'host'::text, 'operator'::text]))),
  CONSTRAINT "outbox_dedupe_key_key" UNIQUE (dedupe_key),
  CONSTRAINT "outbox_pkey" PRIMARY KEY (id),
  CONSTRAINT "outbox_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'uncertain'::text, 'failed'::text, 'suppressed'::text])))
);

ALTER TABLE "fmat"."outbox"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."queue_publications" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "job_id"          uuid                     NOT NULL,
  "message_id"      bigint                   NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "acknowledged_at" timestamp with time zone,
  CONSTRAINT "queue_publications_message_id_key" UNIQUE (message_id),
  CONSTRAINT "queue_publications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "fmat"."queue_publications"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.audit (
  p_operation text,
  p_actor     jsonb,
  p_subject   text  DEFAULT NULL::text,
  p_metadata  jsonb DEFAULT '{}'::jsonb
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  insert into fmat.audit_events(operation,actor,subject_id,metadata)
  values (p_operation, p_actor - 'tokenHash', p_subject, p_metadata);
$function$;

CREATE OR REPLACE FUNCTION fmat.authorize_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then
    if p_actor->>'kind' not in ('worker','operator') or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  else
    raise exception 'UNKNOWN_OPERATION';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.dispatch_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  return fmat.foundation_command(p_operation,p_actor,p_input);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.enqueue_job (
  p_kind         text,
  p_dedupe_key   text,
  p_payload      jsonb                    DEFAULT '{}'::jsonb,
  p_available_at timestamp with time zone DEFAULT now(),
  p_max_attempts integer                  DEFAULT 5
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION fmat.foundation_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION fmat.install_runtime()
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  perform pgmq.create('fmat_jobs');
  perform cron.schedule('fmat-job-recovery','* * * * *','select fmat.recover_jobs();');
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.publish_job (
  p_job_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_message_id bigint;
begin
  select pgmq.send('fmat_jobs', jsonb_build_object('jobId',p_job_id)) into v_message_id;
  insert into fmat.queue_publications(job_id,message_id) values(p_job_id,v_message_id);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.recover_jobs()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fmat_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_command"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."queue_publications"
  ADD CONSTRAINT "queue_publications_job_id_fkey" FOREIGN KEY (job_id) REFERENCES fmat.jobs(id);

CREATE INDEX jobs_due_idx ON fmat.jobs USING btree (available_at)
  WHERE (status = 'pending'::text);

CREATE INDEX jobs_lease_idx ON fmat.jobs USING btree (lease_until)
  WHERE (status = 'running'::text);

CREATE INDEX queue_publications_job_idx ON fmat.queue_publications USING btree (job_id, created_at DESC);

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';

COMMENT ON EXTENSION "pgmq" IS 'A lightweight message queue. Like AWS SQS and RSMQ but on Postgres.';

REVOKE ALL ON FUNCTION "fmat"."audit"(text, jsonb, text, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."authorize_command"(text, jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."dispatch_command"(text, jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."enqueue_job"(text, text, jsonb, timestamp WITH time zone, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."foundation_command"(text, jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."install_runtime"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."publish_job"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."recover_jobs"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_command"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_command"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_command"(text, jsonb, jsonb) TO "service_role";
