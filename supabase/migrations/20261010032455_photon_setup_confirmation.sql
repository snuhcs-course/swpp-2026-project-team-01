SET local check_function_bodies = off;

CREATE TABLE "fmat"."photon_setup_confirmations" (
  "review_id"  uuid                     NOT NULL,
  "inbox_id"   uuid                     NOT NULL,
  "check_id"   uuid                     NOT NULL,
  "result"     jsonb                    NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_setup_confirmations_check_id_key" UNIQUE (check_id),
  CONSTRAINT "photon_setup_confirmations_inbox_id_key" UNIQUE (inbox_id),
  CONSTRAINT "photon_setup_confirmations_pkey" PRIMARY KEY (review_id),
  CONSTRAINT "photon_setup_confirmations_result_check" CHECK ((jsonb_typeof(result) = 'object'::text))
);

ALTER TABLE "fmat"."photon_setup_confirmations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."photon_setup_permission_checks" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "inbox_id"      uuid                     NOT NULL,
  "review_id"     uuid                     NOT NULL,
  "connection_id" uuid                     NOT NULL,
  "generation"    uuid                     NOT NULL,
  "expires_at"    timestamp with time zone NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_setup_permission_checks_check" CHECK ((expires_at > created_at)),
  CONSTRAINT "photon_setup_permission_checks_pkey" PRIMARY KEY (id)
);

ALTER TABLE "fmat"."photon_setup_permission_checks"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.photon_setup_confirmation_replay (
  p_inbox  uuid,
  p_review uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; review fmat.photon_setup_reviews; actor jsonb; result jsonb;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found then raise exception 'UNAUTHORIZED';end if;
 actor:=fmat.photon_execution_actor(jsonb_build_object('kind','photon','linkId',i.link_id,'inboxId',i.id,'receiverId',i.receiver_id));
 if lower(btrim(i.text,E' \t\r\n\f'||chr(11))) is distinct from 'confirm setup '||p_review::text then raise exception 'FORBIDDEN';end if;
 select * into review from fmat.photon_setup_reviews where id=p_review;
 if review.id is null or review.host_id::text is distinct from actor->>'id'
  or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id
  then raise exception 'FORBIDDEN';end if;
 -- Replays acknowledge an already committed decision, never a newer draft.
 -- Require the original decision input; a new message must obtain a new review.
 select c.result into result from fmat.photon_setup_confirmations c where c.review_id=p_review and c.inbox_id=p_inbox;
 if result is null and exists(select 1 from fmat.photon_setup_confirmations where review_id=p_review) then raise exception 'REVISION_CONFLICT';end if;
 return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_photon_setup (
  p_operation text,
  p_inbox_id  uuid,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare review_id uuid; check_id uuid; evidence fmat.photon_setup_permission_checks;
 context jsonb; prior jsonb; g fmat.calendar_connections; i fmat.photon_inbox;
 actor jsonb; state jsonb; result jsonb; calendar jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation='review' then
  if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
  return fmat.photon_setup_review_start(p_inbox_id);
 elsif p_operation='publish' then
  if not (p_input ?& array['reviewId','text']) or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('reviewId','text')) or jsonb_typeof(p_input->'text') is distinct from 'string' then raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('text',fmat.photon_setup_review_publish(p_inbox_id,(p_input->>'reviewId')::uuid,p_input->>'text'));
 elsif p_operation='begin_confirmation' then
  if not (p_input ? 'reviewId') or exists(select 1 from jsonb_object_keys(p_input) k where k<>'reviewId') then raise exception 'INVALID_INPUT';end if;
  review_id:=(p_input->>'reviewId')::uuid;
 elsif p_operation in ('refresh','finish_confirmation') then
  if not (p_input ? 'checkId') then raise exception 'INVALID_INPUT';end if;
  if p_operation='refresh' and (not (p_input ?& array['previousCredential','encryptedCredential']) or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('checkId','previousCredential','encryptedCredential'))) then raise exception 'INVALID_INPUT';end if;
  if p_operation='finish_confirmation' and (not (p_input ? 'verifiedCalendars') or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('checkId','verifiedCalendars'))) then raise exception 'INVALID_INPUT';end if;
  check_id:=(p_input->>'checkId')::uuid;
  select * into evidence from fmat.photon_setup_permission_checks where id=check_id;
  if evidence.id is null or evidence.inbox_id is distinct from p_inbox_id then raise exception 'FORBIDDEN';end if;
  review_id:=evidence.review_id;
 else raise exception 'INVALID_INPUT';end if;
 prior:=fmat.photon_setup_confirmation_replay(p_inbox_id,review_id);
 if prior is not null then return jsonb_build_object('status','confirmed','receipt',prior);end if;
 context:=fmat.photon_setup_review_check(p_inbox_id,review_id);
 select * into strict g from fmat.calendar_connections where id=(context->>'connectionId')::uuid for update;
 -- Both helpers recheck authority after waits. The host lock serializes setup
 -- edits and confirmations; the grant lock also fences refresh/replacement.
 perform fmat.photon_setup_review_check(p_inbox_id,review_id);
 if not (g.scopes @> array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events']) then raise exception 'RECONNECT_REQUIRED';end if;
 if p_operation='begin_confirmation' then
  insert into fmat.photon_setup_permission_checks(inbox_id,review_id,connection_id,generation,expires_at)
   values(p_inbox_id,review_id,g.id,g.generation,least(clock_timestamp()+interval '30 seconds',(context->>'expiresAt')::timestamptz)) returning id into check_id;
  return jsonb_build_object('status','checking','checkId',check_id,'hostId',context->'hostId',
   'providerSubject',g.provider_subject,'encryptedCredential',g.encrypted_credential);
 end if;
 if evidence.expires_at<=clock_timestamp() or evidence.connection_id<>g.id or evidence.generation<>g.generation then raise exception 'REVISION_CONFLICT';end if;
 if p_operation='refresh' then
  if jsonb_typeof(p_input->'previousCredential') is distinct from 'string' or jsonb_typeof(p_input->'encryptedCredential') is distinct from 'string'
   or length(p_input->>'encryptedCredential') not between 32 and 131072 then raise exception 'INVALID_INPUT';end if;
  if g.encrypted_credential is distinct from p_input->>'previousCredential' then raise exception 'REVISION_CONFLICT';end if;
  update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=g.id;
  return jsonb_build_object('status','refreshed');
 end if;
 if jsonb_typeof(p_input->'verifiedCalendars') is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
 if jsonb_array_length(p_input->'verifiedCalendars') not between 1 and 2500 then raise exception 'INVALID_INPUT';end if;
 for calendar in select value from jsonb_array_elements(p_input->'verifiedCalendars') loop
  if jsonb_typeof(calendar) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
  if jsonb_typeof(calendar->'id') is distinct from 'string' or length(calendar->>'id') not between 1 and 1024
   or jsonb_typeof(calendar->'accessRole') is distinct from 'string'
   or calendar->>'accessRole' not in ('freeBusyReader','reader','writer','writerWithoutPrivateAccess','owner')
   or exists(select 1 from jsonb_object_keys(calendar) k where k not in ('id','accessRole')) then raise exception 'INVALID_INPUT';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c group by c->>'id' having count(*)>1) then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from jsonb_array_elements_text(context->'conflictCalendarIds') selected where not exists(
  select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=selected))
  or not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=context->>'bookingCalendarId' and c->>'accessRole' in ('writer','writerWithoutPrivateAccess','owner')) then raise exception 'CALENDAR_ACCESS_INVALID';end if;
 select * into strict i from fmat.photon_inbox where id=p_inbox_id;
 actor:=fmat.photon_execution_actor(jsonb_build_object('kind','photon','linkId',i.link_id,'inboxId',i.id,'receiverId',i.receiver_id));
 state:=context->'state';
 state:=fmat.host_setup_operation('confirm',actor,jsonb_build_object('expectedRevision',state->'revision',
  'draftRevision',state->'draft'->'revision','reviewRevision',state->'review'->'revision',
  'rulesVersion',state->'rulesVersion','calendarGeneration',g.generation,'confirmed',true,'idempotencyKey',review_id),'host');
 result:=jsonb_build_object('confirmed',true,'reviewId',review_id,'revision',state->'revision','rulesVersion',state->'rulesVersion','savedAt',clock_timestamp());
 insert into fmat.photon_setup_confirmations(review_id,inbox_id,check_id,result) values(review_id,p_inbox_id,check_id,result);
 return jsonb_build_object('status','confirmed','receipt',result);
