SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.fmat_photon_setup_answers (
  p_operation text,
  p_inbox_id  uuid,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;
