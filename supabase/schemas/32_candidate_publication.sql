create table fmat.candidate_publications (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references fmat.requests(id) on delete cascade,
 ranking_id uuid not null unique references fmat.candidate_rankings(id) on delete cascade,
 check_id uuid not null,
 context_basis text not null check(context_basis ~ '^[a-f0-9]{64}$'),
 result_revision integer not null check(result_revision>0),
 candidates jsonb not null check(jsonb_typeof(candidates)='array' and jsonb_array_length(candidates)<=30),
 resolution text not null check(resolution in ('available','clarification','no_candidates')),
 truncated boolean not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index candidate_publications_request_idx on fmat.candidate_publications(request_id,created_at desc);
alter table fmat.candidate_publications enable row level security;
revoke all on fmat.candidate_publications from public,anon,authenticated;
create trigger candidate_publications_immutable before update on fmat.candidate_publications for each row execute function fmat.reject_candidate_evaluation_update();
alter table fmat.requests add column candidate_publication_id uuid references fmat.candidate_publications(id);
create index requests_candidate_publication_idx on fmat.requests(candidate_publication_id) where candidate_publication_id is not null;
create table fmat.proposal_evidence (
 request_id uuid not null,
 proposal_version integer not null,
 publication_id uuid not null references fmat.candidate_publications(id),
 evaluation_id uuid not null references fmat.candidate_evaluations(id),
 context_basis text not null,
 primary key(request_id,proposal_version),
 foreign key(request_id,proposal_version) references fmat.proposals(request_id,version)
);
create index proposal_evidence_publication_idx on fmat.proposal_evidence(publication_id);
create index proposal_evidence_evaluation_idx on fmat.proposal_evidence(evaluation_id);
alter table fmat.proposal_evidence enable row level security;
revoke all on fmat.proposal_evidence from public,anon,authenticated;
create trigger proposal_evidence_immutable before update on fmat.proposal_evidence for each row execute function fmat.reject_candidate_evaluation_update();
create table fmat.scheduling_decisions (
 request_id uuid not null references fmat.requests(id) on delete cascade,
 actor_scope text not null,
 key uuid not null,
 operation text not null check(operation in ('select','agree')),
 input jsonb not null,
 result_revision integer not null,
 primary key(request_id,actor_scope,key)
);
alter table fmat.scheduling_decisions enable row level security;
revoke all on fmat.scheduling_decisions from public,anon,authenticated;
create trigger scheduling_decisions_immutable before update on fmat.scheduling_decisions for each row execute function fmat.reject_candidate_evaluation_update();

-- This projection is shared-safe, including when a host calls it. Validation
-- occurs in the public service function before any private row reaches it.
create or replace function fmat.scheduling_view(p_request_id uuid,p_context text,p_reconnect boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare r fmat.requests; p fmat.candidate_publications; proposal jsonb; bound boolean:=false; current boolean:=false; availability text;
begin
 select * into strict r from fmat.requests where id=p_request_id;
 select * into p from fmat.candidate_publications where id=r.candidate_publication_id and request_id=r.id;
 current:=p.id is not null and p.context_basis=p_context and p.expires_at>clock_timestamp() and p.check_id=r.availability_check_id and r.availability_check_started_at>clock_timestamp()-interval '5 minutes' and not r.host_availability_failed and not(r.availability_mode='calendar' and r.availability_failed);
 select details into proposal from fmat.proposals where request_id=r.id and version=r.current_proposal_version;
 bound:=exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=p_context);
 availability:=case when p_reconnect then 'reconnect_required' when p.id is null then 'not_evaluated' when not current then 'stale' else p.resolution end;
 return jsonb_build_object('requestId',r.id,'revision',r.revision,'status',r.status,'detailsComplete',fmat.details_complete(r.details),'availability',availability,
 'publication',case when current then jsonb_build_object('id',p.id,'expiresAt',p.expires_at,'truncated',p.truncated,'candidates',p.candidates) else null end,
 'proposal',proposal,'requesterAgreed',bound and coalesce(r.requester_agreed_version=r.current_proposal_version,false),
 'canAgree',coalesce(bound and proposal is not null and not p_reconnect and not r.host_availability_failed and not(r.availability_mode='calendar' and r.availability_failed),false));
end;
$$;

create or replace function public.fmat_scheduling(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; actor jsonb; context text; reconnect boolean:=false; pub fmat.candidate_publications; ranking fmat.candidate_rankings; e fmat.candidate_evaluations;
 snapshot jsonb; v_candidates jsonb:='[]'; c jsonb; proposal jsonb; version integer; decision fmat.scheduling_decisions; scope text; resolution text;
begin
 if p_operation is null or p_operation not in ('read','publish','select','agree') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 select * into r from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential);perform fmat.require_request(actor,r.id);
 if r.status in ('booking','booked','withdrawn','declined','expired') or r.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND';end if;
 -- The current-context helper also checks live account/session, host readiness,
 -- guest consent and lock-wait expiry, in the evaluator's lock order.
 begin
  context:=public.fmat_availability_evaluation('current_context',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision))->>'travelBasis';
 exception when raise_exception then
  if p_operation='read' and sqlerrm='RECONNECT_REQUIRED' then reconnect:=true;else raise;end if;
 end;
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k<>'requestId') then raise exception 'INVALID_INPUT';end if;
  return fmat.scheduling_view(r.id,context,reconnect);
 end if;
 if p_operation='publish' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','rankingId','truncated')) or jsonb_typeof(p_input->'truncated') is distinct from 'boolean' then raise exception 'INVALID_INPUT';end if;
  select * into pub from fmat.candidate_publications where ranking_id=(p_input->>'rankingId')::uuid and request_id=r.id;
  if pub.id is not null then
   if pub.context_basis is distinct from context or pub.id is distinct from r.candidate_publication_id or pub.result_revision<>r.revision or pub.check_id is distinct from r.availability_check_id or pub.expires_at<=clock_timestamp() or r.availability_check_started_at is null or r.availability_check_started_at<=clock_timestamp()-interval '5 minutes' then raise exception 'REVISION_CONFLICT';end if;
   if pub.truncated is distinct from (p_input->>'truncated')::boolean or (p_input->>'revision')::integer is distinct from pub.result_revision-1 then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return fmat.scheduling_view(r.id,context);
  end if;
 else
  if p_input->'confirmed' is distinct from 'true'::jsonb or (p_operation='agree' and actor->>'kind'<>'guest') then raise exception 'FORBIDDEN';end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','publicationId','candidateId','proposalVersion','confirmed','idempotencyKey')) then raise exception 'INVALID_INPUT';end if;
  scope:=case when actor->>'kind'='guest' then 'guest:'||(actor->>'tokenHash') else 'host:'||(p_credential->>'subject')||':'||(p_credential->>'sessionId') end;
  if p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT';end if;
  select * into decision from fmat.scheduling_decisions where request_id=r.id and actor_scope=scope and key=(p_input->>'idempotencyKey')::uuid;
  if decision.key is not null then
   if decision.operation<>p_operation or decision.input is distinct from p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if decision.result_revision<>r.revision or not exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=context) then raise exception 'REVISION_CONFLICT';end if;
   return fmat.scheduling_view(r.id,context);
  end if;
 end if;
 if (p_input->>'revision')::integer is distinct from r.revision then raise exception 'REVISION_CONFLICT';end if;
 if r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then raise exception 'RECONNECT_REQUIRED';end if;
 if not fmat.details_complete(r.details) then raise exception 'INVALID_INPUT';end if;
 if p_operation='publish' then
  select * into ranking from fmat.candidate_rankings where id=(p_input->>'rankingId')::uuid and request_id=r.id;
  if not found then raise exception 'NOT_FOUND';end if;
  -- Empty time samples have no evidence rows. Recompute their basis from the
  -- current attempt using the explicit basis retained on the ranking below.
  snapshot:=public.fmat_candidate_ranking('read',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision,'checkId',ranking.check_id,'basis',ranking.basis));
  if snapshot->'saved'->>'rankingId' is distinct from ranking.id::text then raise exception 'REVISION_CONFLICT';end if;
  for c in select value from jsonb_array_elements(ranking.ordered_ids) loop
   select * into strict e from fmat.candidate_evaluations where id=(c#>>'{}')::uuid and request_id=r.id;
   v_candidates:=v_candidates||jsonb_build_array(jsonb_build_object('id',e.id,'interval',e.candidate));
  end loop;
  resolution:=case when jsonb_array_length(v_candidates)>0 then 'available' when exists(select 1 from fmat.candidate_evaluations where request_id=r.id and check_id=ranking.check_id and status='clarification') then 'clarification' else 'no_candidates' end;
  insert into fmat.candidate_publications(request_id,ranking_id,check_id,context_basis,result_revision,candidates,resolution,truncated,expires_at)
   values(r.id,ranking.id,ranking.check_id,context,r.revision+1,v_candidates,resolution,(p_input->>'truncated')::boolean,ranking.expires_at) returning * into pub;
  update fmat.requests set candidate_publication_id=pub.id,candidates=(select coalesce(jsonb_agg(value->'interval'),'[]') from jsonb_array_elements(v_candidates)),
   current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_rules_version=(select rules_version from fmat.hosts where id=r.host_id),evaluated_at=clock_timestamp(),status='negotiating' where id=r.id;
 elsif p_operation='select' then
  select * into pub from fmat.candidate_publications where id=(p_input->>'publicationId')::uuid and request_id=r.id;
  if pub.id is null or pub.id is distinct from r.candidate_publication_id or pub.context_basis is distinct from context or pub.check_id is distinct from r.availability_check_id or pub.expires_at<=clock_timestamp() or r.availability_check_started_at is null or r.availability_check_started_at<=clock_timestamp()-interval '5 minutes' then raise exception 'REVISION_CONFLICT';end if;
  select value into c from jsonb_array_elements(pub.candidates) where value->>'id'=p_input->>'candidateId';if c is null then raise exception 'INVALID_INPUT';end if;
  select * into strict e from fmat.candidate_evaluations where id=(c->>'id')::uuid and request_id=r.id;
  select coalesce(max(p.version),0)+1 into version from fmat.proposals p where request_id=r.id;
  proposal:=jsonb_build_object('version',version,'start',c->'interval'->>'start','end',c->'interval'->>'end','timezone',r.details->>'timezone','mode',r.details->>'mode','location',r.details->>'location','requesterName',r.details->>'requesterName','requesterEmail',r.details->>'requesterEmail','purpose',r.details->>'purpose');
  insert into fmat.proposals(request_id,version,details,rules_version) values(r.id,version,proposal,e.rules_version);
  insert into fmat.proposal_evidence(request_id,proposal_version,publication_id,evaluation_id,context_basis) values(r.id,version,pub.id,e.id,context);
  update fmat.requests set current_proposal_version=version,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=r.id;
 elsif p_operation='agree' then
  if r.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from r.current_proposal_version
   or not exists(select 1 from fmat.proposal_evidence where request_id=r.id and proposal_version=r.current_proposal_version and context_basis=context) then raise exception 'REVISION_CONFLICT';end if;
  update fmat.requests set requester_agreed_version=current_proposal_version,host_approved_version=null,status='awaiting_approval' where id=r.id;
 end if;
 update fmat.requests set revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
 if p_operation in ('select','agree') then insert into fmat.scheduling_decisions(request_id,actor_scope,key,operation,input,result_revision) values(r.id,scope,(p_input->>'idempotencyKey')::uuid,p_operation,p_input,r.revision);end if;
 insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'scheduling_'||p_operation,actor-'tokenHash',r.current_proposal_version);
 perform fmat.audit('scheduling_'||p_operation,actor,r.id::text);
 return fmat.scheduling_view(r.id,context);
end;
$$;
revoke all on function public.fmat_scheduling(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_scheduling(text,jsonb,jsonb) to service_role;
