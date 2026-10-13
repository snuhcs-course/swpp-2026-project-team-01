-- Durable dispatch evidence, separate from human approval and provider success.
create table fmat.booking_dispatches (
 attempt_id uuid primary key references fmat.booking_attempts(id),
 job_id uuid not null references fmat.jobs(id),
 lease_token uuid not null,
 evaluation_id uuid not null references fmat.candidate_evaluations(id),
 check_id uuid not null,
 dispatched_at timestamptz not null default clock_timestamp()
);
create index booking_dispatches_job_idx on fmat.booking_dispatches(job_id);
create index booking_dispatches_evaluation_idx on fmat.booking_dispatches(evaluation_id);
alter table fmat.booking_dispatches enable row level security;
revoke all on fmat.booking_dispatches from public,anon,authenticated,service_role;
create trigger booking_dispatches_immutable before update on fmat.booking_dispatches for each row execute function fmat.reject_candidate_evaluation_update();

create or replace function public.fmat_booking_dispatch(p_lease jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j fmat.jobs; r fmat.requests; a fmat.booking_attempts; actor jsonb;
begin
 if jsonb_typeof(p_lease) is distinct from 'object' or not(p_lease ?& array['workerId','jobId','leaseToken'])
  or exists(select 1 from jsonb_object_keys(p_lease) k where k not in ('workerId','jobId','leaseToken'))
  or length(coalesce(p_lease->>'workerId','')) not between 1 and 200
  or jsonb_typeof(p_input) is distinct from 'object' or not(p_input ?& array['requestId','revision','checkId','basis','evaluationId'])
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','checkId','basis','evaluationId'))
  then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','worker','id',p_lease->>'workerId');
 j:=fmat.require_job_lease(actor,(p_lease->>'jobId')::uuid,(p_lease->>'leaseToken')::uuid);
 if j.kind<>'booking' or j.payload->>'requestId' is distinct from p_input->>'requestId' then raise exception 'FORBIDDEN';end if;
 select * into r from fmat.requests where id=(j.payload->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 -- The request lock serializes attempt transitions. A replay never grants a
 -- second insertion, even if the first positive response was lost.
 select * into a from fmat.booking_attempts where id=(j.payload->>'attemptId')::uuid and request_id=r.id;
 if not found then raise exception 'NOT_FOUND';end if;
 perform fmat.require_job_lease(actor,j.id,j.lease_token);
 if a.phase<>'prepared' then return jsonb_build_object('dispatched',false);end if;
 return fmat.evaluate_availability('booking_dispatch',null,p_input,p_lease);
end;
$$;
revoke all on function public.fmat_booking_dispatch(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_booking_dispatch(jsonb,jsonb) to service_role;
