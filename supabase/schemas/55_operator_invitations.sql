-- Service-only operator lifecycle. A readable invitation code is never stored.
create table fmat.invitation_deliveries (
 invitation_id uuid primary key references fmat.invitations(id),
 project text not null check(project='local' or project ~ '^[a-z]{20}$'),
 operator_id text not null check(operator_id ~ '^[a-zA-Z0-9@._+-]{1,100}$'),
 issue_key uuid not null,
 recipient text not null,
 origin text not null,
 mode text not null check(mode in ('manual','cloudflare')),
 account_id text,
 template_version integer not null default 1 check(template_version=1),
 phase text not null check(phase in ('manual','pending','prepared','dispatched','sent','failed','suppressed','uncertain')),
 provider_reference text,
 created_at timestamptz not null default clock_timestamp(),
 unique(project,operator_id,issue_key),
 check((mode='manual' and account_id is null) or (mode='cloudflare' and account_id is not null and account_id ~ '^[a-f0-9]{32}$')),
 check(project<>'local' or mode='manual')
);
alter table fmat.invitation_deliveries enable row level security;
revoke all on fmat.invitation_deliveries from public,anon,authenticated,service_role;
create or replace function fmat.protect_invitation_delivery_context()
returns trigger language plpgsql set search_path='' as $$
begin
 if (new.invitation_id,new.project,new.operator_id,new.issue_key,new.recipient,new.origin,new.mode,new.account_id,new.template_version,new.created_at)
  is distinct from (old.invitation_id,old.project,old.operator_id,old.issue_key,old.recipient,old.origin,old.mode,old.account_id,old.template_version,old.created_at) then raise exception 'IMMUTABLE_DELIVERY';end if;
 return new;
end$$;
revoke all on function fmat.protect_invitation_delivery_context() from public,anon,authenticated,service_role;
create trigger invitation_delivery_context_immutable before update on fmat.invitation_deliveries for each row execute function fmat.protect_invitation_delivery_context();

create or replace function fmat.invitation_status(p_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare i fmat.invitations; d fmat.invitation_deliveries;
begin
 select * into strict i from fmat.invitations where id=p_id;
 select * into strict d from fmat.invitation_deliveries where invitation_id=p_id;
 return jsonb_build_object('invitationId',i.id,'email',i.email,'expiresAt',i.expires_at,
  'status',case when i.redeemed_at is not null then 'redeemed' when i.revoked_at is not null then 'revoked' when i.expires_at<=clock_timestamp() then 'expired' else 'active' end,
  'revoked',i.revoked_at is not null,'delivery',d.mode,'deliveryStatus',d.phase);
end$$;
revoke all on function fmat.invitation_status(uuid) from public,anon,authenticated,service_role;

create or replace function public.fmat_invitation_operator(p_operation text,p_operator text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
-- Column references that share command-local names are explicitly qualified.
declare scope text; record fmat.idempotency; invitation fmat.invitations; delivery fmat.invitation_deliveries;
 id uuid; key uuid; email text; project text; mode text; issued timestamptz; actor jsonb;
begin
 if p_operator is null or p_operator !~ '^[a-zA-Z0-9@._+-]{1,100}$' then raise exception 'FORBIDDEN';end if;
 if p_operation is null or p_operation not in ('issue','status','revoke') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 project:=p_input->>'project';
 if project is null or (project<>'local' and project !~ '^[a-z]{20}$') then raise exception 'INVALID_INPUT';end if;
 actor:=jsonb_build_object('kind','operator','id',p_operator);
 if p_operation='issue' then
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('project','email','idempotencyKey','delivery','tokenHash','origin','accountId')) then raise exception 'INVALID_INPUT';end if;
  email:=p_input->>'email';mode:=p_input->>'delivery';
  if email is null or email<>lower(trim(email)) or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or mode is null or mode not in ('manual','cloudflare') or (project='local' and mode<>'manual')
   or coalesce(p_input->>'tokenHash','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_input->>'origin','') !~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?$' and not(project='local' and coalesce(p_input->>'origin','') ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$')
   or (mode='cloudflare' and coalesce(p_input->>'accountId','') !~ '^[a-f0-9]{32}$')
   or (mode='manual' and p_input->>'accountId' is not null) then raise exception 'INVALID_INPUT';end if;
 else
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('project','invitationId','idempotencyKey')) or (p_operation='status' and p_input ? 'idempotencyKey') then raise exception 'INVALID_INPUT';end if;
  begin id:=(p_input->>'invitationId')::uuid;exception when invalid_text_representation then raise exception 'INVALID_INPUT';end;
  if id is null then raise exception 'INVALID_INPUT';end if;
 end if;
 if p_operation<>'status' then
  begin key:=(p_input->>'idempotencyKey')::uuid;exception when invalid_text_representation then raise exception 'INVALID_INPUT';end;
  if key is null then raise exception 'INVALID_INPUT';end if;
  scope:='invitation_operator:'||project||':'||p_operator;
  insert into fmat.idempotency(actor_scope,operation,key,input) values(scope,'invitation_'||p_operation,key::text,p_input) on conflict do nothing;
  select * into strict record from fmat.idempotency where actor_scope=scope and operation='invitation_'||p_operation and fmat.idempotency.key=key::text for update;
  if record.input is distinct from p_input then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  if record.result is not null then id:=(record.result->>'invitationId')::uuid;end if;
 end if;
 if p_operation='issue' and record.result is null then
  issued:=clock_timestamp();
  insert into fmat.invitations(email,token_hash,expires_at,issued_by,created_at) values(email,p_input->>'tokenHash',issued+interval '7 days',p_operator,issued) returning fmat.invitations.id into id;
  insert into fmat.invitation_deliveries(invitation_id,project,operator_id,issue_key,recipient,origin,mode,account_id,phase)
   values(id,project,p_operator,key,email,p_input->>'origin',mode,p_input->>'accountId',case when mode='manual' then 'manual' else 'pending' end);
  if mode='cloudflare' then perform fmat.enqueue_job('invitation_delivery','invitation-delivery:'||id::text,jsonb_build_object('invitationId',id));end if;
  perform fmat.audit('invitation_issue',actor,id::text,jsonb_build_object('project',project,'delivery',mode));
 end if;
 -- Lock order for dispatch will be job, invitation, delivery. Never acquire a job here.
 select * into invitation from fmat.invitations where fmat.invitations.id=id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into delivery from fmat.invitation_deliveries where invitation_id=id and fmat.invitation_deliveries.project=project for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_operation='revoke' and record.result is null then
  update fmat.invitations set revoked_at=coalesce(revoked_at,clock_timestamp()) where fmat.invitations.id=id;
  update fmat.invitation_deliveries set phase='suppressed' where invitation_id=id and phase in ('pending','prepared');
  perform fmat.audit('invitation_revoke',actor,id::text,jsonb_build_object('project',project));
 end if;
 if p_operation<>'status' and record.result is null then
  update fmat.idempotency set result=jsonb_build_object('invitationId',id) where actor_scope=scope and operation='invitation_'||p_operation and fmat.idempotency.key=key::text;
 end if;
 return fmat.invitation_status(id);
end$$;
revoke all on function public.fmat_invitation_operator(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_invitation_operator(text,text,jsonb) to service_role;
