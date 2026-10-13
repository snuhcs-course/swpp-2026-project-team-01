SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE TABLE "fmat"."photon_link_attempts" (
  "challenge_id" uuid NOT NULL,
  "key"          uuid NOT NULL,
  "code_hash"    text NOT NULL,
  "outcome"      text NOT NULL,
  CONSTRAINT "photon_link_attempts_outcome_check" CHECK ((outcome = ANY (ARRAY['invalid_code'::text, 'linked'::text]))),
  CONSTRAINT "photon_link_attempts_pkey" PRIMARY KEY (challenge_id, key)
);

ALTER TABLE "fmat"."photon_link_attempts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."photon_link_challenges" (
  "id"                 uuid                     NOT NULL,
  "host_id"            uuid                     NOT NULL,
  "project_id"         uuid                     NOT NULL,
  "credential"         jsonb                    NOT NULL,
  "browser_hash"       text                     NOT NULL,
  "phone"              text                     NOT NULL,
  "line"               text                     NOT NULL,
  "space_id"           text                     NOT NULL,
  "code_hash"          text                     NOT NULL,
  "encrypted_code"     text,
  "request_key"        uuid                     NOT NULL,
  "failed_attempts"    integer                  NOT NULL DEFAULT 0,
  "delivery_status"    text                     NOT NULL DEFAULT 'prepared'::text,
  "provider_reference" text,
  "lease_token"        uuid,
  "lease_until"        timestamp with time zone,
  "checked_at"         timestamp with time zone,
  "created_at"         timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  "expires_at"         timestamp with time zone NOT NULL DEFAULT (statement_timestamp() + '00:10:00'::interval),
  "consumed_at"        timestamp with time zone,
  "revoked_at"         timestamp with time zone,
  CONSTRAINT "photon_link_challenges_browser_hash_check" CHECK ((browser_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "photon_link_challenges_check" CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:10:00'::interval)))),
  CONSTRAINT "photon_link_challenges_code_hash_check" CHECK ((code_hash ~ '^[a-f0-9]{64}$'::text)),
  CONSTRAINT "photon_link_challenges_delivery_status_check"
    CHECK ((delivery_status = ANY (ARRAY['prepared'::text, 'uncertain'::text, 'accepted'::text, 'delivered'::text, 'failed'::text, 'revoked'::text]))),
  CONSTRAINT "photon_link_challenges_failed_attempts_check" CHECK (((failed_attempts >= 0) AND (failed_attempts <= 5))),
  CONSTRAINT "photon_link_challenges_host_id_request_key_key" UNIQUE (host_id, request_key),
  CONSTRAINT "photon_link_challenges_line_check" CHECK (((length(line) >= 1) AND (length(line) <= 512))),
  CONSTRAINT "photon_link_challenges_phone_check" CHECK ((phone ~ '^\+[1-9][0-9]{7,14}$'::text)),
  CONSTRAINT "photon_link_challenges_pkey" PRIMARY KEY (id),
  CONSTRAINT "photon_link_challenges_space_id_check" CHECK (((length(space_id) >= 1) AND (length(space_id) <= 512)))
);

ALTER TABLE "fmat"."photon_link_challenges"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."photon_link_preferences" (
  "host_id" uuid    NOT NULL,
  "skipped" boolean NOT NULL DEFAULT false,
  CONSTRAINT "photon_link_preferences_pkey" PRIMARY KEY (host_id)
);

ALTER TABLE "fmat"."photon_link_preferences"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."photon_links" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_id"      uuid                     NOT NULL,
  "project_id"   uuid                     NOT NULL,
  "phone"        text                     NOT NULL,
  "line"         text                     NOT NULL,
  "space_id"     text                     NOT NULL,
  "challenge_id" uuid                     NOT NULL,
  "linked_at"    timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "revoked_at"   timestamp with time zone,
  CONSTRAINT "photon_links_challenge_id_key" UNIQUE (challenge_id),
  CONSTRAINT "photon_links_pkey" PRIMARY KEY (id)
);

