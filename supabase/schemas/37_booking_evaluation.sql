-- Each pre-dispatch check belongs to one saved attempt and one current lease.
create table fmat.booking_checks (
 attempt_id uuid primary key references fmat.booking_attempts(id) on delete cascade,
 job_id uuid not null references fmat.jobs(id),
 lease_token uuid not null,
 check_id uuid not null,
 destination_checked_at timestamptz
);
create index booking_checks_job_idx on fmat.booking_checks(job_id);
alter table fmat.booking_checks enable row level security;
revoke all on fmat.booking_checks from public,anon,authenticated,service_role;

create or replace function public.fmat_booking_evaluation(p_operation text,p_lease jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_operation is null or p_operation not in ('start','check','refresh','failure','success','evidence_save','evidence_read','destination_checked')
  or jsonb_typeof(p_lease) is distinct from 'object' or not(p_lease ?& array['workerId','jobId','leaseToken'])
  or exists(select 1 from jsonb_object_keys(p_lease) k where k not in ('workerId','jobId','leaseToken'))
  or length(coalesce(p_lease->>'workerId','')) not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
 return fmat.evaluate_availability(p_operation,null,p_input,p_lease);
end;
$$;
revoke all on function public.fmat_booking_evaluation(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_booking_evaluation(text,jsonb,jsonb) to service_role;
