SET local check_function_bodies = off;

CREATE TABLE "fmat"."photon_setup_review_publications" (
  "review_id"  uuid                     NOT NULL,
  "reply_id"   uuid                     NOT NULL,
  "text"       text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_setup_review_publications_pkey" PRIMARY KEY (review_id),
  CONSTRAINT "photon_setup_review_publications_reply_id_key" UNIQUE (reply_id),
  CONSTRAINT "photon_setup_review_publications_text_check" CHECK (((length(text) >= 1) AND (length(text) <= 4000)))
);

ALTER TABLE "fmat"."photon_setup_review_publications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."photon_setup_reviews" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "inbox_id"        uuid                     NOT NULL,
  "host_id"         uuid                     NOT NULL,
  "conversation_id" uuid                     NOT NULL,
  "link_id"         uuid                     NOT NULL,
  "receiver_id"     uuid                     NOT NULL,
  "snapshot"        jsonb                    NOT NULL,
  "expires_at"      timestamp with time zone NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "photon_setup_reviews_check" CHECK ((expires_at > created_at)),
  CONSTRAINT "photon_setup_reviews_inbox_id_key" UNIQUE (inbox_id),
  CONSTRAINT "photon_setup_reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "photon_setup_reviews_snapshot_check" CHECK ((jsonb_typeof(snapshot) = 'object'::text))
);

