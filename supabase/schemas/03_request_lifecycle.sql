-- Request authority is private and separate from Google grants and host approval.
create table fmat.requests (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references fmat.hosts(id),
  revision integer not null default 1 check(revision>0),
  status text not null default 'gathering' check(status in ('gathering','negotiating','awaiting_approval','booking','booked','declined','withdrawn','expired')),
  details jsonb not null,
  candidates jsonb not null default '[]'::jsonb,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at timestamptz not null default now()+interval '30 days',
  token_revoked_at timestamptz,
  contact_verified_email text,
  current_proposal_version integer,
  requester_agreed_version integer,
  host_approved_version integer,
  event jsonb,
  private_notes text not null default '',
  private_scheduling_context jsonb not null default '{}'::jsonb,
  model_calls integer not null default 0 check(model_calls between 0 and 8),
  private_diagnostics jsonb not null default '[]'::jsonb,
  private_travel_checks jsonb not null default '[]'::jsonb,
  evaluated_rules_version integer,
  evaluated_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_host_idx on fmat.requests(host_id,created_at desc);
create index requests_expiry_idx on fmat.requests(expires_at) where status in ('gathering','negotiating','awaiting_approval');
alter table fmat.requests enable row level security;
create table fmat.proposals (
  request_id uuid not null references fmat.requests(id),
  version integer not null check(version>0),
  details jsonb not null,
  rules_version integer not null,
  created_at timestamptz not null default now(),
  primary key(request_id,version)
);
alter table fmat.proposals enable row level security;
create or replace function fmat.reject_proposal_mutation()
returns trigger language plpgsql set search_path='' as $$ begin raise exception 'IMMUTABLE_PROPOSAL'; end; $$;
create trigger proposals_immutable before update or delete on fmat.proposals for each row execute function fmat.reject_proposal_mutation();
create table fmat.request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fmat.requests(id),
  role text not null check(role in ('requester','host','assistant')),
  audience text not null check(audience in ('shared','host')),
  text text not null check(length(text) between 1 and 10000),
  actor jsonb not null,
  created_at timestamptz not null default now()
);
create index request_messages_request_idx on fmat.request_messages(request_id,created_at,id);
alter table fmat.request_messages enable row level security;
create table fmat.request_history (
  id bigint generated always as identity primary key,
  request_id uuid not null references fmat.requests(id),
  revision integer not null,
  operation text not null,
  actor jsonb not null,
  proposal_version integer,
  created_at timestamptz not null default now()
);
create index request_history_request_idx on fmat.request_history(request_id,id);
alter table fmat.request_history enable row level security;
create table fmat.contact_challenges (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fmat.requests(id),
  email text not null,
  purpose text not null check(purpose in ('verification','recovery')),
  secret_hash text not null check(secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default now()+interval '15 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index contact_challenges_request_idx on fmat.contact_challenges(request_id,purpose,created_at desc);
alter table fmat.contact_challenges enable row level security;

create or replace function fmat.normalize_details(p_details jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_window jsonb; v_windows jsonb:=coalesce(p_details->'windows','[]'::jsonb); v_email text:=lower(trim(coalesce(p_details->>'requesterEmail','')));
begin
  if jsonb_typeof(p_details) is distinct from 'object' or jsonb_typeof(v_windows) is distinct from 'array' or jsonb_array_length(v_windows)>30
    or length(coalesce(p_details->>'requesterName',''))>200 or length(coalesce(p_details->>'purpose',''))>5000 or length(coalesce(p_details->>'location',''))>2000
    or length(v_email)>254 or (v_email<>'' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (coalesce(p_details->>'timezone','')<>'' and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_details->>'timezone'))
    or (p_details ? 'durationMinutes' and p_details->'durationMinutes'<>'null'::jsonb and coalesce((p_details->>'durationMinutes')::integer,0) not between 5 and 240)
    or coalesce(p_details->>'mode','') not in ('','online','in_person') then raise exception 'INVALID_INPUT'; end if;
  for v_window in select value from jsonb_array_elements(v_windows) loop
    if coalesce(v_window->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(v_window->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (v_window->>'start')::timestamptz>=(v_window->>'end')::timestamptz or (v_window->>'end')::timestamptz<=now()
      or (v_window->>'end')::timestamptz>(v_window->>'start')::timestamptz+interval '31 days' then raise exception 'INVALID_INPUT'; end if;
  end loop;
  if p_details->>'mode'='online' and coalesce(p_details->>'location','')<>'' and p_details->>'location' !~ '^https://[^[:space:]]+$' then raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('requesterName',trim(coalesce(p_details->>'requesterName','')),'requesterEmail',v_email,'purpose',trim(coalesce(p_details->>'purpose','')),
    'durationMinutes',p_details->'durationMinutes','timezone',coalesce(p_details->>'timezone',''),'windows',v_windows,'mode',coalesce(p_details->>'mode',''),'location',trim(coalesce(p_details->>'location','')));
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_INPUT';
end;
$$;
create or replace function fmat.details_complete(p_details jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(length(p_details->>'requesterName')>0 and length(p_details->>'requesterEmail')>0 and length(p_details->>'purpose')>0
    and (p_details->>'durationMinutes')::integer between 5 and 240 and length(p_details->>'timezone')>0 and jsonb_array_length(p_details->'windows')>0
    and p_details->>'mode' in ('online','in_person') and length(p_details->>'location')>0,false);
$$;
create or replace function fmat.request_expiry(p_details jsonb,p_created_at timestamptz)
returns timestamptz language sql stable set search_path='' as $$
  select least(p_created_at+interval '7 days',coalesce((select max((w->>'end')::timestamptz) from jsonb_array_elements(p_details->'windows') w),p_created_at+interval '7 days'));
$$;
create or replace function fmat.authorize_guest(p_actor jsonb,p_request_id uuid)
returns void language plpgsql set search_path='' as $$
declare v_request fmat.requests;
begin
  select * into v_request from fmat.requests where id=p_request_id for update;
  if not found or p_actor->>'kind' is distinct from 'guest' or p_actor->>'requestId' is distinct from p_request_id::text
    or p_actor->>'tokenHash' is distinct from v_request.token_hash or v_request.token_revoked_at is not null or v_request.token_expires_at<=now()
    or v_request.status in ('booked','withdrawn','declined','expired') then raise exception 'NOT_FOUND'; end if;
  if v_request.status in ('gathering','negotiating','awaiting_approval') and v_request.expires_at<=now() then raise exception 'REQUEST_EXPIRED'; end if;
end;
$$;
-- Closure preserves only receipt reads; OAuth and mutation authority remain revoked.
create or replace function fmat.authorize_guest_receipt(p_actor jsonb,p_request_id uuid)
returns void language plpgsql set search_path='' as $$
declare v_request fmat.requests;
begin
  select * into v_request from fmat.requests where id=p_request_id for update;
  if not found or p_actor->>'kind' is distinct from 'guest' or p_actor->>'requestId' is distinct from p_request_id::text
    or p_actor->>'tokenHash' is distinct from v_request.token_hash or v_request.token_expires_at<=now() then raise exception 'NOT_FOUND'; end if;
  if v_request.status not in ('booked','withdrawn','declined','expired') then perform fmat.authorize_guest(p_actor,p_request_id); end if;
end;
$$;
create or replace function fmat.require_request(p_actor jsonb,p_request_id uuid)
returns fmat.requests language plpgsql set search_path='' as $$
declare v_request fmat.requests; v_host_id uuid;
begin
  select * into v_request from fmat.requests where id=p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_actor->>'kind'='host' then
    v_host_id:=fmat.require_host(p_actor,true);
    if v_request.host_id<>v_host_id then raise exception 'NOT_FOUND'; end if;
  elsif p_actor->>'kind'='guest' then perform fmat.authorize_guest_receipt(p_actor,p_request_id);
  else raise exception 'FORBIDDEN'; end if;
  return v_request;
end;
$$;
create or replace function fmat.request_view(p_request_id uuid,p_actor jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_request fmat.requests; v_result jsonb; v_proposal jsonb; v_messages jsonb; v_status text; v_private_context jsonb;
begin
  select * into strict v_request from fmat.requests where id=p_request_id for update;
  select details into v_proposal from fmat.proposals where request_id=p_request_id and version=v_request.current_proposal_version;
  v_status:=case when v_request.status in ('gathering','negotiating','awaiting_approval') and v_request.expires_at<=now() then 'expired' else v_request.status end;
  if p_actor->>'kind'='guest' and v_status in ('booked','withdrawn','declined','expired') then
    if v_status<>'booked' then v_proposal:=null; end if;
    if v_proposal is not null then v_proposal:=(v_proposal-'requesterName'-'requesterEmail'-'purpose')||jsonb_build_object('requesterName','','requesterEmail','','purpose',''); end if;
    return jsonb_build_object('id',v_request.id,'hostId',v_request.host_id,'revision',v_request.revision,'status',v_status,'receipt',true,
      'event',case when v_status='booked' then v_request.event else null end,'proposal',v_proposal,'candidates','[]'::jsonb,'messages','[]'::jsonb,
      'requesterAgreed',false,'hostApproved',false,'contactVerified',false,'calendarConnected',false,'nextAction',v_status,
      'details',jsonb_build_object('requesterName','','requesterEmail','','purpose','','durationMinutes',case when v_proposal is null then 0 else extract(epoch from ((v_proposal->>'end')::timestamptz-(v_proposal->>'start')::timestamptz))/60 end,
        'timezone',coalesce(v_proposal->>'timezone',''),'windows','[]'::jsonb,'mode',coalesce(v_proposal->>'mode','online'),'location',coalesce(v_proposal->>'location','')));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role,'text',text,'createdAt',created_at) order by created_at,id),'[]'::jsonb) into v_messages
    from fmat.request_messages where request_id=p_request_id and audience='shared';
  v_result:=jsonb_build_object('id',v_request.id,'hostId',v_request.host_id,'revision',v_request.revision,'status',v_status,'details',v_request.details,'candidates',v_request.candidates,
    'calendarConnected',exists(select 1 from fmat.calendar_connections where principal_kind='guest' and principal_id=p_request_id and revoked_at is null),'proposal',v_proposal,'requesterAgreed',coalesce(v_request.requester_agreed_version=v_request.current_proposal_version,false),'hostApproved',coalesce(v_request.host_approved_version=v_request.current_proposal_version,false),
    'contactVerified',coalesce(v_request.contact_verified_email=v_request.details->>'requesterEmail',false),'event',v_request.event,'messages',v_messages,'nextAction',case
      when v_status in ('booked','declined','withdrawn','expired') then v_status when v_status='booking' then 'booking_pending'
      when not fmat.details_complete(v_request.details) then 'complete_details' when v_proposal is null and jsonb_array_length(v_request.candidates)=0 and exists(select 1 from jsonb_array_elements(v_request.private_diagnostics) d where d->>'code' in ('evaluation_unresolved','evaluation_budget_exceeded')) then 'resolve_availability'
      when v_proposal is null and jsonb_array_length(v_request.candidates)=0 then 'evaluate_or_widen_windows'
      when v_proposal is null then 'select_candidate' when v_request.requester_agreed_version is distinct from v_request.current_proposal_version then 'review_and_agree'
      when v_request.contact_verified_email is distinct from v_request.details->>'requesterEmail' then 'verify_contact' else 'host_review' end);
  if p_actor->>'kind'='host' then
    v_private_context:=v_request.private_scheduling_context;
    if v_private_context ? 'preferenceException' and (
      (v_private_context->'preferenceException'->>'proposalVersion')::integer is distinct from v_request.current_proposal_version
      or v_private_context->'preferenceException'->'proposalDetails' is distinct from v_proposal
      or (v_private_context->'preferenceException'->>'rulesVersion')::integer is distinct from (select rules_version from fmat.hosts where id=v_request.host_id)) then
      v_private_context:=v_private_context-'preferenceException';
    end if;
    v_result:=v_result||jsonb_build_object('privateNotes',v_request.private_notes,'privateMessages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role,'text',text,'createdAt',created_at) order by created_at,id),'[]'::jsonb) from fmat.request_messages where request_id=p_request_id and audience='host'),'privateSchedulingContext',v_private_context,'privateDiagnostics',v_request.private_diagnostics,'privateTravelChecks',v_request.private_travel_checks,
      'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',revision,'operation',operation,'proposalVersion',proposal_version,'createdAt',created_at) order by id),'[]'::jsonb) from fmat.request_history where request_id=p_request_id));
  end if;
  return v_result;
