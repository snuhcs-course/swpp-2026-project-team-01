SET local check_function_bodies = off;

ALTER TABLE "fmat"."setup_channel_challenges"
  DROP CONSTRAINT "setup_channel_challenges_check3";

ALTER TABLE "fmat"."setup_provider_outbound"
  DROP CONSTRAINT "setup_provider_outbound_check";

ALTER TABLE "fmat"."setup_channel_challenges"
  ADD COLUMN "method" text NOT NULL DEFAULT 'link'::text;

ALTER TABLE "fmat"."setup_channel_challenges"
  ADD COLUMN "failed_attempts" integer NOT NULL DEFAULT 0;

ALTER TABLE "fmat"."setup_provider_outbound"
  ADD COLUMN "challenge_id" uuid;

CREATE OR REPLACE FUNCTION fmat.setup_conversation_authorize (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if p_operation in ('setup_link_challenge_start','setup_link_confirm','setup_link_unlink') or
    (p_operation in ('setup_conversation_read','setup_turn_lookup','setup_turn_append','setup_review_confirm') and p_actor->>'kind'='host') then
    perform fmat.require_host(p_actor,true);
    return;
  end if;
  if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  if p_operation in ('setup_conversation_read','setup_turn_lookup','setup_turn_append','setup_review_confirm','setup_channel_authorize','setup_provider_inbound_record') then
    perform fmat.setup_channel_authority(p_input);
  elsif p_operation='setup_provider_outbound_prepare' then
    perform 1 from fmat.setup_provider_inbound i join fmat.setup_channel_links l on l.id=i.link_id join fmat.hosts h on h.id=l.host_id
      where i.id=(p_input->>'inboundId')::uuid and l.revoked_at is null and h.revoked_at is null;
    if not found then raise exception 'LINK_NOT_FOUND'; end if;
  elsif p_operation='setup_provider_outbound_record' and p_input->>'outcome'='revoked' then
    perform 1 from fmat.setup_provider_outbound o left join fmat.setup_channel_links l on l.id=o.link_id left join fmat.hosts h on h.id=l.host_id left join fmat.setup_link_continuations c on c.id=o.continuation_id left join fmat.setup_channel_challenges ch on ch.id=o.challenge_id
      where (o.client_message_id=nullif(p_input->>'clientMessageId','')::uuid or o.id=nullif(p_input->>'intentId','')::uuid)
        and ((l.id is not null and (l.revoked_at is not null or h.revoked_at is not null)) or (c.id is not null and (c.consumed_at is not null or c.expires_at<=now())) or (ch.id is not null and (ch.consumed_at is not null or ch.expires_at<=now())));
    if not found then raise exception 'OUTBOUND_CONFLICT'; end if;
  elsif p_operation in ('setup_provider_outbound_record','setup_provider_outbound_authorize') then
    perform 1 from fmat.setup_provider_outbound o join fmat.setup_channel_links l on l.id=o.link_id join fmat.hosts h on h.id=l.host_id
      where (o.client_message_id=nullif(p_input->>'clientMessageId','')::uuid or o.id=nullif(p_input->>'intentId','')::uuid) and l.revoked_at is null and h.revoked_at is null for share of l,h;
    if not found then
      perform 1 from fmat.setup_provider_outbound o join fmat.setup_link_continuations c on c.id=o.continuation_id
        where (o.client_message_id=nullif(p_input->>'clientMessageId','')::uuid or o.id=nullif(p_input->>'intentId','')::uuid) and c.consumed_at is null and c.expires_at>now() for share of c;
      if not found then
        perform 1 from fmat.setup_provider_outbound o join fmat.setup_channel_challenges ch on ch.id=o.challenge_id join fmat.hosts h on h.id=ch.host_id
          where (o.client_message_id=nullif(p_input->>'clientMessageId','')::uuid or o.id=nullif(p_input->>'intentId','')::uuid) and ch.method='otp' and ch.consumed_at is null and ch.expires_at>now() and h.revoked_at is null for share of ch,h;
        if not found then raise exception 'LINK_NOT_FOUND'; end if;
      end if;
    end if;
  elsif p_operation in ('setup_bridge_resume','setup_bridge_checkpoint','setup_provider_outbound_claim') then
    if p_input->>'provider' is distinct from 'imessage' then raise exception 'INVALID_INPUT'; end if;
  elsif p_operation not in ('setup_link_challenge_claim','setup_link_inbound_start') then raise exception 'FORBIDDEN'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.setup_conversation_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_host_id uuid; v_host fmat.hosts; v_conversation fmat.setup_conversations; v_link fmat.setup_channel_links;
  v_draft fmat.setup_drafts; v_review fmat.setup_reviews; v_challenge fmat.setup_channel_challenges; v_continuation fmat.setup_link_continuations;
  v_inbound fmat.setup_provider_inbound; v_outbound fmat.setup_provider_outbound;
  v_expected integer; v_sequence integer; v_draft_revision integer; v_review_revision integer; v_unresolved text[];
  v_base jsonb; v_patch jsonb; v_settings jsonb; v_extraction jsonb; v_result jsonb; v_existing fmat.setup_turns; v_outcome text; v_provider_sequence bigint; v_dispatch boolean;
begin
  perform fmat.setup_conversation_authorize(p_operation,p_actor,p_input);
  if p_operation='setup_bridge_resume' then
    return jsonb_build_object('lastSequence',(select provider_sequence::text from fmat.setup_bridge_checkpoints where provider=p_input->>'provider'));
  elsif p_operation='setup_bridge_checkpoint' then
    if coalesce(p_input->>'providerSequence','') !~ '^[0-9]{1,18}$' then raise exception 'INVALID_INPUT'; end if;
    v_provider_sequence:=(p_input->>'providerSequence')::bigint;
    insert into fmat.setup_bridge_checkpoints(provider,provider_sequence,disposition) values(p_input->>'provider',v_provider_sequence,left(p_input->>'disposition',100))
      on conflict(provider) do update set provider_sequence=greatest(fmat.setup_bridge_checkpoints.provider_sequence,excluded.provider_sequence),
        disposition=case when excluded.provider_sequence>=fmat.setup_bridge_checkpoints.provider_sequence then excluded.disposition else fmat.setup_bridge_checkpoints.disposition end,updated_at=now();
    return jsonb_build_object('lastSequence',(select provider_sequence::text from fmat.setup_bridge_checkpoints where provider=p_input->>'provider'));
  elsif p_operation in ('setup_provider_outbound_claim','setup_provider_outbound_authorize') then
    select o.* into v_outbound from fmat.setup_provider_outbound o left join fmat.setup_channel_links l on l.id=o.link_id left join fmat.hosts h on h.id=l.host_id left join fmat.setup_link_continuations c on c.id=o.continuation_id left join fmat.setup_channel_challenges ch on ch.id=o.challenge_id left join fmat.hosts chh on chh.id=ch.host_id
      where ((l.id is not null and l.revoked_at is null and h.revoked_at is null) or (c.id is not null and c.consumed_at is null and c.expires_at>now()) or (ch.id is not null and ch.method='otp' and ch.consumed_at is null and ch.expires_at>now() and chh.revoked_at is null))
        and (case when p_operation='setup_provider_outbound_claim' then o.status='prepared' or (o.status='uncertain' and o.updated_at<=now()-interval '30 seconds') else o.id=(p_input->>'intentId')::uuid and o.status='uncertain' end)
      order by (o.status='prepared') desc,o.updated_at,o.id limit 1 for update of o skip locked;
    if not found then return jsonb_build_object('action','none','authorized',false); end if;
    if v_outbound.link_id is not null then
      select l.* into v_link from fmat.setup_channel_links l join fmat.hosts h on h.id=l.host_id where l.id=v_outbound.link_id and l.revoked_at is null and h.revoked_at is null for share of l,h;
      if not found then raise exception 'LINK_NOT_FOUND'; end if;
    elsif v_outbound.continuation_id is not null then
      select * into v_continuation from fmat.setup_link_continuations where id=v_outbound.continuation_id and consumed_at is null and expires_at>now() for share;
      if not found then raise exception 'CHALLENGE_INVALID'; end if;
    else
      select ch.* into v_challenge from fmat.setup_channel_challenges ch join fmat.hosts h on h.id=ch.host_id where ch.id=v_outbound.challenge_id and ch.method='otp' and ch.consumed_at is null and ch.expires_at>now() and h.revoked_at is null for share of ch,h;
      if not found then raise exception 'CHALLENGE_INVALID'; end if;
    end if;
    v_dispatch:=p_operation='setup_provider_outbound_claim' and v_outbound.status='prepared';
    if p_operation='setup_provider_outbound_claim' then update fmat.setup_provider_outbound set status='uncertain',updated_at=now() where id=v_outbound.id; end if;
    return jsonb_build_object('action',case when v_dispatch then 'dispatch' else 'reconcile' end,'intentId',v_outbound.id,'authorized',true,'providerMessageId',v_outbound.provider_reference,
      'conversationId',coalesce(v_link.private_conversation_id,v_continuation.private_conversation_id,v_challenge.expected_conversation_id),'clientMessageId',v_outbound.client_message_id,'body',v_outbound.text,'createdAt',v_outbound.prepared_at);
  end if;
  if p_operation='setup_channel_authorize' then
    v_link:=fmat.setup_channel_authority(p_input);
    return jsonb_build_object('linkId',v_link.id,'hostId',v_link.host_id,'conversationId',v_link.conversation_id);
  end if;

  if p_operation='setup_link_inbound_start' then
    if p_input->>'provider' is distinct from 'imessage' or (p_input->>'isGroup')::boolean is distinct from false
      or coalesce(p_input->>'continuationSecretHash','') !~ '^[0-9a-f]{64}$'
      or length(coalesce(p_input->>'senderId','')) not between 1 and 300
      or length(coalesce(p_input->>'privateConversationId','')) not between 1 and 300 then raise exception 'INVALID_INPUT'; end if;
    if exists(select 1 from fmat.setup_link_continuations where sender_id=p_input->>'senderId' and created_at>now()-interval '1 minute') then raise exception 'RATE_LIMITED'; end if;
    if length(coalesce(p_input->>'replyText','')) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.setup_link_continuations(id,secret_hash,sender_id,private_conversation_id) values((p_input->>'continuationId')::uuid,p_input->>'continuationSecretHash',p_input->>'senderId',p_input->>'privateConversationId') returning * into v_continuation;
    insert into fmat.setup_provider_outbound(continuation_id,client_message_id,text) values(v_continuation.id,(p_input->>'clientMessageId')::uuid,p_input->>'replyText');
    return jsonb_build_object('continuationId',v_continuation.id,'expiresAt',v_continuation.expires_at);
  end if;
  if p_operation='setup_link_challenge_claim' then
    if p_input->>'provider' is distinct from 'imessage' or (p_input->>'isGroup')::boolean is distinct from false
      or coalesce(p_input->>'challengeSecretHash','') !~ '^[0-9a-f]{64}$' then raise exception 'FORBIDDEN'; end if;
    select * into v_challenge from fmat.setup_channel_challenges where id=(p_input->>'challengeId')::uuid for update;
    if not found or v_challenge.method<>'link' or v_challenge.secret_hash is distinct from p_input->>'challengeSecretHash' or v_challenge.expires_at<=now() or v_challenge.consumed_at is not null then raise exception 'CHALLENGE_INVALID'; end if;
    if v_challenge.expected_sender_id is not null and (v_challenge.expected_sender_id is distinct from p_input->>'senderId' or v_challenge.expected_conversation_id is distinct from p_input->>'privateConversationId') then raise exception 'CHALLENGE_INVALID'; end if;
    if v_challenge.claimed_at is not null and (v_challenge.claimed_sender_id is distinct from p_input->>'senderId' or v_challenge.claimed_conversation_id is distinct from p_input->>'privateConversationId') then raise exception 'CHALLENGE_INVALID'; end if;
    if length(coalesce(p_input->>'senderId','')) not between 1 and 300 or length(coalesce(p_input->>'privateConversationId','')) not between 1 and 300 then raise exception 'INVALID_INPUT'; end if;
    update fmat.setup_channel_challenges set claimed_sender_id=p_input->>'senderId',claimed_conversation_id=p_input->>'privateConversationId',claimed_at=coalesce(claimed_at,now()) where id=v_challenge.id;
    return jsonb_build_object('challengeId',v_challenge.id,'claimed',true,'expiresAt',v_challenge.expires_at);
  end if;

  if p_operation in ('setup_conversation_read','setup_turn_lookup','setup_provider_inbound_record','setup_turn_append','setup_review_confirm') and p_actor->>'kind'='worker' then
    v_link:=fmat.setup_channel_authority(p_input); v_host_id:=v_link.host_id;
  elsif p_operation in ('setup_provider_outbound_prepare','setup_provider_outbound_record') then
    v_host_id:=null;
  else v_host_id:=fmat.require_host(p_actor,true); end if;

  if p_operation='setup_conversation_read' then
    v_conversation:=fmat.ensure_setup_conversation(v_host_id);
    return fmat.setup_conversation_view(v_host_id);
  elsif p_operation='setup_turn_lookup' then
    select * into v_existing from fmat.setup_turns where id=(p_input->>'clientTurnId')::uuid;
    if not found then return null; end if;
    if not exists(select 1 from fmat.setup_conversations where id=v_existing.conversation_id and host_id=v_host_id) then raise exception 'FORBIDDEN'; end if;
    if v_existing.text is distinct from p_input->>'text' or v_existing.channel is distinct from p_input->>'channel' or (p_input ? 'expectedRevision' and (p_input->>'expectedRevision')::integer is distinct from (v_existing.result->>'revision')::integer-1) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return coalesce(v_existing.result,fmat.setup_conversation_view(v_host_id));
  elsif p_operation='setup_link_challenge_start' then
    if coalesce(p_input->>'challengeSecretHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_input->>'browserProofHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
    if coalesce(p_input->>'method','link') not in ('link','otp') then raise exception 'INVALID_INPUT'; end if;
    if p_input->>'method'='otp' and (coalesce(p_input->>'challengeId','') !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(p_input->>'recipientId','') !~ '^\+[1-9][0-9]{7,14}$'
      or coalesce(p_input->>'clientMessageId','') !~ '^[0-9a-fA-F-]{36}$'
      or length(coalesce(p_input->>'replyText','')) not between 1 and 10000) then raise exception 'INVALID_INPUT'; end if;
    perform 1 from fmat.hosts where id=v_host_id and revoked_at is null for update;
    if not found then raise exception 'HOST_NOT_ADMITTED'; end if;
    if p_input->>'method'='otp' then
      select * into v_challenge from fmat.setup_channel_challenges where id=(p_input->>'challengeId')::uuid for update;
      if found then
        select * into v_outbound from fmat.setup_provider_outbound where challenge_id=v_challenge.id for update;
        if not found or v_challenge.host_id<>v_host_id or v_challenge.method<>'otp'
          or v_challenge.secret_hash is distinct from p_input->>'challengeSecretHash'
          or v_challenge.browser_proof_hash is distinct from p_input->>'browserProofHash'
          or v_challenge.expected_sender_id is distinct from p_input->>'recipientId'
          or v_challenge.expected_conversation_id is distinct from 'any;-;'||(p_input->>'recipientId')
          or v_outbound.client_message_id<>(p_input->>'clientMessageId')::uuid
          or v_outbound.text is distinct from p_input->>'replyText' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
        return jsonb_build_object('challengeId',v_challenge.id,'provider',v_challenge.provider,'method',v_challenge.method,'expiresAt',v_challenge.expires_at);
      end if;
    end if;
    if exists(select 1 from fmat.setup_channel_challenges where host_id=v_host_id and created_at>now()-interval '1 minute') then raise exception 'RATE_LIMITED'; end if;
    if p_input->>'method'='otp' then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('setup-otp:'||(p_input->>'recipientId'),0)); end if;
    if p_input->>'method'='otp' and exists(select 1 from fmat.setup_channel_challenges where method='otp' and expected_sender_id=p_input->>'recipientId' and created_at>now()-interval '1 minute') then raise exception 'RATE_LIMITED'; end if;
    if p_input->>'method'='otp' and p_input ? 'continuationId' then raise exception 'INVALID_INPUT'; end if;
    if p_input ? 'continuationId' then
      select * into v_continuation from fmat.setup_link_continuations where id=(p_input->>'continuationId')::uuid for update;
      if not found or v_continuation.secret_hash is distinct from p_input->>'continuationSecretHash' or v_continuation.consumed_at is not null or v_continuation.expires_at<=now() then raise exception 'CHALLENGE_INVALID'; end if;
      update fmat.setup_link_continuations set consumed_at=now() where id=v_continuation.id;
    end if;
    v_conversation:=fmat.ensure_setup_conversation(v_host_id);
    update fmat.setup_channel_challenges set consumed_at=now() where host_id=v_host_id and consumed_at is null;
    if p_input->>'method'='otp' then
      insert into fmat.setup_channel_challenges(id,host_id,method,secret_hash,browser_proof_hash,provider,expected_sender_id,expected_conversation_id)
        values((p_input->>'challengeId')::uuid,v_host_id,'otp',p_input->>'challengeSecretHash',p_input->>'browserProofHash','imessage',p_input->>'recipientId','any;-;'||(p_input->>'recipientId')) returning * into v_challenge;
      insert into fmat.setup_provider_outbound(challenge_id,client_message_id,text) values(v_challenge.id,(p_input->>'clientMessageId')::uuid,p_input->>'replyText');
    else
      insert into fmat.setup_channel_challenges(host_id,method,secret_hash,browser_proof_hash,provider,expected_sender_id,expected_conversation_id)
        values(v_host_id,'link',p_input->>'challengeSecretHash',p_input->>'browserProofHash','imessage',v_continuation.sender_id,v_continuation.private_conversation_id) returning * into v_challenge;
    end if;
    return jsonb_build_object('challengeId',v_challenge.id,'provider',v_challenge.provider,'method',v_challenge.method,'expiresAt',v_challenge.expires_at);
  elsif p_operation='setup_link_confirm' then
    select * into v_challenge from fmat.setup_channel_challenges where id=(p_input->>'challengeId')::uuid and host_id=v_host_id for update;
    if not found or v_challenge.browser_proof_hash is distinct from p_input->>'browserProofHash' or v_challenge.expires_at<=now() or v_challenge.consumed_at is not null then raise exception 'CHALLENGE_INVALID'; end if;
    if v_challenge.method='otp' then
      select * into v_outbound from fmat.setup_provider_outbound where challenge_id=v_challenge.id for update;
      if not found or v_outbound.status in ('failed','revoked') then raise exception 'CHALLENGE_INVALID'; end if;
      if v_challenge.failed_attempts>=5 then return jsonb_build_object('status','invalid_code','remainingAttempts',0); end if;
      if coalesce(p_input->>'codeHash','') !~ '^[0-9a-f]{64}$' or v_challenge.secret_hash is distinct from p_input->>'codeHash' then
        update fmat.setup_channel_challenges set failed_attempts=least(failed_attempts+1,5) where id=v_challenge.id returning * into v_challenge;
        return jsonb_build_object('status','invalid_code','remainingAttempts',5-v_challenge.failed_attempts);
      end if;
      v_challenge.claimed_sender_id:=v_challenge.expected_sender_id;
      v_challenge.claimed_conversation_id:=v_challenge.expected_conversation_id;
    elsif v_challenge.claimed_at is null then
      raise exception 'CHALLENGE_INVALID';
    end if;
    if exists(select 1 from fmat.setup_channel_links where revoked_at is null and (host_id=v_host_id or (provider=v_challenge.provider and sender_id=v_challenge.claimed_sender_id) or (provider=v_challenge.provider and private_conversation_id=v_challenge.claimed_conversation_id))) then raise exception 'LINK_CONFLICT'; end if;
    v_conversation:=fmat.ensure_setup_conversation(v_host_id);
    insert into fmat.setup_channel_links(host_id,conversation_id,provider,sender_id,private_conversation_id,challenge_id)
      values(v_host_id,v_conversation.id,v_challenge.provider,v_challenge.claimed_sender_id,v_challenge.claimed_conversation_id,v_challenge.id) returning * into v_link;
    update fmat.setup_channel_challenges set consumed_at=now() where id=v_challenge.id;
    perform fmat.audit(p_operation,p_actor,v_link.id::text);
    return fmat.setup_conversation_view(v_host_id);
  elsif p_operation='setup_link_unlink' then
    update fmat.setup_channel_links set revoked_at=now() where id=(p_input->>'linkId')::uuid and host_id=v_host_id and revoked_at is null returning * into v_link;
    if not found then raise exception 'LINK_NOT_FOUND'; end if;
    perform fmat.audit(p_operation,p_actor,v_link.id::text);
    return fmat.setup_conversation_view(v_host_id);
  elsif p_operation='setup_provider_inbound_record' then
    if length(coalesce(p_input->>'providerMessageId','')) not between 1 and 500 or length(coalesce(p_input->>'text','')) not between 1 and 10000 or (p_input->>'occurredAt')::timestamptz is null then raise exception 'INVALID_INPUT'; end if;
    perform 1 from fmat.setup_channel_links where id=v_link.id and revoked_at is null for update;
    if not found then raise exception 'LINK_NOT_FOUND'; end if;
    select * into v_inbound from fmat.setup_provider_inbound where provider=p_input->>'provider' and provider_message_id=p_input->>'providerMessageId';
    if found then
      if v_inbound.link_id<>v_link.id or v_inbound.sender_id is distinct from p_input->>'senderId' or v_inbound.private_conversation_id is distinct from p_input->>'privateConversationId' or v_inbound.text is distinct from p_input->>'text' or v_inbound.occurred_at is distinct from (p_input->>'occurredAt')::timestamptz then raise exception 'PROVIDER_MESSAGE_CONFLICT'; end if;
      return jsonb_build_object('inboundId',v_inbound.id,'linkId',v_link.id,'hostId',v_link.host_id,'conversationId',v_link.conversation_id,'sequence',v_inbound.sequence,'duplicate',true,'processed',v_inbound.processed_at is not null,'result',v_inbound.result,'existingOutbound',exists(select 1 from fmat.setup_provider_outbound where inbound_id=v_inbound.id));
    end if;
    select coalesce(max(sequence),0)+1 into v_sequence from fmat.setup_provider_inbound where link_id=v_link.id;
    insert into fmat.setup_provider_inbound(link_id,provider,provider_message_id,private_conversation_id,sender_id,sequence,occurred_at,text)
      values(v_link.id,p_input->>'provider',p_input->>'providerMessageId',p_input->>'privateConversationId',p_input->>'senderId',v_sequence,(p_input->>'occurredAt')::timestamptz,p_input->>'text') returning * into v_inbound;
    return jsonb_build_object('inboundId',v_inbound.id,'linkId',v_link.id,'hostId',v_link.host_id,'conversationId',v_link.conversation_id,'sequence',v_inbound.sequence,'duplicate',false,'processed',false,'result',null,'existingOutbound',false);
  elsif p_operation='setup_provider_outbound_prepare' then
    select i.* into v_inbound from fmat.setup_provider_inbound i join fmat.setup_channel_links l on l.id=i.link_id join fmat.hosts h on h.id=l.host_id
      where i.id=(p_input->>'inboundId')::uuid and l.revoked_at is null and h.revoked_at is null for update of i,l for share of h;
    if not found then raise exception 'LINK_NOT_FOUND'; end if;
    select * into strict v_link from fmat.setup_channel_links where id=v_inbound.link_id;
    if v_inbound.processed_at is null then raise exception 'INBOUND_NOT_PROCESSED'; end if;
    if length(coalesce(p_input->>'text','')) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    select * into v_outbound from fmat.setup_provider_outbound where inbound_id=v_inbound.id or client_message_id=(p_input->>'clientMessageId')::uuid;
    if found then
      if v_outbound.inbound_id<>v_inbound.id or v_outbound.client_message_id<>(p_input->>'clientMessageId')::uuid or v_outbound.text is distinct from p_input->>'text' then raise exception 'OUTBOUND_CONFLICT'; end if;
    else
      insert into fmat.setup_provider_outbound(inbound_id,link_id,client_message_id,text) values(v_inbound.id,v_link.id,(p_input->>'clientMessageId')::uuid,p_input->>'text') returning * into v_outbound;
    end if;
    return jsonb_build_object('outboundId',v_outbound.id,'clientMessageId',v_outbound.client_message_id,'status',v_outbound.status);
  elsif p_operation='setup_provider_outbound_record' then
    select o.* into v_outbound from fmat.setup_provider_outbound o
      where o.client_message_id=nullif(p_input->>'clientMessageId','')::uuid or o.id=nullif(p_input->>'intentId','')::uuid for update;
    if not found then raise exception 'LINK_NOT_FOUND'; end if;
    v_outcome:=p_input->>'outcome';
    if v_outcome is null or v_outcome not in ('accepted','delivered','failed','uncertain','revoked') then raise exception 'INVALID_INPUT'; end if;
    if v_outbound.status='delivered' and v_outcome<>'delivered' then raise exception 'OUTBOUND_CONFLICT'; end if;
    if v_outbound.status='failed' and v_outcome in ('accepted','uncertain') then raise exception 'OUTBOUND_CONFLICT'; end if;
    update fmat.setup_provider_outbound set status=v_outcome,provider_reference=coalesce(p_input->>'providerReference',provider_reference),error_code=coalesce(p_input->>'errorCode',error_code),updated_at=now() where id=v_outbound.id returning * into v_outbound;
    return jsonb_build_object('outboundId',v_outbound.id,'clientMessageId',v_outbound.client_message_id,'status',v_outbound.status,'providerReference',v_outbound.provider_reference);
  end if;

  v_conversation:=fmat.ensure_setup_conversation(v_host_id);
  select * into v_conversation from fmat.setup_conversations where id=v_conversation.id for update;
  v_expected:=(p_input->>'expectedRevision')::integer;

  if p_operation='setup_turn_append' then
    if p_input->>'channel' not in ('web','imessage') or length(coalesce(p_input->>'text','')) not between 1 and 10000
      or coalesce(p_input->>'clientTurnId','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'INVALID_INPUT'; end if;
    if (p_actor->>'kind'='host' and p_input->>'channel'<>'web') or (p_actor->>'kind'='worker' and p_input->>'channel'<>'imessage') then raise exception 'FORBIDDEN'; end if;
    select * into v_existing from fmat.setup_turns where id=(p_input->>'clientTurnId')::uuid;
    if found then
      if v_existing.conversation_id<>v_conversation.id or v_existing.text is distinct from p_input->>'text' or v_existing.channel is distinct from p_input->>'channel' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return coalesce(v_existing.result,fmat.setup_conversation_view(v_host_id));
    end if;
    if v_expected is null or v_expected<>v_conversation.revision then raise exception 'CONVERSATION_STALE'; end if;
    if p_actor->>'kind'='worker' then
      select * into v_inbound from fmat.setup_provider_inbound where link_id=v_link.id and provider_message_id=p_input->>'providerMessageId' for update;
      if not found or v_inbound.text is distinct from p_input->>'text' then raise exception 'INBOUND_NOT_FOUND'; end if;
      if exists(select 1 from fmat.setup_provider_inbound where link_id=v_link.id and sequence<v_inbound.sequence and processed_at is null) then raise exception 'INBOUND_OUT_OF_ORDER'; end if;
    end if;
    select coalesce(max(sequence),0)+1 into v_sequence from fmat.setup_turns where conversation_id=v_conversation.id;
    insert into fmat.setup_turns(id,conversation_id,sequence,role,channel,text,provider_message_id)
      values((p_input->>'clientTurnId')::uuid,v_conversation.id,v_sequence,'host',p_input->>'channel',p_input->>'text',nullif(p_input->>'providerMessageId',''));
    if length(coalesce(p_input->>'assistantText',''))>0 then
      v_sequence:=v_sequence+1;
      insert into fmat.setup_turns(id,conversation_id,sequence,role,channel,text) values(gen_random_uuid(),v_conversation.id,v_sequence,'assistant',p_input->>'channel',p_input->>'assistantText');
    end if;
    v_extraction:=p_input->'extraction';
    if v_extraction is not null then
      if jsonb_typeof(v_extraction) is distinct from 'object' or jsonb_typeof(v_extraction->'patch') is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(v_extraction->'patch') k where k not in ('handle','displayName','rules'))
        or jsonb_typeof(coalesce(v_extraction->'ambiguousFields','[]'::jsonb)) is distinct from 'array'
        or jsonb_typeof(coalesce(v_extraction->'unsupportedFields','[]'::jsonb)) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
      select * into v_host from fmat.hosts where id=v_host_id for update;
      select * into v_draft from fmat.setup_drafts where conversation_id=v_conversation.id and status='active';
      if v_draft.base_rules_version is distinct from v_host.rules_version then v_draft.settings:=null; end if;
      v_base:=coalesce(v_draft.settings,jsonb_build_object('handle',v_host.handle,'displayName',v_host.display_name,'rules',v_host.rules));
      v_patch:=v_extraction->'patch';
      v_settings:=v_base||(v_patch-'rules');
      if v_patch ? 'rules' then
        if jsonb_typeof(v_patch->'rules') is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_patch->'rules') k where k not in ('timezone','durationMinutes','availability','focusBlocks','bufferMinutes','travelMode','homeLocation','preferences')) then raise exception 'INVALID_INPUT'; end if;
        v_settings:=jsonb_set(v_settings,'{rules}',case when jsonb_typeof(v_base->'rules')='object' then v_base->'rules' else '{}'::jsonb end||(v_patch->'rules'),true);
      end if;
      select coalesce(array_agg(value),'{}') into v_unresolved from (
        select value from jsonb_array_elements_text(coalesce(v_extraction->'ambiguousFields','[]'::jsonb))
        union select value from jsonb_array_elements_text(coalesce(v_extraction->'unsupportedFields','[]'::jsonb))
      ) unresolved;
      update fmat.setup_drafts set status='superseded' where conversation_id=v_conversation.id and status='active';
      update fmat.setup_reviews set status='superseded' where conversation_id=v_conversation.id and status='pending';
      select coalesce(max(revision),0)+1 into v_draft_revision from fmat.setup_drafts where conversation_id=v_conversation.id;
      insert into fmat.setup_drafts(conversation_id,revision,base_rules_version,settings,unresolved) values(v_conversation.id,v_draft_revision,v_host.rules_version,v_settings,v_unresolved) returning * into v_draft;
      if cardinality(v_unresolved)=0 and coalesce(v_settings->>'handle','')<>'' and coalesce(v_settings->>'displayName','')<>'' and jsonb_typeof(v_settings->'rules')='object'
        and v_settings->'rules' ?& array['timezone','durationMinutes','availability','focusBlocks','bufferMinutes','travelMode','preferences'] then
        if v_settings->>'handle' !~ '^[a-z][a-z0-9-]{2,39}$' or v_settings->>'handle' in ('host','requests','api','operator','auth','skills') or length(trim(v_settings->>'displayName')) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
        perform fmat.validate_rules(v_settings->'rules');
        select coalesce(max(revision),0)+1 into v_review_revision from fmat.setup_reviews where conversation_id=v_conversation.id;
        insert into fmat.setup_reviews(conversation_id,revision,draft_revision,settings) values(v_conversation.id,v_review_revision,v_draft_revision,v_settings);
      end if;
    end if;
    update fmat.setup_conversations set revision=revision+1,updated_at=now() where id=v_conversation.id;
    if p_actor->>'kind'='worker' and p_input ? 'providerMessageId' then update fmat.setup_provider_inbound set processed_at=coalesce(processed_at,now()) where provider_message_id=p_input->>'providerMessageId' and link_id=v_link.id; end if;
    v_result:=fmat.setup_conversation_view(v_host_id);
    update fmat.setup_turns set result=v_result where id=(p_input->>'clientTurnId')::uuid;
    if p_actor->>'kind'='worker' then update fmat.setup_provider_inbound set result=v_result where id=v_inbound.id; end if;
    return v_result;
  elsif p_operation='setup_review_confirm' then
    if v_expected is null or v_expected<>v_conversation.revision then raise exception 'CONVERSATION_STALE'; end if;
    if p_actor->>'kind'='worker' then
      select * into v_inbound from fmat.setup_provider_inbound where link_id=v_link.id and provider_message_id=p_input->>'providerMessageId' for update;
      if not found then raise exception 'INBOUND_NOT_FOUND'; end if;
      if exists(select 1 from fmat.setup_provider_inbound where link_id=v_link.id and sequence<v_inbound.sequence and processed_at is null) then raise exception 'INBOUND_OUT_OF_ORDER'; end if;
    end if;
    select * into v_host from fmat.hosts where id=v_host_id for update;
    select * into v_review from fmat.setup_reviews where conversation_id=v_conversation.id and revision=(p_input->>'reviewRevision')::integer for update;
    if not found or v_review.status<>'pending' then raise exception 'REVIEW_STALE'; end if;
    select * into strict v_draft from fmat.setup_drafts where conversation_id=v_conversation.id and revision=v_review.draft_revision for update;
    if (p_input->>'expectedDraftRevision')::integer is distinct from v_draft.revision or v_draft.status<>'active' then raise exception 'DRAFT_STALE'; end if;
    if (p_input->>'expectedRulesVersion')::integer is distinct from v_host.rules_version or v_draft.base_rules_version<>v_host.rules_version then raise exception 'RULES_STALE'; end if;
    v_result:=fmat.onboarding_command('setup_save',case when p_actor->>'kind'='worker' then jsonb_build_object('kind','host','id',v_host.id,'email',v_host.email) else p_actor end,jsonb_build_object('handle',v_review.settings->>'handle','displayName',v_review.settings->>'displayName','rules',v_review.settings->'rules'));
    update fmat.setup_drafts set status='confirmed' where conversation_id=v_conversation.id and revision=v_draft.revision;
    update fmat.setup_reviews set status='confirmed',confirmed_at=now() where conversation_id=v_conversation.id and revision=v_review.revision;
    select coalesce(max(sequence),0)+1 into v_sequence from fmat.setup_turns where conversation_id=v_conversation.id;
    if p_actor->>'kind'='worker' then
      insert into fmat.setup_turns(id,conversation_id,sequence,role,channel,text,provider_message_id) values(v_inbound.id,v_conversation.id,v_sequence,'host','imessage',v_inbound.text,v_inbound.provider_message_id);
      v_sequence:=v_sequence+1;
    end if;
    insert into fmat.setup_turns(id,conversation_id,sequence,role,channel,text) values(gen_random_uuid(),v_conversation.id,v_sequence,'system','system','Settings confirmed.');
    update fmat.setup_conversations set revision=revision+1,updated_at=now() where id=v_conversation.id;
    v_result:=fmat.setup_conversation_view(v_host_id);
    if p_actor->>'kind'='worker' then update fmat.setup_provider_inbound set processed_at=coalesce(processed_at,now()),result=v_result where id=v_inbound.id; end if;
    return v_result;
  end if;
  raise exception 'UNKNOWN_OPERATION';
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.setup_conversation_view (
  p_host_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare v_conversation fmat.setup_conversations; v_draft fmat.setup_drafts; v_review fmat.setup_reviews; v_link fmat.setup_channel_links; v_challenge fmat.setup_channel_challenges; v_challenge_outbound fmat.setup_provider_outbound;
begin
  select * into v_conversation from fmat.setup_conversations where host_id=p_host_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_draft from fmat.setup_drafts where conversation_id=v_conversation.id order by revision desc limit 1;
  select * into v_review from fmat.setup_reviews where conversation_id=v_conversation.id order by revision desc limit 1;
  select * into v_link from fmat.setup_channel_links where host_id=p_host_id and revoked_at is null order by linked_at desc limit 1;
  select * into v_challenge from fmat.setup_channel_challenges where host_id=p_host_id and consumed_at is null and expires_at>now() order by created_at desc limit 1;
  if v_challenge.id is not null then select * into v_challenge_outbound from fmat.setup_provider_outbound where challenge_id=v_challenge.id; end if;
  return jsonb_build_object(
    'id',v_conversation.id,'revision',v_conversation.revision,
    'turns',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'sequence',t.sequence,'role',t.role,'channel',t.channel,'text',t.text,'createdAt',t.created_at) order by t.sequence),'[]'::jsonb) from fmat.setup_turns t where t.conversation_id=v_conversation.id),
    'draft',case when v_draft.conversation_id is null then null else jsonb_build_object('revision',v_draft.revision,'baseRulesVersion',v_draft.base_rules_version,'settings',v_draft.settings,'unresolved',to_jsonb(v_draft.unresolved),'status',v_draft.status,'createdAt',v_draft.created_at) end,
    'review',case when v_review.conversation_id is null then null else jsonb_build_object('revision',v_review.revision,'draftRevision',v_review.draft_revision,'settings',v_review.settings,'status',v_review.status,'createdAt',v_review.created_at) end,
    'setup',fmat.setup_view(p_host_id),
    'linkChallenge',case when v_challenge.id is null then null else jsonb_build_object('id',v_challenge.id,'method',v_challenge.method,'expiresAt',v_challenge.expires_at,'claimed',v_challenge.claimed_at is not null,'maskedSender',case when coalesce(v_challenge.expected_sender_id,v_challenge.claimed_sender_id) is null then null else left(coalesce(v_challenge.expected_sender_id,v_challenge.claimed_sender_id),2)||'…'||right(coalesce(v_challenge.expected_sender_id,v_challenge.claimed_sender_id),2) end,'deliveryStatus',v_challenge_outbound.status) end,
    'channelLink',case when v_link.id is null then null else jsonb_build_object('id',v_link.id,'provider',v_link.provider,'linkedAt',v_link.linked_at) end
  );
