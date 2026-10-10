-- A completed private evaluation batch is not an offer, proposal or approval.
create table fmat.private_review_checks (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references fmat.requests(id) on delete cascade,
 check_id uuid not null,
 request_revision integer not null check(request_revision>0),
 context_basis text not null check(context_basis ~ '^[a-f0-9]{64}$'),
 evaluation_ids uuid[] not null check(cardinality(evaluation_ids)<=12),
 truncated boolean not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,check_id)
);
create index private_review_checks_request_idx on fmat.private_review_checks(request_id,created_at desc,id desc);
alter table fmat.private_review_checks enable row level security;
revoke all on fmat.private_review_checks from public,anon,authenticated;
create trigger private_review_checks_immutable before update on fmat.private_review_checks for each row execute function fmat.reject_candidate_evaluation_update();

create or replace function public.fmat_private_review(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; h fmat.hosts; actor jsonb; context text; checked fmat.private_review_checks; current boolean:=false; reconnect boolean:=false; expiry timestamptz; ids uuid[];
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_operation is null or p_operation not in ('read','complete') then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 if r.status in ('booking','booked','withdrawn','declined','expired') or r.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND';end if;
 select * into strict h from fmat.hosts where id=r.host_id;
 begin context:=public.fmat_availability_evaluation('current_context',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision))->>'travelBasis';
 exception when raise_exception then if p_operation='read' and sqlerrm='RECONNECT_REQUIRED' then reconnect:=true;else raise;end if;end;
 if p_operation='complete' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','checkId','basis','truncated')) or jsonb_typeof(p_input->'truncated') is distinct from 'boolean' then raise exception 'INVALID_INPUT';end if;
  perform public.fmat_availability_evaluation('check',p_credential,p_input);
  if r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then raise exception 'RECONNECT_REQUIRED';end if;
  if (select count(*) from fmat.candidate_evaluations where request_id=r.id and check_id=r.availability_check_id)>12 then raise exception 'INVALID_INPUT';end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from fmat.candidate_evaluations where request_id=r.id and check_id=r.availability_check_id;
  select least(r.availability_check_started_at+interval '5 minutes',coalesce(min(expires_at),r.expires_at)) into expiry from fmat.candidate_evaluations where request_id=r.id and check_id=r.availability_check_id;
  if expiry<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
  select * into checked from fmat.private_review_checks where request_id=r.id and check_id=r.availability_check_id;
  if found then
   if checked.request_revision<>r.revision or checked.context_basis<>context or checked.evaluation_ids<>ids or checked.truncated<>(p_input->>'truncated')::boolean then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  else
   insert into fmat.private_review_checks(request_id,check_id,request_revision,context_basis,evaluation_ids,truncated,expires_at)
   values(r.id,r.availability_check_id,r.revision,context,ids,(p_input->>'truncated')::boolean,expiry) returning * into checked;
  end if;
 else
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
  select * into checked from fmat.private_review_checks where request_id=r.id order by created_at desc,id desc limit 1;
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from fmat.candidate_evaluations where request_id=r.id and check_id=checked.check_id;
 current:=not reconnect and checked.id is not null and checked.check_id=r.availability_check_id and checked.request_revision=r.revision and checked.evaluation_ids=ids and checked.context_basis=context and checked.expires_at>clock_timestamp() and r.availability_check_started_at>clock_timestamp()-interval '5 minutes' and not r.host_availability_failed and not(r.availability_mode='calendar' and r.availability_failed);
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'timezone',coalesce(h.rules->>'timezone','UTC'),'detailsComplete',fmat.details_complete(r.details),
  'availability',case when reconnect then 'reconnect_required' when checked.id is null then 'idle' when current then 'current' else 'stale' end,
  'truncated',case when current then checked.truncated else false end,'expiresAt',case when current then checked.expires_at else null end,
  'rules',jsonb_build_object('meetingMode',coalesce(h.rules->>'meetingMode',''),'locations',coalesce(h.rules->'locations','[]'),'additional',coalesce(h.rules->>'preferences',''),'bufferMinutes',coalesce((h.rules->>'bufferMinutes')::integer,0),'travelBufferMinutes',coalesce((h.rules->>'travelBufferMinutes')::integer,0)),
  'evaluations',case when current then (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'expiresAt',e.expires_at,'status',e.status,'evidence',e.evidence) order by e.candidate->>'start',e.id),'[]') from fmat.candidate_evaluations e where e.request_id=r.id and e.check_id=checked.check_id) else '[]' end,
  'allowances',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'candidate',e.candidate,'value',a.value) order by a.created_at desc,a.id),'[]') from fmat.travel_allowances a join fmat.candidate_evaluations e on e.id=a.evaluation_id where a.request_id=r.id and a.revoked_at is null),
  'preferences',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'candidate',e.candidate,'value',p.value) order by p.created_at desc,p.id),'[]') from fmat.preference_decisions p join fmat.candidate_evaluations e on e.id=p.evaluation_id where p.request_id=r.id and p.revoked_at is null));
end;
$$;
revoke all on function public.fmat_private_review(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_private_review(text,jsonb,jsonb) to service_role;