end;
$$;
create or replace function fmat.withdraw_allowed(p_request_id uuid)
returns boolean language sql stable set search_path='' as $$ select true; $$;
create or replace function fmat.expire_requests()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  update fmat.requests set status='expired',token_revoked_at=now(),revision=revision+1,updated_at=now()
    where status in ('gathering','negotiating','awaiting_approval') and expires_at<=now();
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
create or replace function fmat.install_request_runtime()
returns void language plpgsql set search_path='' as $$ begin perform cron.schedule('fmat-request-expiry','* * * * *','select fmat.expire_requests();'); end; $$;

create or replace function fmat.request_authorize(p_operation text,p_actor jsonb,p_input jsonb)
returns void language plpgsql set search_path='' as $$
declare v_request fmat.requests;
begin
  case p_operation
  when 'mutation_replay' then
    if p_input->>'operation' not in ('proposal_create','proposal_revise','manual_allowance_save','preference_exception_save','details_update') or p_input->>'operation' is null then raise exception 'INVALID_INPUT'; end if;
    perform fmat.request_authorize(p_input->>'operation',p_actor,p_input);
  when 'request_create' then
    if p_actor->>'kind' is distinct from 'public' then raise exception 'FORBIDDEN'; end if;
  when 'requests_list' then perform fmat.require_host(p_actor,true);
  when 'evaluation_read','candidates_save','extraction_save','request_expire','model_claim','assistant_message_save' then
    if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  when 'contact_recover','contact_redeem' then
    if p_actor->>'kind' is distinct from 'public' then raise exception 'FORBIDDEN'; end if;
    select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
    if not found or v_request.status in ('booked','declined','withdrawn','expired') or v_request.expires_at<=now() then raise exception 'NOT_FOUND'; end if;
    if p_operation='contact_recover' and lower(trim(coalesce(p_input->>'email',''))) is distinct from v_request.details->>'requesterEmail' then raise exception 'NOT_FOUND'; end if;
  when 'request_read','message_add','details_update','proposal_create','proposal_revise','requester_agree','requester_withdraw','host_decline','private_note_save','private_context_save','manual_allowance_save','preference_exception_save','contact_start','contact_confirm','request_calendar_disconnect' then
    v_request:=fmat.require_request(p_actor,(p_input->>'requestId')::uuid);
    if p_operation in ('proposal_revise','host_decline','private_note_save','private_context_save','manual_allowance_save','preference_exception_save') and p_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_operation in ('requester_agree','requester_withdraw','contact_start','contact_confirm','request_calendar_disconnect') and p_actor->>'kind'<>'guest' then raise exception 'FORBIDDEN'; end if;
    if p_operation<>'request_read' and v_request.status in ('booked','withdrawn','declined','expired') then raise exception 'REQUEST_CLOSED'; end if;
    if p_operation<>'request_read' and v_request.expires_at<=now() and v_request.status<>'booking' then raise exception 'REQUEST_EXPIRED'; end if;
  else raise exception 'UNKNOWN_OPERATION'; end case;
