-- Explicit browser-host decisions; never model-produced scheduling authority.
create table fmat.travel_allowances (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references fmat.requests(id) on delete cascade,
 evaluation_id uuid not null references fmat.candidate_evaluations(id) on delete cascade,
 host_id uuid not null references fmat.hosts(id),
 session_id uuid not null,
 idempotency_key uuid not null,
 input jsonb not null,
 result_revision integer not null,
 travel_basis text not null check(travel_basis ~ '^[a-f0-9]{64}$'),
 context_fingerprint text not null check(context_fingerprint ~ '^[a-f0-9]{64}$'),
 direction text not null check(direction in ('inbound','outbound')),
 value jsonb not null check(jsonb_typeof(value)='object' and octet_length(value::text)<=8192),
 created_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 revoke_key uuid,
 revoke_input jsonb,
 revoke_revision integer,
 unique(request_id,idempotency_key),unique(request_id,revoke_key)
);
create index travel_allowances_request_context_idx on fmat.travel_allowances(request_id,travel_basis) where revoked_at is null;
create index travel_allowances_evaluation_idx on fmat.travel_allowances(evaluation_id);
create index travel_allowances_host_idx on fmat.travel_allowances(host_id);
alter table fmat.travel_allowances enable row level security;
revoke all on fmat.travel_allowances from public,anon,authenticated;

create or replace function fmat.protect_travel_allowance()
returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'revoked_at'-'revoke_key'-'revoke_input'-'revoke_revision') is distinct from (to_jsonb(old)-'revoked_at'-'revoke_key'-'revoke_input'-'revoke_revision')
  or old.revoked_at is not null then raise exception 'IMMUTABLE_ALLOWANCE';end if;
 return new;
end;
$$;
create trigger travel_allowances_immutable before update on fmat.travel_allowances for each row execute function fmat.protect_travel_allowance();

create or replace function public.fmat_travel_allowance(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; a fmat.travel_allowances; e fmat.candidate_evaluations; actor jsonb; current_basis text; leg jsonb; v jsonb; result_id uuid; next_revision integer;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 -- Reuse the evaluator's authority, account, connection and locking checks.
 current_basis:=public.fmat_availability_evaluation('current_context',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision))->>'travelBasis';
 if p_operation in ('replay','confirm') then
  select * into a from fmat.travel_allowances where request_id=r.id and idempotency_key=(p_input->>'idempotencyKey')::uuid;
  if found then
   if a.input<>p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if a.revoked_at is not null or a.travel_basis<>current_basis or a.result_revision<>r.revision then raise exception 'REVISION_CONFLICT';end if;
   return jsonb_build_object('requestId',r.id,'revision',a.result_revision,'allowanceId',a.id,'revoked',false,'complete',false);
  end if;
  if p_operation='replay' then return null;end if;
 end if;
 if p_operation in ('evidence','confirm') then
  perform public.fmat_availability_evaluation('evidence_read',p_credential,p_input);
  select * into strict e from fmat.candidate_evaluations where id=(p_input->>'evaluationId')::uuid and request_id=r.id;
  if p_operation='evidence' then return e.evidence;end if;
  if p_input->'confirmed' is distinct from 'true'::jsonb or p_input->>'idempotencyKey' is null
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','evaluationId','confirmed','idempotencyKey','allowance')) then raise exception 'INVALID_INPUT';end if;
  v:=p_input->'allowance';
  if jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'direction','') not in ('inbound','outbound')
   or jsonb_typeof(v->'durationMinutes') is distinct from 'number' or coalesce(v->>'durationMinutes','') !~ '^[0-9]+$' or (v->>'durationMinutes')::integer not between 1 and 1440
   or coalesce(v->>'mode','') not in ('DRIVE','TRANSIT','WALK','BICYCLE')
   or length(trim(coalesce(v->>'reason',''))) not between 1 and 2000 or octet_length(v::text)>8192
   or exists(select 1 from jsonb_object_keys(v) k where k not in ('direction','durationMinutes','mode','boundary','reason'))
   or jsonb_typeof(v->'boundary') is distinct from 'object' or coalesce(v->'boundary'->>'at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   or jsonb_typeof(v->'boundary'->'location') is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
  select l into leg from jsonb_array_elements(e.evidence->'travel'->'legs') l where l->>'direction'=v->>'direction';
  if e.evidence->>'interval' is distinct from 'fits' or e.evidence->'travelContext'->>'meetingMode' is distinct from 'in_person'
   or e.evidence->'travelContext'->'location' is null or e.evidence->'travelContext'->'location'='null'::jsonb
   or leg->>'status' is distinct from 'clarification' then raise exception 'INVALID_INPUT';end if;
  if (select count(*) from fmat.travel_allowances where request_id=r.id)>=200 then raise exception 'CONVERSATION_LIMIT';end if;
  if (select count(*) from fmat.travel_allowances where request_id=r.id and travel_basis=current_basis and revoked_at is null)>=20 then raise exception 'CONVERSATION_LIMIT';end if;
  next_revision:=r.revision+1;
  update fmat.travel_allowances set revoked_at=clock_timestamp() where request_id=r.id and context_fingerprint=leg->>'contextFingerprint' and direction=v->>'direction' and revoked_at is null;
  insert into fmat.travel_allowances(request_id,evaluation_id,host_id,session_id,idempotency_key,input,result_revision,travel_basis,context_fingerprint,direction,value)
   values(r.id,e.id,r.host_id,(p_credential->>'sessionId')::uuid,(p_input->>'idempotencyKey')::uuid,p_input,next_revision,current_basis,leg->>'contextFingerprint',v->>'direction',v) returning id into result_id;
 elsif p_operation='revoke' then
  if p_input->>'idempotencyKey' is null or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','allowanceId','idempotencyKey')) then raise exception 'INVALID_INPUT';end if;
  select * into a from fmat.travel_allowances where request_id=r.id and id=(p_input->>'allowanceId')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  if a.revoke_key=(p_input->>'idempotencyKey')::uuid then
   if a.revoke_input<>p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if a.revoke_revision<>r.revision then raise exception 'REVISION_CONFLICT';end if;
   return jsonb_build_object('requestId',r.id,'revision',a.revoke_revision,'allowanceId',a.id,'revoked',true,'complete',false);
  end if;
  if (p_input->>'revision')::integer is distinct from r.revision or a.revoked_at is not null then raise exception 'REVISION_CONFLICT';end if;
  next_revision:=r.revision+1;result_id:=a.id;
  update fmat.travel_allowances set revoked_at=clock_timestamp(),revoke_key=(p_input->>'idempotencyKey')::uuid,revoke_input=p_input,revoke_revision=next_revision where id=a.id;
 else raise exception 'FORBIDDEN';end if;
 update fmat.requests set revision=next_revision,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
  availability_check_id=null,availability_check_started_at=null,status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,updated_at=clock_timestamp() where id=r.id;
 insert into fmat.request_history(request_id,revision,operation,actor) values(r.id,next_revision,'travel_allowance_'||p_operation,actor);
 perform fmat.audit('travel_allowance_'||p_operation,actor,r.id::text);
 return jsonb_build_object('requestId',r.id,'revision',next_revision,'allowanceId',result_id,'revoked',p_operation='revoke','complete',false);
end;
$$;
revoke all on function public.fmat_travel_allowance(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_travel_allowance(text,jsonb,jsonb) to service_role;
