-- Private immutable ordering; these records do not publish or approve proposals.
create table fmat.candidate_rankings (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references fmat.requests(id) on delete cascade,
 check_id uuid not null,
 request_revision integer not null check(request_revision>0),
 basis text check(basis ~ '^[a-f0-9]{64}$'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 ordered_ids jsonb not null check(jsonb_typeof(ordered_ids)='array' and jsonb_array_length(ordered_ids)<=30),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null check(expires_at>created_at),
 unique(request_id,check_id)
);
alter table fmat.candidate_rankings enable row level security;
revoke all on fmat.candidate_rankings from public,anon,authenticated;
create trigger candidate_rankings_immutable before update on fmat.candidate_rankings for each row execute function fmat.reject_candidate_evaluation_update();

create or replace function public.fmat_candidate_ranking(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r fmat.requests; e fmat.candidate_evaluations; saved fmat.candidate_rankings;
 candidates jsonb:='[]'; ids jsonb:='[]'; manifest jsonb:='[]'; fingerprint text; expires timestamptz; result jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or p_operation not in ('read','reserve','save') then raise exception 'INVALID_INPUT';end if;
 -- Reuse request -> host -> session -> connections lock order and all current
 -- authority/failure/context fences before inspecting any candidate evidence.
 perform public.fmat_availability_evaluation('check',p_credential,p_input);
 select * into strict r from fmat.requests where id=(p_input->>'requestId')::uuid;
 if r.host_availability_failed or (r.availability_mode='calendar' and r.availability_failed) then raise exception 'RECONNECT_REQUIRED';end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('requestId','revision','checkId','basis','fingerprint','orderedIds')) then raise exception 'INVALID_INPUT';end if;
 expires:=least(r.availability_check_started_at+interval '5 minutes',r.expires_at);
 if (select count(*) from fmat.candidate_evaluations where request_id=r.id and check_id=r.availability_check_id)>30 then raise exception 'INVALID_INPUT';end if;
 for e in select * from fmat.candidate_evaluations where request_id=r.id and check_id=r.availability_check_id order by id loop
  perform public.fmat_availability_evaluation('evidence_read',p_credential,jsonb_build_object('requestId',r.id,'revision',r.revision,'evaluationId',e.id));
  manifest:=manifest||jsonb_build_array(jsonb_build_object('id',e.id,'status',e.status,'expiresAt',e.expires_at));
  expires:=least(expires,e.expires_at);
  if e.status='checks_passed' then
   -- Historical pending evidence cannot enter the model even if mislabeled.
   if (e.evidence->>'interval'='fits' and e.evidence->'travel'->>'status'='fits' and e.evidence->'preferences'->>'status'='satisfied') is not true then raise exception 'INVALID_INPUT';end if;
   candidates:=candidates||jsonb_build_array(jsonb_build_object('id',e.id,'interval',e.candidate));ids:=ids||to_jsonb(e.id);
  end if;
 end loop;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('basis',p_input->>'basis','checkId',r.availability_check_id,'manifest',manifest)::text,'UTF8')),'hex');
 select * into saved from fmat.candidate_rankings where request_id=r.id and check_id=r.availability_check_id;
 if saved.id is not null and (saved.fingerprint<>fingerprint or saved.expires_at<=clock_timestamp()) then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='reserve' then
  if p_input->>'fingerprint' is distinct from fingerprint then raise exception 'REVISION_CONFLICT';end if;
  -- A concurrent saved result must be read again; it cannot authorize another
  -- provider attempt. Empty candidates are deterministic and need no model.
  if saved.id is not null or jsonb_array_length(candidates)=0 then raise exception 'REVISION_CONFLICT';end if;
  perform fmat.model_budget_reserve(p_credential->>'kind',case when p_credential->>'kind'='host' then r.host_id else r.id end,'ranking',r.availability_check_id);
  perform public.fmat_availability_evaluation('check',p_credential,p_input);
  if expires<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
  return jsonb_build_object('reserved',true);
 end if;
 if p_operation='save' then
  if p_input->>'fingerprint' is distinct from fingerprint then raise exception 'REVISION_CONFLICT';end if;
  if jsonb_typeof(p_input->'orderedIds') is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
  if jsonb_array_length(p_input->'orderedIds')<>jsonb_array_length(ids)
   or exists(select 1 from jsonb_array_elements(p_input->'orderedIds') x where jsonb_typeof(x)<>'string' or not(ids @> jsonb_build_array(x)))
   or (select count(distinct x) from jsonb_array_elements(p_input->'orderedIds') x)<>jsonb_array_length(ids) then raise exception 'INVALID_INPUT';end if;
  if saved.id is not null then
   if saved.ordered_ids is distinct from p_input->'orderedIds' then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  else
   if expires<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
   insert into fmat.candidate_rankings(request_id,check_id,request_revision,basis,fingerprint,ordered_ids,expires_at)
    values(r.id,r.availability_check_id,r.revision,p_input->>'basis',fingerprint,p_input->'orderedIds',expires) returning * into saved;
  end if;
 end if;
 if saved.id is not null then result:=jsonb_build_object('rankingId',saved.id,'requestId',r.id,'revision',r.revision,'checkId',r.availability_check_id,'orderedIds',saved.ordered_ids,'expiresAt',saved.expires_at,'complete',false);end if;
 if p_operation='read' then return jsonb_build_object('fingerprint',fingerprint,'input',jsonb_build_object('timezone',r.details->>'timezone','candidates',candidates),'saved',result);end if;
 return result;
end;
$$;
revoke all on function public.fmat_candidate_ranking(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_candidate_ranking(text,jsonb,jsonb) to service_role;