end;
$function$;

ALTER TABLE "fmat"."setup_channel_challenges"
  ADD CONSTRAINT "setup_channel_challenges_check3" CHECK ((((method = 'otp'::text) AND (expected_sender_id IS NOT NULL)) OR (method = 'link'::text)));

ALTER TABLE "fmat"."setup_channel_challenges"
  ADD CONSTRAINT "setup_channel_challenges_check4" CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:10:00'::interval))));

ALTER TABLE "fmat"."setup_channel_challenges"
  ADD CONSTRAINT "setup_channel_challenges_failed_attempts_check" CHECK (((failed_attempts >= 0) AND (failed_attempts <= 5)));

ALTER TABLE "fmat"."setup_channel_challenges"
  ADD CONSTRAINT "setup_channel_challenges_method_check" CHECK ((method = ANY (ARRAY['link'::text, 'otp'::text])));

ALTER TABLE "fmat"."setup_provider_outbound"
  ADD CONSTRAINT "setup_provider_outbound_challenge_id_fkey" FOREIGN KEY (challenge_id) REFERENCES fmat.setup_channel_challenges(id);

ALTER TABLE "fmat"."setup_provider_outbound"
  ADD CONSTRAINT "setup_provider_outbound_challenge_id_key" UNIQUE (challenge_id);

ALTER TABLE "fmat"."setup_provider_outbound"
  ADD CONSTRAINT "setup_provider_outbound_check" CHECK ((((inbound_id IS NOT NULL) AND (link_id IS
    NOT NULL) AND (continuation_id IS NULL) AND (challenge_id IS NULL)) OR ((inbound_id IS NULL) AND (link_id IS NULL) AND (continuation_id IS
    NOT NULL) AND (challenge_id IS NULL)) OR ((inbound_id IS NULL) AND (link_id IS NULL) AND (continuation_id IS NULL) AND (challenge_id IS NOT NULL))));
