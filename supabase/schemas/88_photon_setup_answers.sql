-- Frozen private answer reviews. Acceptance changes only draft provenance;
-- final settings confirmation remains a separate current human decision.
create table fmat.photon_setup_answer_reviews (
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
create index photon_setup_answer_reviews_host_idx on fmat.photon_setup_answer_reviews(host_id);
create index photon_setup_answer_reviews_conversation_idx on fmat.photon_setup_answer_reviews(conversation_id);
create index photon_setup_answer_reviews_link_idx on fmat.photon_setup_answer_reviews(link_id);
alter table fmat.photon_setup_answer_reviews enable row level security;
revoke all on fmat.photon_setup_answer_reviews from public,anon,authenticated,service_role;
create trigger photon_setup_answer_reviews_immutable before update on fmat.photon_setup_answer_reviews
 for each row execute function fmat.reject_candidate_evaluation_update();

-- Formatting is a separate immutable receipt: retries keep the same reference,
-- exact text and deadline. A missing publication cannot authorize a decision.
create table fmat.photon_setup_answer_review_publications (
 review_id uuid primary key references fmat.photon_setup_answer_reviews(id),
 reply_id uuid not null unique references fmat.photon_replies(id),
 text text not null check(length(text) between 1 and 4000),
 created_at timestamptz not null default clock_timestamp()
);
alter table fmat.photon_setup_answer_review_publications enable row level security;
revoke all on fmat.photon_setup_answer_review_publications from public,anon,authenticated,service_role;
create trigger photon_setup_answer_review_publications_immutable before update on fmat.photon_setup_answer_review_publications
 for each row execute function fmat.reject_candidate_evaluation_update();


-- Mirrors browser draftAnswers eligibility. Values are derived from trusted
-- current setup state, never supplied as acceptance patches by the caller.
create or replace function fmat.setup_answer_patches(p_state jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare d jsonb:=p_state->'draft'; r jsonb:=d->'settings'->'rules'; p jsonb:=d->'provenance'; answers jsonb:='{}';
begin
 if d->>'status' is distinct from 'active' or p_state->>'nextAction'='refresh_draft'
  or d->'baseRulesVersion' is distinct from p_state->'rulesVersion' or r is null or r='null' then return answers;end if;
 if r->>'meetingMode' in ('online','in_person','either') and p->>'rules.meetingMode'='assistant'
  and not coalesce(p_state->'progress'->'dismissedSuggestions' @> '["mode"]'::jsonb,false) then
  answers:=answers||jsonb_build_object('mode',jsonb_build_object('meetingMode',r->'meetingMode'));
 end if;
 if coalesce(r->>'meetingMode','online')='online' or (p->>'rules.meetingMode' is distinct from 'host' and answers='{}') then return answers;end if;
 if r->>'locationPolicy'='per_meeting' and p->>'rules.locationPolicy'='assistant' then
  answers:=answers||'{"location":{"locationPolicy":"per_meeting","locations":[]}}';
 elsif r->>'locationPolicy'='preferred' and jsonb_array_length(r->'locations')>0
  and (p->>'rules.locationPolicy'='assistant' or p->>'rules.locations'='assistant') then
  answers:=answers||jsonb_build_object('location',jsonb_build_object('locationPolicy','preferred','locations',r->'locations'));
 end if;
 if r->>'travelMode' in ('DRIVE','TRANSIT','WALK','BICYCLE','PER_TRIP') and p->>'rules.travelMode'='assistant' then
  answers:=answers||jsonb_build_object('transport',jsonb_build_object('travelMode',r->'travelMode'));
 end if;
 if r ? 'travelBufferMinutes' and p->>'rules.travelBufferMinutes'='assistant' then
  answers:=answers||jsonb_build_object('travel_buffer',jsonb_build_object('travelBufferMinutes',r->'travelBufferMinutes'));
 end if;
 return answers;
end;
$$;
revoke all on function fmat.setup_answer_patches(jsonb) from public,anon,authenticated,service_role;

create or replace function fmat.photon_setup_answer_command_keys(p_text text,p_review uuid)
returns text[] language plpgsql immutable set search_path='' as $$
declare match text[]; chosen text[];
begin
 if p_review is null or p_text is null or length(p_text)>4096 then raise exception 'FORBIDDEN';end if;
 match:=regexp_match(lower(btrim(p_text,E' \t\r\n\f'||chr(11))),'^accept setup answers '||p_review::text||' ([a-z_,]+)$');
 if match is null then raise exception 'FORBIDDEN';end if;
 chosen:=string_to_array(match[1],',');
 if cardinality(chosen) not between 1 and 4 or not chosen <@ array['mode','location','transport','travel_buffer']
  or cardinality(chosen)<>(select count(distinct k) from unnest(chosen) k) then raise exception 'INVALID_INPUT';end if;
 return chosen;
end;
$$;
revoke all on function fmat.photon_setup_answer_command_keys(text,uuid) from public,anon,authenticated,service_role;

create or replace function fmat.photon_setup_answer_review_start(p_inbox uuid)
returns jsonb language plpgsql set search_path='' as $$
declare i fmat.photon_inbox; context jsonb; prior fmat.photon_setup_answer_reviews; deadline timestamptz; body text;
begin
 context:=fmat.photon_setup_context(p_inbox);
 select * into strict i from fmat.photon_inbox where id=p_inbox;
 if lower(btrim(i.text,E' \t\r\n\f'||chr(11)))<>'review setup answers' then raise exception 'FORBIDDEN';end if;
 select * into prior from fmat.photon_setup_answer_reviews where inbox_id=i.id;
 if prior.id is null then
  if fmat.setup_answer_patches(context->'state')='{}'::jsonb then raise exception 'REVISION_CONFLICT';end if;
  deadline:=least(clock_timestamp()+interval '10 minutes',i.received_at+interval '1 hour');
  insert into fmat.photon_setup_answer_reviews(inbox_id,host_id,conversation_id,link_id,receiver_id,snapshot,expires_at)
   values(i.id,(context->>'hostId')::uuid,(context->>'conversationId')::uuid,i.link_id,i.receiver_id,context,deadline)
   returning * into prior;
 end if;
 if prior.snapshot is distinct from context or prior.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 select text into body from fmat.photon_setup_answer_review_publications where review_id=prior.id;
 return jsonb_build_object('reviewId',prior.id,'expiresAt',prior.expires_at,'state',prior.snapshot->'state','text',body);
end;
$$;
revoke all on function fmat.photon_setup_answer_review_start(uuid) from public,anon,authenticated,service_role;

create or replace function fmat.photon_setup_answer_review_publish(p_inbox uuid,p_review uuid,p_text text)
returns text language plpgsql set search_path='' as $$
declare review jsonb; prior text; units integer; reply_id uuid;
begin
 review:=fmat.photon_setup_answer_review_start(p_inbox);
 if review->>'reviewId' is distinct from p_review::text then raise exception 'FORBIDDEN';end if;
 if p_text is null or length(p_text) not between 1 and 4000 or btrim(p_text)='' then raise exception 'INVALID_INPUT';end if;
 select sum(case when ascii(c)>65535 then 2 else 1 end) into units from regexp_split_to_table(p_text,'') c;
 if units>4000 then raise exception 'INVALID_INPUT';end if;
 select text into prior from fmat.photon_setup_answer_review_publications where review_id=p_review;
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
 insert into fmat.photon_setup_answer_review_publications(review_id,reply_id,text) values(p_review,reply_id,p_text);
 return p_text;
end;
$$;
revoke all on function fmat.photon_setup_answer_review_publish(uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function fmat.photon_setup_answer_review_check(p_inbox uuid,p_review uuid)
returns jsonb language plpgsql set search_path='' as $$
declare i fmat.photon_inbox; original fmat.photon_inbox; review fmat.photon_setup_answer_reviews; context jsonb;
begin
 context:=fmat.photon_setup_context(p_inbox);
 select * into strict i from fmat.photon_inbox where id=p_inbox;
 perform fmat.photon_setup_answer_command_keys(i.text,p_review);
 select * into review from fmat.photon_setup_answer_reviews where id=p_review;
 if review.id is null or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id
  or review.host_id::text is distinct from context->>'hostId' or review.conversation_id::text is distinct from context->>'conversationId'
  then raise exception 'FORBIDDEN';end if;
 select * into strict original from fmat.photon_inbox where id=review.inbox_id;
 if i.received_order<=original.received_order or i.received_at<review.created_at
  or review.snapshot is distinct from context or review.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 perform fmat.photon_execution_actor(jsonb_build_object('kind','photon','linkId',original.link_id,'inboxId',original.id,'receiverId',original.receiver_id));
 -- A formatted record alone is not proof the host was shown the summary.
 -- Match the frozen reply text while retained; delivered bodies may be purged.
 if not exists(select 1 from fmat.photon_setup_answer_review_publications p join fmat.photon_replies r on r.id=p.reply_id and r.inbox_id=review.inbox_id
  where p.review_id=review.id and r.revoked_at is null and r.status in ('accepted','delivered') and r.provider_reference is not null
   and (r.text=p.text or (r.status='delivered' and r.text is null))) then raise exception 'REVIEW_DELIVERY_REQUIRED';end if;
 return context||jsonb_build_object('reviewId',review.id,'expiresAt',review.expires_at);
end;
$$;
revoke all on function fmat.photon_setup_answer_review_check(uuid,uuid) from public,anon,authenticated,service_role;

create table fmat.photon_setup_answer_acceptances (
 review_id uuid primary key references fmat.photon_setup_answer_reviews(id),
 inbox_id uuid not null unique references fmat.photon_inbox(id),
 keys text[] not null check(cardinality(keys) between 1 and 4),
 result jsonb not null check(jsonb_typeof(result)='object'),
 created_at timestamptz not null default clock_timestamp()
);
alter table fmat.photon_setup_answer_acceptances enable row level security;
revoke all on fmat.photon_setup_answer_acceptances from public,anon,authenticated,service_role;
create trigger photon_setup_answer_acceptances_immutable before update on fmat.photon_setup_answer_acceptances
 for each row execute function fmat.reject_candidate_evaluation_update();

-- Internal service boundary. Human authority is always derived from the exact
-- signed inbox, not a caller credential, selected values or provenance claim.
create or replace function public.fmat_photon_setup_answers(p_operation text,p_inbox_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_review_id uuid; review fmat.photon_setup_answer_reviews; i fmat.photon_inbox;
 actor jsonb; context jsonb; prior jsonb; state jsonb; choices jsonb; chosen text[]; patch jsonb:='{}'; key text; result jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation='review' then
  if p_input<>'{}'::jsonb then raise exception 'INVALID_INPUT';end if;
  return fmat.photon_setup_answer_review_start(p_inbox_id);
 elsif p_operation='publish' then
  if not (p_input ?& array['reviewId','text']) or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('reviewId','text')) or jsonb_typeof(p_input->'text') is distinct from 'string' then raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('text',fmat.photon_setup_answer_review_publish(p_inbox_id,(p_input->>'reviewId')::uuid,p_input->>'text'));
 elsif p_operation is distinct from 'accept' then raise exception 'INVALID_INPUT';end if;
 if jsonb_typeof(p_input->'reviewId') is distinct from 'string' or exists(select 1 from jsonb_object_keys(p_input) k where k<>'reviewId') then raise exception 'INVALID_INPUT';end if;
 v_review_id:=(p_input->>'reviewId')::uuid;
 select * into i from fmat.photon_inbox where id=p_inbox_id;
 if not found then raise exception 'UNAUTHORIZED';end if;
 actor:=fmat.photon_execution_actor(jsonb_build_object('kind','photon','linkId',i.link_id,'inboxId',i.id,'receiverId',i.receiver_id));
 chosen:=fmat.photon_setup_answer_command_keys(i.text,v_review_id);
 select * into review from fmat.photon_setup_answer_reviews where id=v_review_id;
 if review.id is null or review.host_id::text is distinct from actor->>'id' or review.link_id is distinct from i.link_id or review.receiver_id is distinct from i.receiver_id then raise exception 'FORBIDDEN';end if;
 -- Recover the original effect before looking at a potentially newer draft.
 select a.result into prior from fmat.photon_setup_answer_acceptances a where a.review_id=v_review_id and a.inbox_id=p_inbox_id;
 if prior is not null then return prior;end if;
 if exists(select 1 from fmat.photon_setup_answer_acceptances a where a.review_id=v_review_id) then raise exception 'REVISION_CONFLICT';end if;
 context:=fmat.photon_setup_answer_review_check(p_inbox_id,v_review_id);
 state:=context->'state';choices:=fmat.setup_answer_patches(state);
 if not choices ?& chosen or (choices ? 'mode' and not 'mode'=any(chosen)) then raise exception 'INVALID_INPUT';end if;
 foreach key in array chosen loop patch:=patch||(choices->key);end loop;
 state:=fmat.host_setup_operation('draft',actor,jsonb_build_object('expectedRevision',state->'revision','patch',jsonb_build_object('rules',patch),
  'unresolved',state->'draft'->'clarifications','idempotencyKey','photon-answers:'||v_review_id::text),'host');
 -- Shared draft/idempotency operations can wait; elapsed authority must roll
 -- back the draft as well as prevent a receipt after those waits.
 perform fmat.photon_execution_actor(jsonb_build_object('kind','photon','linkId',i.link_id,'inboxId',i.id,'receiverId',i.receiver_id));
 if review.expires_at<=clock_timestamp() then raise exception 'REVISION_CONFLICT';end if;
 result:=jsonb_build_object('accepted',true,'reviewId',v_review_id,'revision',state->'revision','draftRevision',state->'draft'->'revision','keys',to_jsonb(chosen),'acceptedAt',clock_timestamp());
 insert into fmat.photon_setup_answer_acceptances(review_id,inbox_id,keys,result) values(v_review_id,p_inbox_id,chosen,result);
 return result;
exception when invalid_text_representation then raise exception 'INVALID_INPUT';
end;
$$;
revoke all on function public.fmat_photon_setup_answers(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_photon_setup_answers(text,uuid,jsonb) to service_role;