exception when invalid_text_representation then raise exception 'INVALID_INPUT';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_setup"(text, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."photon_setup_confirmations"
  ADD CONSTRAINT "photon_setup_confirmations_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.photon_inbox(id);

ALTER TABLE "fmat"."photon_setup_confirmations"
  ADD CONSTRAINT "photon_setup_confirmations_review_id_fkey" FOREIGN KEY (review_id) REFERENCES fmat.photon_setup_reviews(id);

ALTER TABLE "fmat"."photon_setup_permission_checks"
  ADD CONSTRAINT "photon_setup_permission_checks_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES fmat.calendar_connections(id);

ALTER TABLE "fmat"."photon_setup_permission_checks"
  ADD CONSTRAINT "photon_setup_permission_checks_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.photon_inbox(id);

ALTER TABLE "fmat"."photon_setup_confirmations"
  ADD CONSTRAINT "photon_setup_confirmations_check_id_fkey" FOREIGN KEY (check_id) REFERENCES fmat.photon_setup_permission_checks(id);

ALTER TABLE "fmat"."photon_setup_permission_checks"
  ADD CONSTRAINT "photon_setup_permission_checks_review_id_fkey" FOREIGN KEY (review_id) REFERENCES fmat.photon_setup_reviews(id);

CREATE INDEX photon_setup_permission_checks_connection_idx ON fmat.photon_setup_permission_checks USING btree (connection_id);

CREATE INDEX photon_setup_permission_checks_inbox_idx ON fmat.photon_setup_permission_checks USING btree (inbox_id);

CREATE INDEX photon_setup_permission_checks_review_idx ON fmat.photon_setup_permission_checks USING btree (review_id);

CREATE TRIGGER photon_setup_confirmations_immutable
  BEFORE UPDATE ON fmat.photon_setup_confirmations
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

CREATE TRIGGER photon_setup_permission_checks_immutable
  BEFORE UPDATE ON fmat.photon_setup_permission_checks
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "fmat"."photon_setup_confirmation_replay"(uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_photon_setup"(text, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_setup"(text, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_setup"(text, uuid, jsonb) TO "service_role";
