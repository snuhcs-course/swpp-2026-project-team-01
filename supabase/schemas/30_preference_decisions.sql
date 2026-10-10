-- Explicit host interpretation or exceptions for named preferences only.
create table fmat.preference_decisions (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references fmat.requests(id) on delete cascade,
 evaluation_id uuid not null references fmat.candidate_evaluations(id) on delete cascade,
 host_id uuid not null references fmat.hosts(id),
 session_id uuid not null,
 idempotency_key uuid not null,
 input jsonb not null,
 result_revision integer not null,
 context_basis text not null check(context_basis ~ '^[a-f0-9]{64}$'),
 context_fingerprint text not null check(context_fingerprint ~ '^[a-f0-9]{64}$'),
 preference_key text not null check(preference_key in ('meeting_mode','location','additional')),
 value jsonb not null check(jsonb_typeof(value)='object' and octet_length(value::text)<=8192),
 created_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 revoke_key uuid,
 revoke_input jsonb,
 revoke_revision integer,
 unique(request_id,idempotency_key),unique(request_id,revoke_key)
);
create index preference_decisions_request_context_idx on fmat.preference_decisions(request_id,context_basis) where revoked_at is null;
create index preference_decisions_evaluation_idx on fmat.preference_decisions(evaluation_id);
create index preference_decisions_host_idx on fmat.preference_decisions(host_id);
alter table fmat.preference_decisions enable row level security;
revoke all on fmat.preference_decisions from public,anon,authenticated;

create or replace function fmat.protect_preference_decision()
returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'revoked_at'-'revoke_key'-'revoke_input'-'revoke_revision') is distinct from (to_jsonb(old)-'revoked_at'-'revoke_key'-'revoke_input'-'revoke_revision')
  or old.revoked_at is not null then raise exception 'IMMUTABLE_PREFERENCE';end if;
 return new;
end;
$$;
create trigger preference_decisions_immutable before update on fmat.preference_decisions for each row execute function fmat.protect_preference_decision();

create or replace function public.fmat_preference_decision(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; a fmat.preference_decisions; e fmat.candidate_evaluations; actor jsonb; current_basis text; leg jsonb; v jsonb; result_id uuid; next_revision integer;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 -- Reuse the evaluator's authority, account, connection and locking checks.
 current_basis:=public.fmat_availability_evaluation('current_context',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision))->>'travelBasis';
 if p_operation='confirm' then
  select * into a from fmat.preference_decisions where request_id=r.id and idempotency_key=(p_input->>'idempotencyKey')::uuid;
  if found then
   if a.input<>p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if a.revoked_at is not null or a.context_basis<>current_basis or a.result_revision<>r.revision then raise exception 'REVISION_CONFLICT';end if;
   return jsonb_build_object('requestId',r.id,'revision',a.result_revision,'decisionId',a.id,'revoked',false,'complete',false);
  end if;
 end if;
 if p_operation='confirm' then
  perform public.fmat_availability_evaluation('evidence_read',p_credential,p_input);
  select * into strict e from fmat.candidate_evaluations where id=(p_input->>'evaluationId')::uuid and request_id=r.id;
  if p_input->'confirmed' is distinct from 'true'::jsonb or p_input->>'idempotencyKey' is null
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','evaluationId','confirmed','idempotencyKey','choice')) then raise exception 'INVALID_INPUT';end if;
  v:=p_input->'choice';
  if jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'key','') not in ('meeting_mode','location','additional')
   or v->>'classification' is distinct from 'preference' or coalesce(v->>'decision','') not in ('satisfied','exception')
   or (v->>'key'<>'additional' and v->>'decision'<>'exception')
   or length(trim(coalesce(v->>'reason',''))) not between 1 and 2000 or octet_length(v::text)>8192
   or exists(select 1 from jsonb_object_keys(v) k where k not in ('key','classification','decision','reason')) then raise exception 'INVALID_INPUT';end if;
  -- A preference decision never resolves hard interval or travel failures.
  if e.evidence->>'interval' is distinct from 'fits' or e.evidence->'travel'->>'status' is distinct from 'fits'
   or jsonb_typeof(e.evidence->'preferences') is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
  select c into leg from jsonb_array_elements(e.evidence->'preferences'->'checks') c where c->>'key'=v->>'key';
  if leg->>'status' is distinct from 'unresolved' then raise exception 'INVALID_INPUT';end if;
  if (select count(*) from fmat.preference_decisions where request_id=r.id)>=200 then raise exception 'CONVERSATION_LIMIT';end if;
  if (select count(*) from fmat.preference_decisions where request_id=r.id and context_basis=current_basis and revoked_at is null)>=30 then raise exception 'CONVERSATION_LIMIT';end if;
  next_revision:=r.revision+1;
  update fmat.preference_decisions set revoked_at=clock_timestamp() where request_id=r.id and context_fingerprint=e.evidence->'preferences'->>'contextFingerprint' and preference_key=v->>'key' and revoked_at is null;
  insert into fmat.preference_decisions(request_id,evaluation_id,host_id,session_id,idempotency_key,input,result_revision,context_basis,context_fingerprint,preference_key,value)
   values(r.id,e.id,r.host_id,(p_credential->>'sessionId')::uuid,(p_input->>'idempotencyKey')::uuid,p_input,next_revision,current_basis,e.evidence->'preferences'->>'contextFingerprint',v->>'key',v) returning id into result_id;
 elsif p_operation='revoke' then
  if p_input->>'idempotencyKey' is null or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','decisionId','idempotencyKey')) then raise exception 'INVALID_INPUT';end if;
  select * into a from fmat.preference_decisions where request_id=r.id and id=(p_input->>'decisionId')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  if a.revoke_key=(p_input->>'idempotencyKey')::uuid then
   if a.revoke_input<>p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if a.revoke_revision<>r.revision then raise exception 'REVISION_CONFLICT';end if;
   return jsonb_build_object('requestId',r.id,'revision',a.revoke_revision,'decisionId',a.id,'revoked',true,'complete',false);
  end if;
  if (p_input->>'revision')::integer is distinct from r.revision or a.revoked_at is not null then raise exception 'REVISION_CONFLICT';end if;
  next_revision:=r.revision+1;result_id:=a.id;
  update fmat.preference_decisions set revoked_at=clock_timestamp(),revoke_key=(p_input->>'idempotencyKey')::uuid,revoke_input=p_input,revoke_revision=next_revision where id=a.id;
 else raise exception 'FORBIDDEN';end if;
 update fmat.requests set revision=next_revision,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
  availability_check_id=null,availability_check_started_at=null,status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,updated_at=clock_timestamp() where id=r.id;
 insert into fmat.request_history(request_id,revision,operation,actor) values(r.id,next_revision,'preference_decision_'||p_operation,actor);
 perform fmat.audit('preference_decision_'||p_operation,actor,r.id::text);
 return jsonb_build_object('requestId',r.id,'revision',next_revision,'decisionId',result_id,'revoked',p_operation='revoke','complete',false);
end;
$$;
revoke all on function public.fmat_preference_decision(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_preference_decision(text,jsonb,jsonb) to service_role;