end;
$$;

create or replace function fmat.request_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_request fmat.requests; v_host fmat.hosts; v_details jsonb; v_id uuid; v_start timestamptz; v_end timestamptz; v_proposal jsonb; v_version integer;
  v_challenge fmat.contact_challenges; v_replay fmat.idempotency; v_scope text; v_hash text; v_encrypted text; v_purpose text; v_mode text; v_location text;
begin
  if p_operation in ('candidates_save','proposal_create','proposal_revise','requester_agree','requester_withdraw','host_decline','manual_allowance_save','preference_exception_save')
    or (p_operation='mutation_replay' and p_input->>'operation' in ('proposal_create','proposal_revise','requester_withdraw','host_decline','manual_allowance_save','preference_exception_save')) then raise exception 'FORBIDDEN';end if;
  perform fmat.request_authorize(p_operation,p_actor,p_input);
  if p_operation='mutation_replay' then
    if jsonb_typeof(p_input->'clientInput') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input->'clientInput') k where k not in ('requestId','expectedRevision','start','end','mode','location','edge','durationMinutes','confirmed','proposalVersion','reason','idempotencyKey','patch','reviewedRevision')) then raise exception 'INVALID_INPUT'; end if;
    if p_input->'clientInput'->>'requestId' is distinct from p_input->>'requestId' then raise exception 'INVALID_INPUT'; end if;
    v_scope:=p_actor->>'kind'||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash');
    select * into v_replay from fmat.idempotency where actor_scope=v_scope and operation=p_input->>'operation' and key=p_input->>'idempotencyKey';
    if not found or v_replay.result is null then return jsonb_build_object('found',false); end if;
    if p_input->>'operation'='details_update' then
      if v_replay.input->'clientInput' is distinct from p_input->'clientInput' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    elsif ((case when p_input->>'operation'='manual_allowance_save' then v_replay.input->'clientInput' else v_replay.input end) @> (p_input->'clientInput')) is not true then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('found',true,'result',v_replay.result);
  end if;
  if p_operation='request_create' then
    select * into v_host from fmat.hosts where handle=p_input->>'handle' for share;
    if not found or not fmat.host_ready(v_host) then raise exception 'NOT_FOUND'; end if;
    if coalesce(p_input->>'tokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
    v_details:=fmat.normalize_details(p_input->'details');
    insert into fmat.requests(host_id,details,token_hash,status,expires_at) values(v_host.id,v_details,p_input->>'tokenHash',case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end,fmat.request_expiry(v_details,now())) returning * into v_request;
    perform fmat.audit(p_operation,p_actor,v_request.id::text);
    return fmat.request_view(v_request.id,'{"kind":"guest"}');
  elsif p_operation='requests_list' then
    return jsonb_build_object('requests',(select coalesce(jsonb_agg(fmat.request_view(id,p_actor) order by created_at desc),'[]'::jsonb) from fmat.requests where host_id=fmat.require_host(p_actor,true)));
  elsif p_operation='request_expire' then return jsonb_build_object('expired',fmat.expire_requests()); end if;
  select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_operation='request_read' then return fmat.request_view(v_request.id,p_actor); end if;
  if p_operation in ('contact_recover','contact_redeem') then
    if v_request.status in ('booked','withdrawn','declined','expired') or v_request.expires_at<=now() then raise exception 'NOT_FOUND'; end if;
  else
    if v_request.status in ('booked','withdrawn','declined','expired') then raise exception 'REQUEST_CLOSED'; end if;
    if v_request.expires_at<=now() and v_request.status<>'booking' then raise exception 'REQUEST_EXPIRED'; end if;
  end if;
  select * into v_host from fmat.hosts where id=v_request.host_id;
  if p_operation='evaluation_read' then
    if not fmat.host_ready(v_host) then raise exception 'RECONNECT_REQUIRED'; end if;
    return jsonb_build_object('requestId',v_request.id,'hostId',v_request.host_id,'revision',v_request.revision,'details',v_request.details,'rules',v_host.rules,'rulesVersion',v_host.rules_version,'privateSchedulingContext',v_request.private_scheduling_context,
      'requesterAvailabilityMode',v_request.availability_mode,'requesterAvailabilityFailed',v_request.availability_failed,'requesterConnection',exists(select 1 from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null));
  end if;
  if p_operation not in ('contact_recover','contact_redeem') then
    if (p_input->>'expectedRevision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
    if v_request.status='booking' and p_operation<>'requester_withdraw' then raise exception 'BOOKING_PENDING'; end if;
  end if;
  case p_operation
  when 'preference_exception_save' then
    if p_input->>'confirmed' is distinct from 'true' or length(trim(coalesce(p_input->>'reason',''))) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
    if v_request.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_CONFLICT'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'STALE_EVALUATION'; end if;
    select details into strict v_proposal from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version;
    update fmat.requests set private_scheduling_context=jsonb_set(private_scheduling_context,'{preferenceException}',jsonb_build_object('proposalVersion',current_proposal_version,'rulesVersion',v_host.rules_version,'proposalDetails',v_proposal,'hostId',p_actor->>'id','confirmedAt',now(),'reason',trim(p_input->>'reason'))) where id=v_request.id;
  when 'model_claim' then
    if v_request.model_calls>=8 then return jsonb_build_object('allowed',false); end if;
    update fmat.requests set model_calls=model_calls+1 where id=v_request.id;
    return jsonb_build_object('allowed',true);
  when 'assistant_message_save' then
    if length(trim(coalesce(p_input->>'text',''))) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.request_messages(request_id,role,audience,text,actor) values(v_request.id,'assistant','shared',trim(p_input->>'text'),p_actor);
  when 'private_context_save','manual_allowance_save' then
    if p_operation='private_context_save' then
      if jsonb_typeof(p_input->'physicalContext') is distinct from 'array' or jsonb_array_length(p_input->'physicalContext')>10
        or length(coalesce(p_input->>'candidatePhysicalLocation',''))>2000 then raise exception 'INVALID_INPUT'; end if;
      for v_details in select value from jsonb_array_elements(p_input->'physicalContext') loop
        if length(coalesce(v_details->>'location','')) not between 1 and 2000 or coalesce(v_details->>'at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'INVALID_INPUT'; end if;
      end loop;
      update fmat.requests set private_scheduling_context=jsonb_build_object('physicalContext',p_input->'physicalContext','candidatePhysicalLocation',p_input->>'candidatePhysicalLocation','manualTravelAllowances','[]'::jsonb) where id=v_request.id;
    else
      v_details:=p_input->'allowance';
      if p_input->>'confirmed' is distinct from 'true' or (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version
        or v_details->>'hostId' is distinct from p_actor->>'id' or coalesce((v_details->>'durationMinutes')::integer,0) not between 1 and 1440
        or (v_details->'context'->>'rulesVersion')::integer is distinct from v_host.rules_version
        or coalesce(v_details->'context'->'slot'->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or coalesce(v_details->'context'->'slot'->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or jsonb_array_length(coalesce(v_request.private_scheduling_context->'manualTravelAllowances','[]'::jsonb))>=20 then raise exception 'INVALID_INPUT'; end if;
      update fmat.requests set private_scheduling_context=jsonb_set(private_scheduling_context,'{manualTravelAllowances}',coalesce(private_scheduling_context->'manualTravelAllowances','[]'::jsonb)||jsonb_build_array(v_details)) where id=v_request.id;
    end if;
    update fmat.requests set candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status='negotiating' where id=v_request.id;
  when 'message_add','private_note_save' then
    if length(trim(coalesce(p_input->>'text',''))) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.request_messages(request_id,role,audience,text,actor) values(v_request.id,case when p_actor->>'kind'='guest' then 'requester' else 'host' end,
      case when p_operation='private_note_save' then 'host' else 'shared' end,trim(p_input->>'text'),p_actor-'tokenHash');
    if p_operation='private_note_save' then update fmat.requests set private_notes=trim(p_input->>'text') where id=v_request.id; end if;
  when 'details_update','extraction_save' then
    if p_operation='extraction_save' and (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'STALE_EVALUATION'; end if;
    v_details:=fmat.normalize_details(p_input->'details');
    update fmat.requests set details=v_details,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
      status=case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end,expires_at=fmat.request_expiry(v_details,created_at),
      contact_verified_email=case when v_details->>'requesterEmail'=details->>'requesterEmail' then contact_verified_email else null end where id=v_request.id;
    update fmat.contact_challenges set consumed_at=now() where request_id=v_request.id and consumed_at is null and email<>v_details->>'requesterEmail';
  when 'candidates_save' then
    if v_request.host_availability_failed then raise exception 'RECONNECT_REQUIRED'; end if;
    if v_request.availability_mode='calendar' and (v_request.availability_failed or not exists(select 1 from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null and guest_authority_key=v_request.token_hash and cardinality(selected_calendar_ids)>0)) then raise exception 'RECONNECT_REQUIRED'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version or not fmat.host_ready(v_host) then raise exception 'STALE_EVALUATION'; end if;
    if jsonb_typeof(p_input->'candidates') is distinct from 'array' or jsonb_array_length(p_input->'candidates')>300 or jsonb_typeof(coalesce(p_input->'privateDiagnostics','[]'::jsonb)) is distinct from 'array' or jsonb_typeof(coalesce(p_input->'privateTravelChecks','[]'::jsonb)) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    for v_details in select value from jsonb_array_elements(p_input->'candidates') loop
      if coalesce(v_details->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(v_details->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or (v_details->>'start')::timestamptz<=now() or (v_details->>'end')::timestamptz-(v_details->>'start')::timestamptz<>make_interval(mins=>(v_request.details->>'durationMinutes')::integer)
        or not exists(select 1 from jsonb_array_elements(v_request.details->'windows') w where (w->>'start')::timestamptz<=(v_details->>'start')::timestamptz and (w->>'end')::timestamptz>=(v_details->>'end')::timestamptz) then raise exception 'INVALID_INPUT'; end if;
    end loop;
    update fmat.requests set candidates=(select coalesce(jsonb_agg(jsonb_build_object('start',c->>'start','end',c->>'end')),'[]'::jsonb) from jsonb_array_elements(p_input->'candidates') c),private_diagnostics=coalesce(p_input->'privateDiagnostics','[]'::jsonb)||case when p_input->>'unresolved'='true' then jsonb_build_array(jsonb_build_object('code','evaluation_unresolved')) else '[]'::jsonb end,private_travel_checks=coalesce(p_input->'privateTravelChecks','[]'::jsonb),evaluated_rules_version=v_host.rules_version,evaluated_at=now() where id=v_request.id;
    if v_request.current_proposal_version is not null and not exists(select 1 from fmat.proposals p,jsonb_array_elements(p_input->'candidates') c where p.request_id=v_request.id and p.version=v_request.current_proposal_version and (p.details->>'start')::timestamptz=(c->>'start')::timestamptz and (p.details->>'end')::timestamptz=(c->>'end')::timestamptz) then
      update fmat.requests set current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=v_request.id;
    end if;
  when 'proposal_create','proposal_revise' then
    if v_request.host_availability_failed or (v_request.availability_mode='calendar' and v_request.availability_failed) then raise exception 'RECONNECT_REQUIRED'; end if;
    if not fmat.details_complete(v_request.details) then raise exception 'DETAILS_REQUIRED'; end if;
    if p_operation='proposal_create' and (v_request.evaluated_rules_version is distinct from v_host.rules_version or v_request.evaluated_at is null or v_request.evaluated_at<now()-interval '5 minutes') then raise exception 'STALE_EVALUATION'; end if;
    v_start:=(p_input->>'start')::timestamptz; v_end:=(p_input->>'end')::timestamptz;
    if p_operation='proposal_create' and not exists(select 1 from jsonb_array_elements(v_request.candidates) c where (c->>'start')::timestamptz=v_start and (c->>'end')::timestamptz=v_end) then raise exception 'CANDIDATE_INVALID'; end if;
    v_mode:=coalesce(p_input->>'mode',v_request.details->>'mode'); v_location:=coalesce(p_input->>'location',v_request.details->>'location');
    if p_operation='proposal_revise' then
      v_details:=p_input->'validatedEvidence';
      if (v_details->>'rulesVersion')::integer is distinct from v_host.rules_version or (v_details->>'requestRevision')::integer is distinct from v_request.revision
        or (v_details->>'start')::timestamptz is distinct from v_start or (v_details->>'end')::timestamptz is distinct from v_end
        or v_details->>'mode' is distinct from v_mode or v_details->>'location' is distinct from v_location then raise exception 'STALE_EVALUATION'; end if;
      v_details:=fmat.normalize_details(v_request.details||jsonb_build_object('mode',v_mode,'location',v_location));
      if not fmat.details_complete(v_details) then raise exception 'DETAILS_REQUIRED'; end if;
      if v_end-v_start<>make_interval(mins=>(v_details->>'durationMinutes')::integer) or v_start<=now()
        or not exists(select 1 from jsonb_array_elements(v_details->'windows') w where (w->>'start')::timestamptz<=v_start and (w->>'end')::timestamptz>=v_end) then raise exception 'CANDIDATE_INVALID'; end if;
      update fmat.requests set details=v_details,candidates=jsonb_build_array(jsonb_build_object('start',v_start,'end',v_end)),evaluated_rules_version=v_host.rules_version,evaluated_at=now() where id=v_request.id;
    elsif v_mode is distinct from v_request.details->>'mode' or v_location is distinct from v_request.details->>'location' then raise exception 'STALE_EVALUATION'; end if;
    select coalesce(max(version),0)+1 into v_version from fmat.proposals where request_id=v_request.id;
    v_proposal:=jsonb_build_object('version',v_version,'start',v_start,'end',v_end,'timezone',v_request.details->>'timezone','mode',v_mode,'location',v_location,
      'requesterName',v_request.details->>'requesterName','requesterEmail',v_request.details->>'requesterEmail','purpose',v_request.details->>'purpose');
    insert into fmat.proposals(request_id,version,details,rules_version) values(v_request.id,v_version,v_proposal,v_host.rules_version);
    update fmat.requests set current_proposal_version=v_version,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=v_request.id;
  when 'requester_agree' then
    if v_request.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_CONFLICT'; end if;
    if not exists(select 1 from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version and rules_version=v_host.rules_version) then raise exception 'STALE_EVALUATION'; end if;
    update fmat.requests set requester_agreed_version=current_proposal_version,status='awaiting_approval' where id=v_request.id;
  when 'requester_withdraw' then
    if v_request.status='booking' and not fmat.withdraw_allowed(v_request.id) then raise exception 'BOOKING_PENDING'; end if;
    update fmat.requests set status='withdrawn',token_revoked_at=now(),requester_agreed_version=null,host_approved_version=null where id=v_request.id;
  when 'host_decline' then update fmat.requests set status='declined',token_revoked_at=now(),host_approved_version=null where id=v_request.id;
  when 'request_calendar_disconnect' then
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=now(),updated_at=now() where principal_kind='guest' and principal_id=v_request.id;
    update fmat.requests set candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status='negotiating' where id=v_request.id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,now()),encrypted_verifier=null where actor->>'kind'='guest' and actor->>'requestId'=v_request.id::text and saved_at is null;
  when 'contact_start','contact_recover' then
    if p_operation='contact_recover' and lower(trim(coalesce(p_input->>'email',''))) is distinct from v_request.details->>'requesterEmail' then raise exception 'NOT_FOUND'; end if;
    if coalesce(v_request.details->>'requesterEmail','')='' then raise exception 'DETAILS_REQUIRED'; end if;
    v_purpose:=case when p_operation='contact_start' then 'verification' else 'recovery' end;
    v_hash:=case when p_operation='contact_start' then p_input->>'codeHash' else p_input->>'tokenHash' end;
    v_encrypted:=case when p_operation='contact_start' then p_input->>'encryptedCode' else p_input->>'encryptedToken' end;
    if coalesce(v_hash,'') !~ '^[0-9a-f]{64}$' or length(coalesce(v_encrypted,''))<20 then raise exception 'INVALID_INPUT'; end if;
    if exists(select 1 from fmat.contact_challenges where request_id=v_request.id and purpose=v_purpose and created_at>now()-interval '1 minute') then raise exception 'RATE_LIMITED'; end if;
    update fmat.contact_challenges set consumed_at=now() where request_id=v_request.id and purpose=v_purpose and consumed_at is null;
    insert into fmat.contact_challenges(request_id,email,purpose,secret_hash) values(v_request.id,v_request.details->>'requesterEmail',v_purpose,v_hash) returning id into v_id;
    insert into fmat.outbox(dedupe_key,audience,recipient,payload) values('contact:'||v_id::text,'requester',jsonb_build_object('email',v_request.details->>'requesterEmail'),
      jsonb_build_object('kind','contact_'||v_purpose,'requestId',v_request.id,'challengeId',v_id,'encryptedSecret',v_encrypted)) returning id into v_id;
    perform fmat.enqueue_job('contact_delivery','contact-delivery:'||v_id::text,jsonb_build_object('outboxId',v_id));
    if p_operation='contact_recover' then return jsonb_build_object('status','pending'); end if;
  when 'contact_confirm','contact_redeem' then
    v_purpose:=case when p_operation='contact_confirm' then 'verification' else 'recovery' end;
    v_hash:=case when p_operation='contact_confirm' then p_input->>'codeHash' else p_input->>'tokenHash' end;
    select * into v_challenge from fmat.contact_challenges where request_id=v_request.id and purpose=v_purpose and secret_hash=v_hash and consumed_at is null order by created_at desc limit 1 for update;
    if not found or v_challenge.expires_at<=now() or v_challenge.email is distinct from v_request.details->>'requesterEmail' then raise exception 'CONTACT_INVALID'; end if;
    update fmat.contact_challenges set consumed_at=now() where id=v_challenge.id;
    update fmat.requests set contact_verified_email=v_challenge.email where id=v_request.id;
    if p_operation='contact_redeem' then
      if coalesce(p_input->>'newTokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
      update fmat.requests set token_hash=p_input->>'newTokenHash',token_expires_at=now()+interval '30 days',token_revoked_at=null where id=v_request.id;
    end if;
  else raise exception 'UNKNOWN_OPERATION'; end case;
  update fmat.requests set revision=revision+1,updated_at=now() where id=v_request.id returning * into v_request;
  insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(v_request.id,v_request.revision,p_operation,p_actor-'tokenHash',v_request.current_proposal_version);
  perform fmat.audit(p_operation,p_actor,v_request.id::text,jsonb_build_object('revision',v_request.revision,'proposalVersion',v_request.current_proposal_version));
  return fmat.request_view(v_request.id,case when p_actor->>'kind'='host' then p_actor else '{"kind":"guest"}'::jsonb end);
end;
$$;

-- Outbox work is fenced by the durable job lease, never by caller-supplied delivery state.
create or replace function fmat.is_delivery_operation(p_operation text)
returns boolean language sql immutable set search_path='' as $$ select p_operation=any(array['delivery_load','delivery_dispatch','delivery_record']); $$;
create or replace function fmat.delivery_authorize(p_actor jsonb)
returns void language plpgsql set search_path='' as $$ begin
  if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
end; $$;
create or replace function fmat.delivery_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_job fmat.jobs; v_outbox fmat.outbox; v_challenge fmat.contact_challenges; v_request fmat.requests; v_outcome text; v_inactive boolean:=false;
begin
  perform fmat.delivery_authorize(p_actor);
  select * into v_job from fmat.jobs where id=(p_input->>'jobId')::uuid for update;
  if not found or v_job.status<>'running' or v_job.worker_id is distinct from p_actor->>'id'
    or v_job.lease_token is distinct from (p_input->>'leaseToken')::uuid or v_job.lease_until<=now()
    or v_job.payload->>'outboxId' is distinct from p_input->>'outboxId' or v_job.kind not in ('contact_delivery','delivery') then raise exception 'LEASE_LOST'; end if;
  select * into v_outbox from fmat.outbox where id=(p_input->>'outboxId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_outbox.payload->>'type'='booking_confirmed' and exists(select 1 from fmat.web_approval_decisions where request_id=(v_outbox.payload->>'requestId')::uuid) then raise exception 'FORBIDDEN';end if;
  if v_outbox.payload->>'kind' in ('contact_verification','contact_recovery') then
    select * into v_challenge from fmat.contact_challenges where id=(v_outbox.payload->>'challengeId')::uuid;
    select * into v_request from fmat.requests where id=v_challenge.request_id;
    if v_outbox.status not in ('sent','suppressed') and (v_challenge.id is null or v_challenge.consumed_at is not null or v_challenge.expires_at<=now()
      or v_request.id is null or v_request.status in ('booked','declined','withdrawn','expired') or v_request.expires_at<=now()
      or v_challenge.email is distinct from v_request.details->>'requesterEmail' or v_outbox.recipient->>'email' is distinct from v_challenge.email) then
      v_inactive:=true;
      update fmat.outbox set status=case when payload ? 'firstDispatchAt' then 'uncertain' else 'suppressed' end,updated_at=now(),payload=payload||jsonb_build_object('errorCode','CONTACT_EXPIRED') where id=v_outbox.id returning * into v_outbox;
    end if;
  end if;
  case p_operation
  when 'delivery_load' then null;
  when 'delivery_dispatch' then
    if not v_inactive and v_outbox.status not in ('sent','suppressed','failed') then
      if v_outbox.payload ? 'firstDispatchAt' and (v_outbox.payload->>'firstDispatchAt')::timestamptz<now()-interval '24 hours' then raise exception 'DELIVERY_RECONCILIATION_REQUIRED'; end if;
      if not(v_outbox.payload ? 'firstDispatchAt') and (length(coalesce(p_input->>'encryptedPrepared',''))<20 or length(coalesce(p_input->>'providerInboxId','')) not between 1 and 300) then raise exception 'INVALID_INPUT'; end if;
      update fmat.outbox set status='sending',updated_at=now(),payload=payload||jsonb_build_object('firstDispatchAt',coalesce(payload->>'firstDispatchAt',now()::text),'encryptedPrepared',coalesce(payload->>'encryptedPrepared',p_input->>'encryptedPrepared'),'providerInboxId',coalesce(payload->>'providerInboxId',p_input->>'providerInboxId')) where id=v_outbox.id returning * into v_outbox;
    end if;
  when 'delivery_record' then
    v_outcome:=p_input->>'outcome';
    if v_outcome not in ('sent','uncertain','failed','suppressed') or v_outcome is null or length(coalesce(p_input->>'providerReference',''))>500 or length(coalesce(p_input->>'errorCode',''))>100 then raise exception 'INVALID_INPUT'; end if;
    if not v_inactive and v_outbox.status not in ('sent','suppressed') then
      if v_outcome in ('sent','uncertain') and not(v_outbox.payload ? 'firstDispatchAt') then raise exception 'INVALID_INPUT'; end if;
      update fmat.outbox set status=v_outcome,provider_reference=p_input->>'providerReference',updated_at=now(),payload=payload||jsonb_build_object('errorCode',p_input->>'errorCode') where id=v_outbox.id returning * into v_outbox;
    end if;
  else raise exception 'UNKNOWN_OPERATION'; end case;
  return jsonb_build_object('actionable',not v_inactive,'id',v_outbox.id,'dedupeKey',v_outbox.dedupe_key,'status',v_outbox.status,'recipientEmail',v_outbox.recipient->>'email','payload',v_outbox.payload,'firstDispatchAt',v_outbox.payload->>'firstDispatchAt','providerReference',v_outbox.provider_reference,'encryptedPrepared',v_outbox.payload->>'encryptedPrepared','providerInboxId',v_outbox.payload->>'providerInboxId');
end;
$$;

create or replace function fmat.is_request_operation(p_operation text)
returns boolean language sql immutable set search_path='' as $$
 select p_operation=any(array['mutation_replay','request_create','requests_list','request_read','message_add','details_update','evaluation_read','candidates_save','extraction_save','proposal_create','proposal_revise','requester_agree','requester_withdraw','host_decline','private_note_save','private_context_save','manual_allowance_save','preference_exception_save','contact_start','contact_confirm','contact_recover','contact_redeem','request_calendar_disconnect','request_expire','model_claim','assistant_message_save']);
$$;
create or replace function fmat.onboarding_request_authorize(p_operation text,p_actor jsonb,p_input jsonb)
returns void language plpgsql set search_path='' as $$
declare v_exchange fmat.oauth_exchanges; v_guest_id uuid;
begin
  perform fmat.onboarding_authorize(p_operation,p_actor,p_input);
  if p_operation='oauth_start' and p_actor->>'kind'='guest' then v_guest_id:=(p_actor->>'requestId')::uuid;
  elsif p_operation='oauth_consume' then
    select * into v_exchange from fmat.oauth_exchanges where state_hash=p_input->>'stateHash';
    if v_exchange.actor->>'kind'='guest' then v_guest_id:=(v_exchange.actor->>'requestId')::uuid; end if;
  elsif p_operation='credential_save' then
    select * into v_exchange from fmat.oauth_exchanges where id=(p_input->>'exchangeId')::uuid;
    if v_exchange.actor->>'kind'='guest' then v_guest_id:=(v_exchange.actor->>'requestId')::uuid; end if;
  end if;
  if v_guest_id is not null and exists(select 1 from fmat.requests where id=v_guest_id and status='booking') then raise exception 'BOOKING_PENDING'; end if;
end;
$$;
-- Requester consent changes scheduling context atomically with credential persistence.
create or replace function fmat.onboarding_request_dispatch(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_result jsonb; v_exchange fmat.oauth_exchanges;
begin
  perform fmat.onboarding_request_authorize(p_operation,p_actor,p_input);
  v_result:=fmat.onboarding_command(p_operation,p_actor,p_input);
  if p_operation='credential_save' then
    select * into strict v_exchange from fmat.oauth_exchanges where id=(p_input->>'exchangeId')::uuid;
    if v_exchange.actor->>'kind'='guest' then
      update fmat.requests set revision=revision+1,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,
        evaluated_at=null,evaluated_rules_version=null,status=case when fmat.details_complete(details) then 'negotiating' else 'gathering' end,updated_at=now()
        where id=(v_exchange.actor->>'requestId')::uuid;
    end if;
  end if;
  return v_result;
end;
$$;
create or replace function fmat.dispatch_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
begin
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then return fmat.foundation_command(p_operation,p_actor,p_input); end if;
  if fmat.is_delivery_operation(p_operation) then return fmat.delivery_command(p_operation,p_actor,p_input); end if;
  if fmat.is_request_operation(p_operation) then return fmat.request_command(p_operation,p_actor,p_input); end if;
  return fmat.onboarding_request_dispatch(p_operation,p_actor,p_input);
end;
$$;
create or replace function fmat.authorize_command(p_operation text,p_actor jsonb,p_input jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then
    if p_actor->>'kind' not in ('worker','operator') or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  elsif fmat.is_delivery_operation(p_operation) then perform fmat.delivery_authorize(p_actor);
  elsif fmat.is_request_operation(p_operation) then perform fmat.request_authorize(p_operation,p_actor,p_input);
  else perform fmat.onboarding_request_authorize(p_operation,p_actor,p_input); end if;
end;
$$;
create or replace function public.fmat_command(p_operation text,p_actor jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scope text; v_key text; v_record fmat.idempotency; v_result jsonb; v_identity_input jsonb;
begin
  if p_operation in ('candidates_save','proposal_create','proposal_revise','requester_agree','requester_withdraw','host_decline','manual_allowance_save','preference_exception_save')
    or (p_operation='mutation_replay' and p_input->>'operation' in ('proposal_create','proposal_revise','requester_withdraw','host_decline','manual_allowance_save','preference_exception_save')) then raise exception 'FORBIDDEN';end if;
  if jsonb_typeof(p_actor) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object'
    or p_actor->>'kind' is null or p_actor->>'kind' not in ('host','guest','worker','operator','public') then raise exception 'INVALID_INPUT'; end if;
  perform fmat.authorize_command(p_operation,p_actor,p_input);
  if p_operation like 'jobs_%' or p_operation in ('oauth_consume','credential_save','token_update','oauth_cleanup','host_public','setup_read','calendar_read','requests_list','request_read','connection_read','evaluation_read','candidates_save','extraction_save','assistant_message_save','model_claim','request_expire','mutation_replay','delivery_load','delivery_dispatch','delivery_record') then return fmat.dispatch_command(p_operation,p_actor,p_input); end if;
  v_key:=p_input->>'idempotencyKey';
  if v_key is null or length(v_key) not between 1 and 200 then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  v_scope:=coalesce(p_actor->>'kind','')||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash',p_actor->>'email','public');
  v_identity_input:=case when p_operation='oauth_start' then jsonb_build_object('context',p_input->'context','idempotencyKey',v_key) when p_operation='contact_start' then p_input-'encryptedCode' when p_operation='contact_recover' then p_input-'encryptedToken' when p_operation='manual_allowance_save' then jsonb_set(p_input,'{allowance}',(p_input->'allowance')-'confirmedAt') else p_input end;
  insert into fmat.idempotency(actor_scope,operation,key,input) values(v_scope,p_operation,v_key,v_identity_input) on conflict do nothing;
  select * into strict v_record from fmat.idempotency where actor_scope=v_scope and operation=p_operation and key=v_key for update;
  if v_record.input<>v_identity_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_record.result is not null then
    if p_operation='oauth_start' and not exists(select 1 from fmat.oauth_exchanges where id=(v_record.result->>'exchangeId')::uuid and consumed_at is null and expires_at>now()) then raise exception 'OAUTH_STATE_INVALID'; end if;
    if p_operation='request_create' and not exists(select 1 from fmat.requests r join fmat.hosts h on h.id=r.host_id where r.id=(v_record.result->>'id')::uuid and r.token_hash=p_input->>'tokenHash' and r.token_revoked_at is null and r.expires_at>now() and fmat.host_ready(h)) then raise exception 'REQUEST_CLOSED'; end if;
    if p_operation='contact_redeem' and not exists(select 1 from fmat.requests where id=(p_input->>'requestId')::uuid and token_hash=p_input->>'newTokenHash' and token_revoked_at is null and expires_at>now()) then raise exception 'CONTACT_INVALID'; end if;
    return v_record.result;
  end if;
  v_result:=fmat.dispatch_command(p_operation,p_actor,p_input);
  update fmat.idempotency set result=v_result where actor_scope=v_scope and operation=p_operation and key=v_key;
  return v_result;
end;
$$;
revoke all on all tables in schema fmat from public,anon,authenticated,service_role;
revoke execute on all functions in schema fmat from public,anon,authenticated,service_role;
revoke execute on function public.fmat_command(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_command(text,jsonb,jsonb) to service_role;

select fmat.install_request_runtime();