ALTER TABLE "fmat"."photon_links"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.photon_link_view (
  p_host         uuid,
  p_project      uuid,
  p_browser_hash text,
  p_session      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare c fmat.photon_link_challenges; l fmat.photon_links;
begin
 select * into l from fmat.photon_links where host_id=p_host and revoked_at is null;
 select * into c from fmat.photon_link_challenges where host_id=p_host and consumed_at is null and revoked_at is null order by created_at desc limit 1;
 return jsonb_build_object('available',exists(select 1 from fmat.photon_receivers where project_id=p_project and enabled),
 'skipped',coalesce((select skipped from fmat.photon_link_preferences where host_id=p_host),false),
 'link',case when l.id is null then null else jsonb_build_object('id',l.id,'maskedPhone','••••'||right(l.phone,4),'linkedAt',l.linked_at) end,
 'challenge',case when c.id is null then null else jsonb_build_object('id',c.id,'maskedPhone','••••'||right(c.phone,4),
 'expiresAt',c.expires_at,'retryAfter',c.created_at+interval '1 minute','remainingAttempts',5-c.failed_attempts,
 'sameBrowser',coalesce(c.browser_hash=p_browser_hash and c.credential->>'sessionId'=p_session,false),
 'status',case when c.expires_at<=clock_timestamp() then 'expired' when c.failed_attempts>=5 then 'locked' else c.delivery_status end) end);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.wake_photon_links()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_url text; v_secret text;
begin
 if not exists(select 1 from fmat.photon_link_challenges where consumed_at is null and revoked_at is null
  and delivery_status in ('prepared','uncertain','accepted') and (lease_until is null or lease_until<=clock_timestamp())
  and (checked_at is null or checked_at<clock_timestamp()-interval '30 seconds')) then return null; end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
 if v_url is null or v_secret is null then return null; end if;
 if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION'; end if;
 v_url:=replace(v_url,'/api/internal/conversations/dispatch','/api/internal/photon/dispatch');
 return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_photon_link (
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
declare actor jsonb; host uuid; c fmat.photon_link_challenges; a fmat.photon_link_attempts; l fmat.photon_links; outcome text;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN'; end if;
 actor:=fmat.calendar_actor(p_credential);host:=(actor->>'id')::uuid;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 if p_operation='read' then return fmat.photon_link_view(host,p_project_id,p_input->>'browserHash',p_credential->>'sessionId'); end if;
 if p_operation in ('start','start_replay') then
  if coalesce(p_input->>'phone','')!~'^\+[1-9][0-9]{7,14}$' or coalesce(p_input->>'browserHash','')!~'^[a-f0-9]{64}$' or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT'; end if;
  select * into c from fmat.photon_link_challenges where host_id=host and request_key=(p_input->>'idempotencyKey')::uuid;
  if found then
   if c.phone<>p_input->>'phone' or c.browser_hash<>p_input->>'browserHash' or c.project_id is distinct from p_project_id or c.credential->>'sessionId' is distinct from p_credential->>'sessionId' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return fmat.photon_link_view(host,p_project_id,p_input->>'browserHash',p_credential->>'sessionId');
  end if;
  if p_operation='start_replay' then return null; end if;
  perform 1 from fmat.photon_receivers where project_id=p_project_id and enabled for share;
  if not found then raise exception 'CONFIGURATION_UNAVAILABLE'; end if;
  if exists(select 1 from fmat.photon_links where host_id=host and revoked_at is null) then raise exception 'LINK_CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('photon-link:'||p_project_id::text||':'||(p_input->>'phone'),0));
  if exists(select 1 from fmat.photon_link_challenges where (host_id=host or (project_id=p_project_id and phone=p_input->>'phone')) and created_at>clock_timestamp()-interval '1 minute')
   or (select count(*) from fmat.photon_link_challenges where host_id=host and created_at>clock_timestamp()-interval '1 hour')>=5
   or (select count(*) from fmat.photon_link_challenges where project_id=p_project_id and phone=p_input->>'phone' and created_at>clock_timestamp()-interval '1 hour')>=5 then raise exception 'IMESSAGE_LIMIT'; end if;
  if coalesce(p_input->>'codeHash','')!~'^[a-f0-9]{64}$' or length(coalesce(p_input->>'encryptedCode','')) not between 30 and 1024
   or coalesce(p_input->>'line','')='' or p_input->>'spaceId' is distinct from 'any;-;'||(p_input->>'phone') then raise exception 'INVALID_INPUT'; end if;
  update fmat.photon_link_challenges set revoked_at=clock_timestamp(),encrypted_code=null where host_id=host and consumed_at is null and revoked_at is null;
  insert into fmat.photon_link_challenges(id,host_id,project_id,credential,browser_hash,phone,line,space_id,code_hash,encrypted_code,request_key)
   values((p_input->>'challengeId')::uuid,host,p_project_id,p_credential,p_input->>'browserHash',p_input->>'phone',p_input->>'line',p_input->>'spaceId',p_input->>'codeHash',p_input->>'encryptedCode',(p_input->>'idempotencyKey')::uuid) returning * into c;
  insert into fmat.photon_link_preferences(host_id,skipped) values(host,false) on conflict(host_id) do update set skipped=false;
  -- This row is also the durable outbound intent. Its lease and scheduled
  -- sweep own recovery; no second queue/job lifecycle can trigger a resend.
 elsif p_operation='verify' then
  if coalesce(p_input->>'codeHash','')!~'^[a-f0-9]{64}$' or p_input->>'idempotencyKey' is null then raise exception 'INVALID_INPUT'; end if;
  perform 1 from fmat.photon_receivers where project_id=p_project_id and enabled for share;
  if not found then raise exception 'CONFIGURATION_UNAVAILABLE'; end if;
  select * into c from fmat.photon_link_challenges where id=(p_input->>'challengeId')::uuid and host_id=host and project_id=p_project_id for update;
  if not found or c.browser_hash is distinct from p_input->>'browserHash' or c.credential->>'sessionId' is distinct from p_credential->>'sessionId'
   or c.revoked_at is not null then raise exception 'CHALLENGE_INVALID'; end if;
  select * into a from fmat.photon_link_attempts where challenge_id=c.id and key=(p_input->>'idempotencyKey')::uuid;
  if found then
   if a.code_hash is distinct from p_input->>'codeHash' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   if a.outcome='linked' and not exists(select 1 from fmat.photon_links where challenge_id=c.id and revoked_at is null) then raise exception 'CHALLENGE_INVALID'; end if;
   return fmat.photon_link_view(host,p_project_id,p_input->>'browserHash',p_credential->>'sessionId')||jsonb_build_object('outcome',a.outcome);
  end if;
  if c.expires_at<=clock_timestamp() or c.consumed_at is not null or c.failed_attempts>=5 or c.delivery_status not in ('uncertain','accepted','delivered') then raise exception 'CHALLENGE_INVALID'; end if;
  if c.code_hash is distinct from p_input->>'codeHash' then
   update fmat.photon_link_challenges set failed_attempts=failed_attempts+1,encrypted_code=case when failed_attempts=4 then null else encrypted_code end where id=c.id;outcome:='invalid_code';
  else
   perform pg_advisory_xact_lock(hashtextextended('photon-link:'||c.project_id::text||':'||c.phone,0));
   if exists(select 1 from fmat.photon_links where revoked_at is null and (host_id=host or (project_id=c.project_id and phone=c.phone))) then raise exception 'LINK_CONFLICT'; end if;
   insert into fmat.photon_links(host_id,project_id,phone,line,space_id,challenge_id) values(host,c.project_id,c.phone,c.line,c.space_id,c.id) returning * into l;
   update fmat.photon_link_challenges set consumed_at=clock_timestamp(),encrypted_code=null where id=c.id;
   perform fmat.audit('photon_link',actor,l.id::text);outcome:='linked';
  end if;
  insert into fmat.photon_link_attempts(challenge_id,key,code_hash,outcome) values(c.id,(p_input->>'idempotencyKey')::uuid,p_input->>'codeHash',outcome);
 elsif p_operation in ('cancel','skip') then
  update fmat.photon_link_challenges set revoked_at=clock_timestamp(),encrypted_code=null where host_id=host and consumed_at is null and revoked_at is null
   and (p_operation='skip' or id=(p_input->>'challengeId')::uuid);
  if p_operation='skip' then insert into fmat.photon_link_preferences(host_id,skipped) values(host,true) on conflict(host_id) do update set skipped=true; end if;
 elsif p_operation='unlink' then
  update fmat.photon_links set revoked_at=clock_timestamp() where id=(p_input->>'linkId')::uuid and host_id=host and revoked_at is null returning * into l;
  if found then perform fmat.audit('photon_unlink',actor,l.id::text); end if;
 else raise exception 'INVALID_INPUT'; end if;
 return fmat.photon_link_view(host,p_project_id,p_input->>'browserHash',p_credential->>'sessionId')||case when outcome is null then '{}'::jsonb else jsonb_build_object('outcome',outcome) end;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_link"(text, jsonb, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_photon_link_delivery (
  p_operation  text,
  p_project_id uuid,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare c fmat.photon_link_challenges; actor jsonb; valid boolean; action text; result jsonb:='[]'; candidate uuid;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 if p_operation='claim' then
  -- Select oldest-due work first, then lock its hosts in consistent order.
  for candidate in select due.id from (select id,host_id from fmat.photon_link_challenges where project_id=p_project_id and consumed_at is null and revoked_at is null
   and (lease_until is null or lease_until<clock_timestamp()) and delivery_status in ('prepared','uncertain','accepted')
   and (checked_at is null or checked_at<clock_timestamp()-interval '30 seconds') order by checked_at nulls first,created_at,id limit 5) due order by due.host_id,due.id loop
   select * into c from fmat.photon_link_challenges where id=candidate;
   valid:=true;
   begin
    actor:=fmat.calendar_actor(c.credential);
   exception when raise_exception then
    if sqlerrm in ('UNAUTHORIZED','FORBIDDEN','HOST_NOT_ADMITTED','NOT_FOUND') then valid:=false; else raise; end if;
   end;
   select * into c from fmat.photon_link_challenges where id=candidate for update skip locked;
   if not found or c.consumed_at is not null or c.revoked_at is not null or (c.lease_until is not null and c.lease_until>clock_timestamp())
    or c.delivery_status not in ('prepared','uncertain','accepted')
    or (c.checked_at is not null and c.checked_at>=clock_timestamp()-interval '30 seconds') then continue; end if;
   if not valid or c.expires_at<=clock_timestamp() or c.failed_attempts>=5 or not exists(select 1 from fmat.photon_receivers where project_id=p_project_id and enabled) then
    update fmat.photon_link_challenges set revoked_at=clock_timestamp(),encrypted_code=null,delivery_status='revoked' where id=c.id;continue;
   end if;
   action:=case when c.delivery_status='prepared' then 'send' else 'reconcile' end;
   update fmat.photon_link_challenges set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',checked_at=clock_timestamp(),
    delivery_status=case when action='send' then 'uncertain' else delivery_status end where id=c.id returning * into c;
   result:=result||jsonb_build_array(jsonb_build_object('challengeId',c.id,'hostId',c.host_id,'projectId',c.project_id,'phone',c.phone,'line',c.line,'spaceId',c.space_id,
    'encryptedCode',case when action='send' then c.encrypted_code else null end,'providerReference',c.provider_reference,'leaseToken',c.lease_token,'action',action));
  end loop;return result;
 end if;
 select * into c from fmat.photon_link_challenges where id=(p_input->>'challengeId')::uuid and project_id=p_project_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_operation='authorize' then
  actor:=fmat.calendar_actor(c.credential);
  perform 1 from fmat.photon_receivers where project_id=p_project_id and enabled for share;
  if not found then raise exception 'FORBIDDEN'; end if;
 end if;
 select * into c from fmat.photon_link_challenges where id=c.id for update;
 if c.lease_token is null or c.lease_until is null or c.lease_token is distinct from (p_input->>'leaseToken')::uuid or c.lease_until<=clock_timestamp() then raise exception 'REVISION_CONFLICT'; end if;
 if p_operation='authorize' then
  if c.consumed_at is not null or c.revoked_at is not null or c.expires_at<=clock_timestamp() or c.failed_attempts>=5 then raise exception 'FORBIDDEN'; end if;
  return '{}'::jsonb;
 elsif p_operation='finish' then
  if p_input->>'status' is null or p_input->>'status' not in ('accepted','delivered','failed','uncertain') then raise exception 'INVALID_INPUT'; end if;
  update fmat.photon_link_challenges set delivery_status=case when revoked_at is not null then 'revoked' when delivery_status='accepted' and p_input->>'status'='uncertain' then 'accepted' else p_input->>'status' end,
   provider_reference=coalesce(p_input->>'providerReference',provider_reference),lease_until=null,lease_token=null,
   encrypted_code=case when p_input->>'status' in ('failed','delivered') then null else encrypted_code end where id=c.id;
  return '{}'::jsonb;
 end if;
 raise exception 'INVALID_INPUT';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_link_delivery"(text, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."photon_link_challenges"
  ADD CONSTRAINT "photon_link_challenges_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."photon_link_attempts"
  ADD CONSTRAINT "photon_link_attempts_challenge_id_fkey" FOREIGN KEY (challenge_id) REFERENCES fmat.photon_link_challenges(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."photon_link_challenges"
  ADD CONSTRAINT "photon_link_challenges_project_id_fkey" FOREIGN KEY (project_id) REFERENCES fmat.photon_receivers(project_id);

ALTER TABLE "fmat"."photon_link_preferences"
  ADD CONSTRAINT "photon_link_preferences_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."photon_links"
  ADD CONSTRAINT "photon_links_challenge_id_fkey" FOREIGN KEY (challenge_id) REFERENCES fmat.photon_link_challenges(id);

ALTER TABLE "fmat"."photon_links"
  ADD CONSTRAINT "photon_links_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."photon_links"
  ADD CONSTRAINT "photon_links_project_id_fkey" FOREIGN KEY (project_id) REFERENCES fmat.photon_receivers(project_id);

CREATE INDEX photon_link_challenges_host_idx ON fmat.photon_link_challenges USING btree (host_id, created_at DESC);

CREATE INDEX photon_link_challenges_pending_idx ON fmat.photon_link_challenges USING btree (project_id, created_at)
  WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX photon_link_challenges_phone_idx ON fmat.photon_link_challenges USING btree (project_id, phone, created_at DESC);

CREATE UNIQUE INDEX photon_links_host_idx ON fmat.photon_links USING btree (host_id)
  WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX photon_links_phone_idx ON fmat.photon_links USING btree (project_id, phone)
  WHERE (revoked_at IS NULL);

REVOKE ALL ON FUNCTION "fmat"."wake_photon_links"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_photon_link"(text, jsonb, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_link"(text, jsonb, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_link"(text, jsonb, uuid, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_photon_link_delivery"(text, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_link_delivery"(text, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_link_delivery"(text, uuid, jsonb) TO "service_role";

SELECT cron.schedule_in_database('fmat-photon-links', '* * * * *', 'select fmat.wake_photon_links();', 'postgres', NULL, true);