ALTER TABLE "fmat"."photon_setup_reviews"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.photon_setup_context (
  p_inbox uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; actor jsonb; h fmat.hosts; c fmat.setup_conversations; g fmat.calendar_connections; state jsonb;
begin
 select * into i from fmat.photon_inbox where id=p_inbox;
 if not found then raise exception 'UNAUTHORIZED';end if;
 actor:=fmat.photon_execution_actor(jsonb_build_object('kind','photon','linkId',i.link_id,'inboxId',i.id,'receiverId',i.receiver_id));
 select * into strict h from fmat.hosts where id=(actor->>'id')::uuid;
 c:=fmat.ensure_setup_conversation(h.id);
 select * into strict c from fmat.setup_conversations where id=c.id for update;
 select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=h.id and revoked_at is null for share;
 -- Recheck current identity after setup/connection lock waits.
 perform fmat.photon_execution_actor(jsonb_build_object('kind','photon','linkId',i.link_id,'inboxId',i.id,'receiverId',i.receiver_id));
 state:=fmat.host_setup_view(h.id);
 return jsonb_build_object('hostId',h.id,'conversationId',c.id,'state',state,
  'connectionId',g.id,'conflictCalendarIds',to_jsonb(h.conflict_calendar_ids),'bookingCalendarId',h.booking_calendar_id);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_setup_review_check (
  p_inbox  uuid,
  p_review uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; original fmat.photon_inbox; review fmat.photon_setup_reviews; context jsonb;
begin
 context:=fmat.photon_setup_context(p_inbox);
 select * into strict i from fmat.photon_inbox where id=p_inbox;
 if lower(btrim(i.text,E' \t\r\n\f'||chr(11))) is distinct from 'confirm setup '||p_review::text then raise exception 'FORBIDDEN';end if;
 select * into review from fmat.photon_setup_reviews where id=p_review;
 if review.id is null or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id
  or review.host_id::text is distinct from context->>'hostId' or review.conversation_id::text is distinct from context->>'conversationId'
  then raise exception 'FORBIDDEN';end if;
 select * into strict original from fmat.photon_inbox where id=review.inbox_id;
 if i.received_order<=original.received_order or i.received_at<review.created_at
  or review.snapshot is distinct from context or review.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 perform fmat.photon_execution_actor(jsonb_build_object('kind','photon','linkId',original.link_id,'inboxId',original.id,'receiverId',original.receiver_id));
 -- A formatted record alone is not proof the host was shown the summary.
 -- Match the frozen reply text while retained; delivered bodies may be purged.
 if not exists(select 1 from fmat.photon_setup_review_publications p join fmat.photon_replies r on r.id=p.reply_id and r.inbox_id=review.inbox_id
  where p.review_id=review.id and r.revoked_at is null and r.status in ('accepted','delivered') and r.provider_reference is not null
   and (r.text=p.text or (r.status='delivered' and r.text is null))) then raise exception 'REVIEW_DELIVERY_REQUIRED';end if;
 return context||jsonb_build_object('reviewId',review.id,'expiresAt',review.expires_at);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_setup_review_publish (
  p_inbox  uuid,
  p_review uuid,
  p_text   text
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare review jsonb; prior text; units integer; reply_id uuid;
begin
 review:=fmat.photon_setup_review_start(p_inbox);
 if review->>'reviewId' is distinct from p_review::text then raise exception 'FORBIDDEN';end if;
 if p_text is null or length(p_text) not between 1 and 4000 or btrim(p_text)='' then raise exception 'INVALID_INPUT';end if;
 select sum(case when ascii(c)>65535 then 2 else 1 end) into units from regexp_split_to_table(p_text,'') c;
 if units>4000 then raise exception 'INVALID_INPUT';end if;
 select text into prior from fmat.photon_setup_review_publications where review_id=p_review;
 if prior is not null then
  if prior<>p_text then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return prior;
 end if;
 -- Publication and its exact outbound intent commit together. Never attach a
 -- review to an older arbitrary reply whose delivered body may be gone.
 insert into fmat.photon_replies(inbox_id,project_id,text)
  select id,project_id,p_text from fmat.photon_inbox where id=p_inbox
  on conflict(inbox_id) do nothing returning id into reply_id;
 if reply_id is null then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 insert into fmat.photon_setup_review_publications(review_id,reply_id,text) values(p_review,reply_id,p_text);
 return p_text;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.photon_setup_review_start (
  p_inbox uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare i fmat.photon_inbox; context jsonb; prior fmat.photon_setup_reviews; deadline timestamptz; body text;
begin
 context:=fmat.photon_setup_context(p_inbox);
 select * into strict i from fmat.photon_inbox where id=p_inbox;
 if lower(btrim(i.text,E' \t\r\n\f'||chr(11)))<>'review setup' then raise exception 'FORBIDDEN';end if;
 select * into prior from fmat.photon_setup_reviews where inbox_id=i.id;
 if prior.id is null then
  if context->'state'->>'nextAction'<>'confirm_review'
   or context->'state'->'review'->>'status' is distinct from 'pending'
   or context->'state'->'draft'->>'status' is distinct from 'active'
   or context->'state'->'draft'->'unresolved' is distinct from '[]'::jsonb
   or context->'state'->'review'->'settings' is distinct from context->'state'->'draft'->'settings'
   then raise exception 'REVISION_CONFLICT';end if;
  deadline:=least(clock_timestamp()+interval '10 minutes',i.received_at+interval '1 hour');
  insert into fmat.photon_setup_reviews(inbox_id,host_id,conversation_id,link_id,receiver_id,snapshot,expires_at)
   values(i.id,(context->>'hostId')::uuid,(context->>'conversationId')::uuid,i.link_id,i.receiver_id,context,deadline)
   returning * into prior;
 end if;
 if prior.snapshot is distinct from context or prior.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 select text into body from fmat.photon_setup_review_publications where review_id=prior.id;
 return jsonb_build_object('reviewId',prior.id,'expiresAt',prior.expires_at,'settings',prior.snapshot->'state'->'review'->'settings','text',body);
end;
$function$;

ALTER TABLE "fmat"."photon_setup_review_publications"
  ADD CONSTRAINT "photon_setup_review_publications_reply_id_fkey" FOREIGN KEY (reply_id) REFERENCES fmat.photon_replies(id);

ALTER TABLE "fmat"."photon_setup_reviews"
  ADD CONSTRAINT "photon_setup_reviews_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES fmat.setup_conversations(id);

ALTER TABLE "fmat"."photon_setup_reviews"
  ADD CONSTRAINT "photon_setup_reviews_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id);

ALTER TABLE "fmat"."photon_setup_reviews"
  ADD CONSTRAINT "photon_setup_reviews_inbox_id_fkey" FOREIGN KEY (inbox_id) REFERENCES fmat.photon_inbox(id);

ALTER TABLE "fmat"."photon_setup_reviews"
  ADD CONSTRAINT "photon_setup_reviews_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.photon_links(id);

ALTER TABLE "fmat"."photon_setup_review_publications"
  ADD CONSTRAINT "photon_setup_review_publications_review_id_fkey" FOREIGN KEY (review_id) REFERENCES fmat.photon_setup_reviews(id);

CREATE INDEX photon_setup_reviews_conversation_idx ON fmat.photon_setup_reviews USING btree (conversation_id);

CREATE INDEX photon_setup_reviews_host_idx ON fmat.photon_setup_reviews USING btree (host_id);

CREATE INDEX photon_setup_reviews_link_idx ON fmat.photon_setup_reviews USING btree (link_id);

CREATE TRIGGER photon_setup_review_publications_immutable
  BEFORE UPDATE ON fmat.photon_setup_review_publications
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

CREATE TRIGGER photon_setup_reviews_immutable
  BEFORE UPDATE ON fmat.photon_setup_reviews
  FOR EACH ROW
  EXECUTE FUNCTION fmat.reject_candidate_evaluation_update();

REVOKE ALL ON FUNCTION "fmat"."photon_setup_context"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."photon_setup_review_check"(uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."photon_setup_review_publish"(uuid, uuid, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."photon_setup_review_start"(uuid) FROM PUBLIC;
