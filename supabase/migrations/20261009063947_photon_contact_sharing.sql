SET local check_function_bodies = off;

CREATE TABLE "fmat"."photon_contact_request_keys" (
  "host_id"     uuid NOT NULL,
  "request_key" uuid NOT NULL,
  "share_id"    uuid NOT NULL,
  CONSTRAINT "photon_contact_request_keys_pkey" PRIMARY KEY (host_id, request_key)
);

ALTER TABLE "fmat"."photon_contact_request_keys"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."photon_contact_shares" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "link_id"       uuid                     NOT NULL,
  "host_id"       uuid                     NOT NULL,
  "project_id"    uuid                     NOT NULL,
  "credential"    jsonb                    NOT NULL,
  "phone"         text                     NOT NULL,
  "line"          text                     NOT NULL,
  "space_id"      text                     NOT NULL,
  "status"        text                     NOT NULL DEFAULT 'queued'::text,
  "attempts"      integer                  NOT NULL DEFAULT 0,
  "available_at"  timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "lease_token"   uuid,
  "lease_until"   timestamp with time zone,
  "dispatched_at" timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_contact_shares_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 3))),
  CONSTRAINT "photon_contact_shares_check1" CHECK (((lease_token IS NULL) = (lease_until IS NULL))),
  CONSTRAINT "photon_contact_shares_check2" CHECK (((status = ANY (ARRAY['dispatching'::text, 'accepted'::text, 'uncertain'::text])) = (dispatched_at IS NOT NULL))),
  CONSTRAINT "photon_contact_shares_check3" CHECK (((status = ANY (ARRAY['queued'::text, 'dispatching'::text])) OR (lease_token IS NULL))),
  CONSTRAINT "photon_contact_shares_check" CHECK ((space_id = ('any;-;'::text || phone))),
  CONSTRAINT "photon_contact_shares_line_check" CHECK (((length(line) >= 1) AND (length(line) <= 512))),
  CONSTRAINT "photon_contact_shares_link_id_key" UNIQUE (link_id),
  CONSTRAINT "photon_contact_shares_phone_check" CHECK ((phone ~ '^\+[1-9][0-9]{7,14}$'::text)),
  CONSTRAINT "photon_contact_shares_pkey" PRIMARY KEY (id),
  CONSTRAINT "photon_contact_shares_status_check"
    CHECK ((status = ANY (ARRAY['queued'::text, 'dispatching'::text, 'accepted'::text, 'failed'::text, 'revoked'::text, 'uncertain'::text])))
);

