SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fmat_invitation_operator (
  p_operation text,
  p_operator  text,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
#variable_conflict use_variable
-- Column references that share command-local names are explicitly qualified.
declare scope text; record fmat.idempotency; invitation fmat.invitations; delivery fmat.invitation_deliveries;
 id uuid; key uuid; email text; project text; mode text; issued timestamptz; actor jsonb;
begin
 if p_operator is null or p_operator !~ '^[a-zA-Z0-9@._+-]{1,100}$' then raise exception 'FORBIDDEN';end if;
 if p_operation is null or p_operation not in ('issue','status','revoke','recover') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
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
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('project','invitationId','idempotencyKey')) or (p_operation in ('status','recover') and p_input ? 'idempotencyKey') then raise exception 'INVALID_INPUT';end if;
  begin id:=(p_input->>'invitationId')::uuid;exception when invalid_text_representation then raise exception 'INVALID_INPUT';end;
  if id is null then raise exception 'INVALID_INPUT';end if;
 end if;
 if p_operation in ('issue','revoke') then
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
 if p_operation='recover' then
  if invitation.revoked_at is not null or invitation.redeemed_at is not null or invitation.expires_at<=clock_timestamp() or invitation.email is distinct from delivery.recipient or invitation.issued_by is distinct from delivery.operator_id then raise exception 'INVITATION_INVALID';end if;
  perform fmat.audit('invitation_manual_recovery',actor,id::text,jsonb_build_object('project',project));
  return jsonb_build_object('invitationId',id,'project',delivery.project,'operator',delivery.operator_id,'email',delivery.recipient,'idempotencyKey',delivery.issue_key,'delivery',delivery.mode,'origin',delivery.origin,'tokenHash',invitation.token_hash,'expiresAt',invitation.expires_at);
 end if;
 if p_operation='revoke' and record.result is null then
  update fmat.invitations set revoked_at=coalesce(revoked_at,clock_timestamp()) where fmat.invitations.id=id;
  update fmat.invitation_deliveries set phase='suppressed' where invitation_id=id and phase in ('pending','prepared');
  perform fmat.audit('invitation_revoke',actor,id::text,jsonb_build_object('project',project));
 end if;
 if p_operation in ('issue','revoke') and record.result is null then
  update fmat.idempotency set result=jsonb_build_object('invitationId',id) where actor_scope=scope and operation='invitation_'||p_operation and fmat.idempotency.key=key::text;
 end if;
 return fmat.invitation_status(id);
end$function$;

