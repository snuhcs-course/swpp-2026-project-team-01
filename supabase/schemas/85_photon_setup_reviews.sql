-- Private review evidence only. These functions do not save settings and are
-- not executable by browsers, models or the service role directly.
create table fmat.photon_setup_reviews (
 id uuid primary key default gen_random_uuid(),
 inbox_id uuid not null unique references fmat.photon_inbox(id),
 host_id uuid not null references fmat.hosts(id),
 conversation_id uuid not null references fmat.setup_conversations(id),
 link_id uuid not null references fmat.photon_links(id),
 receiver_id uuid not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 check(expires_at>created_at)
);
create index photon_setup_reviews_host_idx on fmat.photon_setup_reviews(host_id);
create index photon_setup_reviews_conversation_idx on fmat.photon_setup_reviews(conversation_id);
create index photon_setup_reviews_link_idx on fmat.photon_setup_reviews(link_id);
alter table fmat.photon_setup_reviews enable row level security;
revoke all on fmat.photon_setup_reviews from public,anon,authenticated,service_role;
create trigger photon_setup_reviews_immutable before update on fmat.photon_setup_reviews
 for each row execute function fmat.reject_candidate_evaluation_update();

-- Formatting is a separate immutable receipt: retries keep the same reference,
-- exact text and deadline. A missing publication cannot authorize a decision.
create table fmat.photon_setup_review_publications (
 review_id uuid primary key references fmat.photon_setup_reviews(id),
 reply_id uuid not null unique references fmat.photon_replies(id),
 text text not null check(length(text) between 1 and 4000),
 created_at timestamptz not null default clock_timestamp()
);
alter table fmat.photon_setup_review_publications enable row level security;
revoke all on fmat.photon_setup_review_publications from public,anon,authenticated,service_role;
create trigger photon_setup_review_publications_immutable before update on fmat.photon_setup_review_publications
 for each row execute function fmat.reject_candidate_evaluation_update();

create or replace function fmat.photon_setup_context(p_inbox uuid)
returns jsonb language plpgsql set search_path='' as $$
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
$$;
revoke all on function fmat.photon_setup_context(uuid) from public,anon,authenticated,service_role;

create or replace function fmat.photon_setup_review_start(p_inbox uuid)
returns jsonb language plpgsql set search_path='' as $$
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
$$;
revoke all on function fmat.photon_setup_review_start(uuid) from public,anon,authenticated,service_role;

create or replace function fmat.photon_setup_review_publish(p_inbox uuid,p_review uuid,p_text text)
returns text language plpgsql set search_path='' as $$
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
$$;
revoke all on function fmat.photon_setup_review_publish(uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function fmat.photon_setup_review_check(p_inbox uuid,p_review uuid)
returns jsonb language plpgsql set search_path='' as $$
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
$$;
revoke all on function fmat.photon_setup_review_check(uuid,uuid) from public,anon,authenticated,service_role;
