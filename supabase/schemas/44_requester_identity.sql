create table fmat.requester_identity_flows (
 id uuid primary key,
 kind text not null check(kind in ('intake','guest')),
 target text not null,
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
 state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
 binding_hash text not null check(binding_hash ~ '^[a-f0-9]{64}$'),
 encrypted_verifier text,
 draft jsonb not null,
 request_revision integer,
 identity jsonb,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
 draft_expires_at timestamptz not null default clock_timestamp()+interval '1 day',
 consumed_at timestamptz,
 saved_at timestamptz,
 superseded_at timestamptz,
 proof_applied_at timestamptz
);
create index requester_identity_scope_idx on fmat.requester_identity_flows(kind,target,token_hash,created_at desc);
alter table fmat.requester_identity_flows enable row level security;
revoke all on fmat.requester_identity_flows from public,anon,authenticated,service_role;

-- Caller must hold the intake advisory lock and newly-created request row.
-- Proof is scoped to the exact originating token/handle and reviewed email.
create or replace function fmat.apply_intake_identity(p_request uuid,p_handle text,p_token_hash text)
returns void language plpgsql set search_path='' as $$
declare r fmat.requests; f fmat.requester_identity_flows;
begin
 select * into strict r from fmat.requests where id=p_request for update;
 if r.token_hash is distinct from p_token_hash or not exists(select 1 from fmat.hosts where id=r.host_id and handle=p_handle)
  or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp()
  or r.status not in ('gathering','negotiating','awaiting_approval') then raise exception 'NOT_FOUND';end if;
 select * into f from fmat.requester_identity_flows where kind='intake' and target=p_handle and token_hash=p_token_hash order by created_at desc,id desc limit 1 for update;
 if f.id is null or f.superseded_at is not null or f.saved_at is null or f.saved_at<=clock_timestamp()-interval '1 hour'
  or f.identity->>'contactVerified' is distinct from 'true' or f.identity->>'email' is distinct from r.details->>'requesterEmail' then return;end if;
 if r.contact_verified_email is not distinct from r.details->>'requesterEmail' then return;end if;
 update fmat.requests set contact_verified_email=r.details->>'requesterEmail' where id=r.id;
 update fmat.requester_identity_flows set proof_applied_at=clock_timestamp() where id=f.id;
 perform fmat.audit('google_contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.id::text,jsonb_build_object('flowId',f.id));
end;
$$;
revoke all on function fmat.apply_intake_identity(uuid,text,text) from public,anon,authenticated,service_role;

create or replace function public.fmat_requester_identity(p_operation text,p_authority jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f fmat.requester_identity_flows; r fmat.requests; v_kind text; v_target text; v_hash text; v_return text; v_identity jsonb;
begin
 if p_operation is null or p_operation not in ('lookup','read','start','consume','save','skip','apply') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation='lookup' then
  select * into f from fmat.requester_identity_flows where state_hash=p_input->>'stateHash';
  if not found or f.binding_hash is distinct from p_input->>'bindingHash' or f.expires_at<=clock_timestamp() or f.consumed_at is not null or f.superseded_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
  return jsonb_build_object('kind',f.kind,'target',f.target);
 end if;
 v_kind:=p_authority->>'kind';v_hash:=p_authority->>'tokenHash';
 if coalesce(v_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'UNAUTHORIZED';end if;
 if v_kind='intake' then
  v_target:=p_authority->>'handle';
  if coalesce(v_target,'') !~ '^[a-z][a-z0-9-]{2,39}$' then raise exception 'INVALID_INPUT';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-intake:'||v_hash,0));
  -- A submitted or rotated intake cannot be reused as an unbound identity draft.
  if exists(select 1 from fmat.requests where token_hash=v_hash) or exists(select 1 from fmat.idempotency where actor_scope='public:'||v_hash and operation='request_create' and result is not null) then raise exception 'NOT_FOUND';end if;
  if not exists(select 1 from fmat.hosts h join auth.users u on u.id=h.id where h.handle=v_target and fmat.host_ready(h) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and u.email_confirmed_at is not null) then raise exception 'NOT_FOUND';end if;
  v_return:='/'||v_target;
 elsif v_kind='guest' then
  v_target:=p_authority->>'requestId';
  select * into r from fmat.requests where id=v_target::uuid for update;
  if not found or r.token_hash is distinct from v_hash or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp()
   or r.status not in ('gathering','negotiating','awaiting_approval') then raise exception 'NOT_FOUND';end if;
  v_return:='/booking/'||r.id::text;
 else raise exception 'FORBIDDEN';end if;
 -- Request first, then scope/flow locks. Intake creation uses the same scope lock.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requester-identity:'||v_kind||':'||v_target||':'||v_hash,0));
 select * into f from fmat.requester_identity_flows where kind=v_kind and target=v_target and token_hash=v_hash order by created_at desc,id desc limit 1 for update;
 if p_operation='start' then
  if coalesce(p_input->>'stateHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'bindingHash','') !~ '^[a-f0-9]{64}$'
   or length(coalesce(p_input->>'encryptedVerifier','')) not between 20 and 16384 or jsonb_typeof(p_input->'draft') is distinct from 'object'
   or octet_length((p_input->'draft')::text)>16384 then raise exception 'INVALID_INPUT';end if;
  if v_kind='guest' and r.revision is distinct from (p_input->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
  if (select count(*) from fmat.requester_identity_flows where kind=v_kind and target=v_target and token_hash=v_hash and created_at>clock_timestamp()-interval '10 minutes')>=10 then raise exception 'CONSENT_LIMIT';end if;
  update fmat.requester_identity_flows set superseded_at=clock_timestamp(),encrypted_verifier=null where kind=v_kind and target=v_target and token_hash=v_hash and superseded_at is null;
  insert into fmat.requester_identity_flows(id,kind,target,token_hash,state_hash,binding_hash,encrypted_verifier,draft,request_revision)
   values((p_input->>'flowId')::uuid,v_kind,v_target,v_hash,p_input->>'stateHash',p_input->>'bindingHash',p_input->>'encryptedVerifier',p_input->'draft',r.revision);
  return jsonb_build_object('started',true);
 end if;
 if p_operation='skip' then
  update fmat.requester_identity_flows set superseded_at=clock_timestamp(),encrypted_verifier=null where kind=v_kind and target=v_target and token_hash=v_hash and superseded_at is null;
  return jsonb_build_object('skipped',true);
 end if;
 if p_operation='read' then
  if f.id is null or f.draft_expires_at<=clock_timestamp() then return null;end if;
  return jsonb_build_object('draft',f.draft,'identity',case when f.superseded_at is null and f.saved_at>clock_timestamp()-interval '1 hour' then f.identity-'subject' else null end);
 end if;
 if f.id is null or f.superseded_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
 if p_operation in ('consume','save') then
  if f.expires_at<=clock_timestamp() or (v_kind='guest' and f.request_revision is distinct from r.revision) then raise exception 'OAUTH_STATE_INVALID';end if;
  if p_operation='consume' then
   if f.state_hash is distinct from p_input->>'stateHash' or f.binding_hash is distinct from p_input->>'bindingHash' or f.consumed_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
   update fmat.requester_identity_flows set consumed_at=clock_timestamp(),encrypted_verifier=null where id=f.id;
   return jsonb_build_object('flowId',f.id,'returnPath',v_return,'encryptedVerifier',f.encrypted_verifier);
  end if;
  if f.id is distinct from (p_input->>'flowId')::uuid or f.consumed_at is null then raise exception 'OAUTH_STATE_INVALID';end if;
  v_identity:=p_input->'identity';
  if jsonb_typeof(v_identity) is distinct from 'object' or length(coalesce(v_identity->>'subject','')) not between 1 and 300
   or length(coalesce(v_identity->>'email','')) not between 3 and 254 or v_identity->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or v_identity->>'email'<>lower(v_identity->>'email') or jsonb_typeof(v_identity->'contactVerified') is distinct from 'boolean'
   or length(coalesce(v_identity->>'name',''))>200 or exists(select 1 from jsonb_object_keys(v_identity) k where k not in ('subject','email','name','contactVerified')) then raise exception 'INVALID_INPUT';end if;
  if f.saved_at is not null then
   if f.identity is distinct from v_identity then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return jsonb_build_object('saved',true);
  end if;
  update fmat.requester_identity_flows set identity=v_identity,saved_at=clock_timestamp() where id=f.id;
  return jsonb_build_object('saved',true);
 end if;
 -- The browser explicitly applies proof only to its current reviewed recipient.
 if v_kind<>'guest' then raise exception 'FORBIDDEN';end if;
 if f.saved_at is null or f.saved_at<=clock_timestamp()-interval '1 hour' or f.identity->>'contactVerified' is distinct from 'true' then raise exception 'CONTACT_NOT_VERIFIED';end if;
 if f.identity->>'email' is distinct from r.details->>'requesterEmail' or p_input->>'email' is distinct from r.details->>'requesterEmail' then raise exception 'REVISION_CONFLICT';end if;
 if f.proof_applied_at is not null then
  if r.contact_verified_email=r.details->>'requesterEmail' then return jsonb_build_object('verified',true,'revision',r.revision);end if;
  raise exception 'OAUTH_STATE_INVALID';
 end if;
 if r.revision is distinct from (p_input->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
 update fmat.requests set contact_verified_email=r.details->>'requesterEmail',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
 update fmat.requester_identity_flows set proof_applied_at=clock_timestamp() where id=f.id;
 insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'google_contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.current_proposal_version);
 perform fmat.audit('google_contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.id::text,jsonb_build_object('flowId',f.id));
 return jsonb_build_object('verified',true,'revision',r.revision);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;
$$;
revoke all on function public.fmat_requester_identity(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_requester_identity(text,jsonb,jsonb) to service_role;