ALTER TABLE "fmat"."photon_contact_shares"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.photon_contact_authorized (
  p_share fmat.photon_contact_shares
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare actor jsonb; l fmat.photon_links;
begin
 if p_share.credential->>'kind' is distinct from 'host' or p_share.credential->>'subject' is distinct from p_share.host_id::text then return false;end if;
 actor:=fmat.calendar_actor(p_share.credential);
 perform 1 from fmat.photon_receivers where project_id=p_share.project_id and enabled for share;
 if not found then return false;end if;
 select * into l from fmat.photon_links where id=p_share.link_id for share;
 if not found or l.revoked_at is not null or l.host_id<>p_share.host_id or l.project_id<>p_share.project_id
  or l.phone<>p_share.phone or l.line<>p_share.line or l.space_id<>p_share.space_id then return false;end if;
 perform fmat.calendar_actor(p_share.credential);
 return true;
exception when raise_exception then
 if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','NOT_FOUND','HOST_NOT_ADMITTED') then return false;end if;
 raise;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_contact_view (
  p_share fmat.photon_contact_shares
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
 select case when p_share.id is null then null else jsonb_build_object('id',p_share.id,'linkId',p_share.link_id,
  'status',case when p_share.status='dispatching' then 'uncertain' else p_share.status end,
  'requestedAt',p_share.created_at) end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_photon_contact (
  p_operation  text,
  p_credential jsonb,
  p_project_id uuid,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor jsonb; host uuid; l fmat.photon_links; s fmat.photon_contact_shares; prior uuid;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN';end if;
 actor:=fmat.calendar_actor(p_credential);host:=(actor->>'id')::uuid;
 if p_operation not in ('read','request') or p_operation is null or jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_input->'linkId') is distinct from 'string'
  or (p_operation='read' and (p_input-'linkId')<>'{}'::jsonb)
  or (p_operation='request' and ((p_input-'linkId'-'idempotencyKey')<>'{}'::jsonb or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string')) then raise exception 'INVALID_INPUT';end if;
 -- Host authority before receiver/link locks matches existing link commands.
 if p_operation='request' then
  perform 1 from fmat.photon_receivers where project_id=p_project_id and enabled for share;
  if not found then raise exception 'CONFIGURATION_UNAVAILABLE';end if;
 end if;
 select * into l from fmat.photon_links where id=(p_input->>'linkId')::uuid and host_id=host and project_id=p_project_id and revoked_at is null for share;
 if not found then raise exception 'NOT_FOUND';end if;
 actor:=fmat.calendar_actor(p_credential); -- deadlines after any lock wait
 select * into s from fmat.photon_contact_shares where link_id=l.id;
 if p_operation='read' then return fmat.photon_contact_view(s);end if;
 select share_id into prior from fmat.photon_contact_request_keys where host_id=host and request_key=(p_input->>'idempotencyKey')::uuid;
 if found and prior is distinct from s.id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 if s.id is null then
  insert into fmat.photon_contact_shares(link_id,host_id,project_id,credential,phone,line,space_id)
   values(l.id,host,l.project_id,p_credential,l.phone,l.line,l.space_id) returning * into s;
  insert into fmat.audit_events(operation,actor,subject_id,metadata)
   values('photon_contact_requested',jsonb_build_object('kind','host','id',host),s.id::text,jsonb_build_object('linkId',l.id));
 end if;
 insert into fmat.photon_contact_request_keys(host_id,request_key,share_id)
  values(host,(p_input->>'idempotencyKey')::uuid,s.id) on conflict(host_id,request_key) do nothing;
 return fmat.photon_contact_view(s);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_contact"(text, jsonb, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_photon_contact_delivery (
  p_operation  text,
  p_project_id uuid,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare s fmat.photon_contact_shares; valid boolean; outcome text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or p_operation is null or p_operation not in ('claim','dispatch','finish') then raise exception 'INVALID_INPUT';end if;
 if p_operation='claim' then
  if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
  select * into s from fmat.photon_contact_shares where project_id=p_project_id and status in ('queued','dispatching')
   and available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) order by available_at,id limit 1;
  if not found then return jsonb_build_object('action','idle');end if;
 else
  if jsonb_typeof(p_input->'shareId') is distinct from 'string' or jsonb_typeof(p_input->'leaseToken') is distinct from 'string'
   or (p_operation='dispatch' and (p_input-'shareId'-'leaseToken')<>'{}'::jsonb)
   or (p_operation='finish' and ((p_input-'shareId'-'leaseToken'-'status')<>'{}'::jsonb or jsonb_typeof(p_input->'status') is distinct from 'string')) then raise exception 'INVALID_INPUT';end if;
  select * into s from fmat.photon_contact_shares where id=(p_input->>'shareId')::uuid and project_id=p_project_id;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 -- Never lock an intent before waiting on host authority. Finish and uncertain
 -- recovery take only the intent lock and do not acquire authority afterward.
 if s.status='queued' and p_operation in ('claim','dispatch') then valid:=fmat.photon_contact_authorized(s);end if;
 select * into s from fmat.photon_contact_shares where id=s.id for update;
 if p_operation='claim' then
  if s.status not in ('queued','dispatching') or s.available_at>clock_timestamp() or s.lease_until>clock_timestamp() then return jsonb_build_object('action','idle');end if;
  if s.status='dispatching' then outcome:='uncertain';
  elsif not valid then outcome:='revoked';
  elsif s.attempts>=3 then outcome:='failed';
  else
   -- Repeat time-sensitive checks after waiting for the intent lock.
   if not fmat.photon_contact_authorized(s) then outcome:='revoked';end if;
  end if;
  if outcome is not null then
   update fmat.photon_contact_shares set status=outcome,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=s.id;
   insert into fmat.audit_events(operation,actor,subject_id,metadata) values('photon_contact_settled','{"kind":"system"}',s.id::text,jsonb_build_object('status',outcome));
   return jsonb_build_object('action',outcome);
  end if;
  update fmat.photon_contact_shares set attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() where id=s.id returning * into s;
  return jsonb_build_object('action','send','shareId',s.id,'projectId',s.project_id,'leaseToken',s.lease_token,'phone',s.phone,'line',s.line,'spaceId',s.space_id);
 end if;
 if s.lease_token is null or s.lease_token is distinct from (p_input->>'leaseToken')::uuid or s.lease_until<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='dispatch' then
  -- A repeated dispatch acknowledgement must never authorize a second call.
  if s.status<>'queued' then raise exception 'REVISION_CONFLICT';end if;
  if not valid or not fmat.photon_contact_authorized(s) then
   update fmat.photon_contact_shares set status='revoked',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=s.id;
   insert into fmat.audit_events(operation,actor,subject_id,metadata) values('photon_contact_settled','{"kind":"system"}',s.id::text,'{"status":"revoked"}');
   return jsonb_build_object('authorized',false);
  end if;
  update fmat.photon_contact_shares set status='dispatching',dispatched_at=clock_timestamp(),updated_at=clock_timestamp() where id=s.id;
  insert into fmat.audit_events(operation,actor,subject_id,metadata) values('photon_contact_dispatched','{"kind":"system"}',s.id::text,'{}');
  return jsonb_build_object('authorized',true);
 end if;
 outcome:=p_input->>'status';
 if s.status='dispatching' then
  if outcome not in ('accepted','uncertain') then raise exception 'INVALID_INPUT';end if;
 elsif s.status='queued' then
  if outcome not in ('retry','failed','revoked') then raise exception 'INVALID_INPUT';end if;
  if outcome='retry' then outcome:=case when s.attempts>=3 then 'failed' else 'queued' end;end if;
 else raise exception 'REVISION_CONFLICT';end if;
 update fmat.photon_contact_shares set status=outcome,lease_token=null,lease_until=null,available_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() where id=s.id;
 insert into fmat.audit_events(operation,actor,subject_id,metadata) values('photon_contact_settled','{"kind":"system"}',s.id::text,jsonb_build_object('status',outcome));
 return '{}'::jsonb;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_contact_delivery"(text, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."photon_contact_request_keys"
  ADD CONSTRAINT "photon_contact_request_keys_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."photon_contact_shares"
  ADD CONSTRAINT "photon_contact_shares_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."photon_contact_shares"
  ADD CONSTRAINT "photon_contact_shares_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.photon_links(id);

ALTER TABLE "fmat"."photon_contact_request_keys"
  ADD CONSTRAINT "photon_contact_request_keys_share_id_fkey" FOREIGN KEY (share_id) REFERENCES fmat.photon_contact_shares(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."photon_contact_shares"
  ADD CONSTRAINT "photon_contact_shares_project_id_fkey" FOREIGN KEY (project_id) REFERENCES fmat.photon_receivers(project_id);

CREATE INDEX photon_contact_request_keys_share_idx ON fmat.photon_contact_request_keys USING btree (share_id);

CREATE INDEX photon_contact_shares_due_idx ON fmat.photon_contact_shares USING btree (project_id, available_at, id)
  WHERE (status = ANY (ARRAY['queued'::text, 'dispatching'::text]));

CREATE INDEX photon_contact_shares_host_idx ON fmat.photon_contact_shares USING btree (host_id);

REVOKE ALL ON FUNCTION "public"."fmat_photon_contact"(text, jsonb, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_contact"(text, jsonb, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_contact"(text, jsonb, uuid, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_photon_contact_delivery"(text, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_contact_delivery"(text, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_contact_delivery"(text, uuid, jsonb) TO "service_role";
