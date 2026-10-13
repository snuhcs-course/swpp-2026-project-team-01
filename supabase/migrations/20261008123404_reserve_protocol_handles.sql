SET local check_function_bodies = off;

ALTER TABLE "fmat"."hosts"
  DROP CONSTRAINT "hosts_handle_check";

CREATE OR REPLACE FUNCTION fmat.onboarding_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_host_id uuid; v_email text; v_invite fmat.invitations; v_host fmat.hosts;
  v_exchange fmat.oauth_exchanges; v_connection fmat.calendar_connections; v_principal uuid; v_kind text;
  v_scopes text[]; v_conflicts text[]; v_id uuid; v_requested text;
begin
  perform fmat.onboarding_authorize(p_operation,p_actor,p_input);
  case p_operation
  when 'waitlist_join' then
    v_email:=lower(trim(p_input->>'email'));
    if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(coalesce(p_input->>'name',''))>200 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.waitlist(email,name) values(v_email,nullif(trim(p_input->>'name'),'')) on conflict(email) do nothing;
    return jsonb_build_object('status','pending');
  when 'invite_issue','invitation_create' then
    v_email:=lower(trim(p_input->>'email'));
    if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(p_input->>'tokenHash','') !~ '^[0-9a-f]{64}$'
      or (p_input->>'expiresAt')::timestamptz is null or (p_input->>'expiresAt')::timestamptz<=now() or (p_input->>'expiresAt')::timestamptz>now()+interval '7 days' then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.invitations(email,token_hash,expires_at,issued_by) values(v_email,p_input->>'tokenHash',(p_input->>'expiresAt')::timestamptz,p_actor->>'id') returning id into v_id;
    perform fmat.audit(p_operation,p_actor,v_id::text,jsonb_build_object('email',v_email));
    return jsonb_build_object('invitationId',v_id,'email',v_email,'expiresAt',p_input->>'expiresAt');
  when 'invite_revoke' then
    update fmat.invitations set revoked_at=now() where id=(p_input->>'invitationId')::uuid returning * into v_invite;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform fmat.audit(p_operation,p_actor,v_invite.id::text);
    return jsonb_build_object('ok',true);
  when 'invite_redeem' then
    v_host_id:=fmat.require_host(p_actor,false);
    select * into v_invite from fmat.invitations where token_hash=p_input->>'tokenHash' for update;
    if not found or v_invite.revoked_at is not null or (v_invite.redeemed_by is null and v_invite.expires_at<=now()) then raise exception 'INVITATION_INVALID'; end if;
    if v_invite.email is distinct from lower(p_actor->>'email') then raise exception 'INVITATION_INVALID'; end if;
    if v_invite.redeemed_by is not null and v_invite.redeemed_by<>v_host_id then raise exception 'INVITATION_INVALID'; end if;
    if exists(select 1 from fmat.hosts where id=v_host_id and revoked_at is not null) then raise exception 'HOST_NOT_ADMITTED'; end if;
    update fmat.invitations set redeemed_by=v_host_id,redeemed_at=coalesce(redeemed_at,now()) where id=v_invite.id;
    insert into fmat.hosts(id,email,invitation_id) values(v_host_id,v_invite.email,v_invite.id) on conflict(id) do nothing;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'setup_read','calendar_read' then return fmat.setup_view(fmat.require_host(p_actor,false));
  when 'setup_save' then
    v_host_id:=fmat.require_host(p_actor,true);
    if not fmat.valid_public_handle(p_input->>'handle')
      or length(trim(coalesce(p_input->>'displayName',''))) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
    perform fmat.validate_rules(p_input->'rules');
    update fmat.hosts set handle=p_input->>'handle',display_name=trim(p_input->>'displayName'),rules=p_input->'rules',rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'host_public' then
    select * into v_host from fmat.hosts where handle=p_input->>'handle';
    if not found or not fmat.host_ready(v_host) then raise exception 'NOT_FOUND'; end if;
    return jsonb_build_object('id',v_host.id,'handle',v_host.handle,'displayName',v_host.display_name,'timezone',v_host.rules->>'timezone','ready',true,'durationMinutes',(v_host.rules->>'durationMinutes')::integer);
  when 'oauth_start' then
    if coalesce(p_input->>'stateHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_input->>'bindingHash','') !~ '^[0-9a-f]{64}$'
      or length(coalesce(p_input->>'encryptedVerifier',''))<20 or jsonb_typeof(p_input->'context') is distinct from 'object'
      or coalesce(p_input->'context'->>'redirectUri','') !~ '^https?://' then raise exception 'INVALID_INPUT'; end if;
    if p_actor->>'kind'='guest' and (p_input->'context'->>'requestId') is distinct from p_actor->>'requestId' then raise exception 'FORBIDDEN'; end if;
    if p_actor->>'kind'='host' and p_input->'context' ? 'requestId' then raise exception 'FORBIDDEN'; end if;
    insert into fmat.oauth_exchanges(state_hash,binding_hash,actor,context,encrypted_verifier)
      values(p_input->>'stateHash',p_input->>'bindingHash',p_actor,p_input->'context',p_input->>'encryptedVerifier') returning * into v_exchange;
    perform fmat.audit(p_operation,p_actor,v_exchange.id::text);
    return jsonb_build_object('exchangeId',v_exchange.id,'encryptedVerifier',v_exchange.encrypted_verifier,'context',v_exchange.context);
  when 'oauth_consume' then
    select * into v_exchange from fmat.oauth_exchanges where state_hash=p_input->>'stateHash' for update;
    if not found or v_exchange.binding_hash is distinct from p_input->>'bindingHash' or v_exchange.consumed_at is not null or v_exchange.expires_at<=now() then raise exception 'OAUTH_STATE_INVALID'; end if;
    if v_exchange.actor->>'kind'='host' then perform fmat.require_host(v_exchange.actor,true);
    else perform fmat.authorize_guest(v_exchange.actor,(v_exchange.actor->>'requestId')::uuid); end if;
    update fmat.oauth_exchanges set consumed_at=now() where id=v_exchange.id;
    return jsonb_build_object('actor',v_exchange.actor,'context',v_exchange.context,'encryptedVerifier',v_exchange.encrypted_verifier,'exchangeId',v_exchange.id);
  when 'credential_save' then
    select * into v_exchange from fmat.oauth_exchanges where id=(p_input->>'exchangeId')::uuid for update;
    if not found or v_exchange.consumed_at is null or v_exchange.saved_at is not null or v_exchange.expires_at<=now() then raise exception 'OAUTH_STATE_INVALID'; end if;
    v_kind:=v_exchange.actor->>'kind';
    if v_kind='host' then v_principal:=fmat.require_host(v_exchange.actor,true);
    else v_principal:=(v_exchange.actor->>'requestId')::uuid; perform fmat.authorize_guest(v_exchange.actor,v_principal); end if;
    select array_agg(value) into v_scopes from jsonb_array_elements_text(p_input->'scopes');
    if v_kind='host' and not coalesce(v_scopes @> array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],false) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if v_kind='guest' and not coalesce(v_scopes @> array['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],false) then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if v_kind='guest' and v_scopes && array['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar'] then raise exception 'INSUFFICIENT_SCOPES'; end if;
    if length(coalesce(p_input->>'encryptedCredential',''))<20 or length(coalesce(p_input->>'providerSubject','')) not between 1 and 300 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
      values(v_kind,v_principal,p_input->>'providerSubject',v_scopes,p_input->>'encryptedCredential')
      on conflict(principal_kind,principal_id) do update set provider_subject=excluded.provider_subject,scopes=excluded.scopes,encrypted_credential=excluded.encrypted_credential,revoked_at=null,updated_at=now()
      returning id into v_id;
    update fmat.oauth_exchanges set saved_at=now(),encrypted_verifier=null where id=v_exchange.id;
    if v_kind='host' then update fmat.hosts set conflict_calendar_ids='{}',booking_calendar_id=null,updated_at=now() where id=v_principal; end if;
    perform fmat.audit(p_operation,p_actor,v_id::text,jsonb_build_object('principalKind',v_kind));
    return jsonb_build_object('connectionId',v_id);
  when 'connection_read' then
    if (p_input ? 'hostId')=(p_input ? 'requestId') then raise exception 'INVALID_INPUT'; end if;
    v_kind:=case when p_input ? 'hostId' then 'host' else 'guest' end;
    v_principal:=coalesce(p_input->>'hostId',p_input->>'requestId')::uuid;
    if v_kind='host' and not exists(select 1 from fmat.hosts where id=v_principal and revoked_at is null) then raise exception 'HOST_NOT_ADMITTED'; end if;
    select * into v_connection from fmat.calendar_connections where principal_kind=v_kind and principal_id=v_principal and revoked_at is null;
    if not found then raise exception 'RECONNECT_REQUIRED'; end if;
    select * into v_host from fmat.hosts where id=v_principal and v_kind='host';
    return jsonb_build_object('connectionId',v_connection.id,'encryptedCredential',v_connection.encrypted_credential,'scopes',to_jsonb(v_connection.scopes),'conflictCalendarIds',to_jsonb(coalesce(v_host.conflict_calendar_ids,'{}')),'bookingCalendarId',v_host.booking_calendar_id);
  when 'token_update' then
    if length(coalesce(p_input->>'encryptedCredential',''))<20 then raise exception 'INVALID_INPUT'; end if;
    update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=now() where id=(p_input->>'connectionId')::uuid and revoked_at is null returning id into v_id;
    if not found then raise exception 'RECONNECT_REQUIRED'; end if;
    return jsonb_build_object('ok',true);
  when 'calendar_save' then
    v_host_id:=fmat.require_host(p_actor,true);
    if not exists(select 1 from fmat.calendar_connections where principal_kind='host' and principal_id=v_host_id and revoked_at is null) then raise exception 'RECONNECT_REQUIRED'; end if;
    if jsonb_typeof(p_input->'conflictCalendarIds') is distinct from 'array' or jsonb_typeof(p_input->'verifiedCalendars') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    select array_agg(distinct value) into v_conflicts from jsonb_array_elements_text(p_input->'conflictCalendarIds');
    if coalesce(cardinality(v_conflicts),0) not between 1 and 50 then raise exception 'INVALID_INPUT'; end if;
    foreach v_requested in array v_conflicts loop
      if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=v_requested and c->>'accessRole' in ('reader','writer','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    end loop;
    if not exists(select 1 from jsonb_array_elements(p_input->'verifiedCalendars') c where c->>'id'=p_input->>'bookingCalendarId' and c->>'accessRole' in ('writer','owner')) then raise exception 'CALENDAR_ACCESS_INVALID'; end if;
    update fmat.hosts set conflict_calendar_ids=v_conflicts,booking_calendar_id=p_input->>'bookingCalendarId',rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'calendar_disconnect' then
    v_host_id:=fmat.require_host(p_actor,true);
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=now(),updated_at=now() where principal_kind='host' and principal_id=v_host_id;
    update fmat.hosts set conflict_calendar_ids='{}',booking_calendar_id=null,rules_version=rules_version+1,updated_at=now() where id=v_host_id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,now()),encrypted_verifier=null where actor->>'kind'='host' and actor->>'id'=v_host_id::text and saved_at is null;
    perform fmat.audit(p_operation,p_actor,v_host_id::text);
    return fmat.setup_view(v_host_id);
  when 'oauth_cleanup' then
    return jsonb_build_object('cleared',fmat.cleanup_oauth());
  else raise exception 'UNKNOWN_OPERATION';
  end case;
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
        if not fmat.valid_public_handle(v_settings->>'handle') or length(trim(v_settings->>'displayName')) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
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

CREATE OR REPLACE FUNCTION fmat.valid_public_handle (
  p_handle text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(p_handle ~ '^[a-z][a-z0-9-]{2,39}$' and p_handle not in
    ('host','requests','api','operator','auth','skills','app','booking','connections','connect','_next','favicon','robots','sitemap','mcp','oauth'),false);
$function$;

CREATE OR REPLACE FUNCTION fmat.validate_setup_patch (
  p_patch jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare r jsonb; item jsonb; k text;
begin
 if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}' or exists(select 1 from jsonb_object_keys(p_patch) x where x not in ('handle','displayName','rules')) then raise exception 'INVALID_INPUT'; end if;
 if p_patch ? 'handle' and (jsonb_typeof(p_patch->'handle') is distinct from 'string' or not fmat.valid_public_handle(p_patch->>'handle')) then raise exception 'INVALID_INPUT'; end if;
 if p_patch ? 'displayName' and (jsonb_typeof(p_patch->'displayName') is distinct from 'string' or length(trim(p_patch->>'displayName')) not between 1 and 120) then raise exception 'INVALID_INPUT'; end if;
 if not p_patch ? 'rules' then return; end if;
 r:=p_patch->'rules';
 if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) x where x not in ('timezone','durationMinutes','availability','focusBlocks','bufferMinutes','travelMode','homeLocation','preferences','meetingMode','locationPolicy','locations','travelBufferMinutes')) then raise exception 'INVALID_INPUT'; end if;
 if r ? 'timezone' and (jsonb_typeof(r->'timezone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=r->>'timezone')) then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['durationMinutes','bufferMinutes','travelBufferMinutes'] loop
  if r ? k and (jsonb_typeof(r->k) is distinct from 'number' or r->>k !~ '^[0-9]+$' or (r->>k)::numeric not between case when k='durationMinutes' then 5 else 0 end and 240) then raise exception 'INVALID_INPUT'; end if;
 end loop;
 if r ? 'meetingMode' and coalesce(r->>'meetingMode','') not in ('online','in_person','either') then raise exception 'INVALID_INPUT'; end if;
 if r ? 'locationPolicy' and coalesce(r->>'locationPolicy','') not in ('per_meeting','preferred') then raise exception 'INVALID_INPUT'; end if;
 if r ? 'travelMode' and coalesce(r->>'travelMode','') not in ('DRIVE','TRANSIT','WALK','BICYCLE','PER_TRIP','NONE') then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['homeLocation','preferences'] loop
  if r ? k and (jsonb_typeof(r->k) is distinct from 'string' or length(r->>k)>case when k='homeLocation' then 2000 else 5000 end) then raise exception 'INVALID_INPUT'; end if;
 end loop;
 if r ? 'locations' then
  if jsonb_typeof(r->'locations') is distinct from 'array' or jsonb_array_length(r->'locations')>10 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'locations') loop
   if jsonb_typeof(item) is distinct from 'string' or length(trim(item#>>'{}')) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
 if r ? 'availability' then
  if jsonb_typeof(r->'availability') is distinct from 'array' or jsonb_array_length(r->'availability') not between 1 and 21 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'availability') loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) x where x not in ('days','start','end')) or jsonb_typeof(item->'days') is distinct from 'array' or jsonb_array_length(item->'days') not between 1 and 7
    or coalesce(item->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(item->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'start'>=item->>'end' then raise exception 'INVALID_INPUT'; end if;
   if exists(select 1 from jsonb_array_elements(item->'days') d where jsonb_typeof(d) is distinct from 'number' or d::text !~ '^[0-6]$') then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
 if r ? 'focusBlocks' then
  if jsonb_typeof(r->'focusBlocks') is distinct from 'array' or jsonb_array_length(r->'focusBlocks')>100 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(r->'focusBlocks') loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) x where x not in ('start','end')) or coalesce(item->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(item->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or (item->>'start')::timestamptz>=(item->>'end')::timestamptz then raise exception 'INVALID_INPUT'; end if;
  end loop;
 end if;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_public_intake (
  p_operation  text,
  p_token_hash text,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare h fmat.hosts; g fmat.calendar_connections; u auth.users; r fmat.requests;
 v_result jsonb; v_details jsonb; v_record fmat.idempotency; v_host uuid; v_state jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or not fmat.valid_public_handle(p_input->>'handle')
  or p_operation is null or p_operation not in ('context','check','refresh','create','replay','resume') then raise exception 'INVALID_INPUT'; end if;
 if p_operation in ('create','replay','resume') then
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'UNAUTHORIZED'; end if;
  -- Serialize recovery and submission even before a request row exists.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-intake:'||p_token_hash,0));
  select q.* into r from fmat.requests q join fmat.hosts host on host.id=q.host_id
   where q.token_hash=p_token_hash and host.handle=p_input->>'handle' for update of q;
  if found then
   if r.token_expires_at<=clock_timestamp() then raise exception 'NOT_FOUND'; end if;
   if p_operation in ('create','replay') then
    select * into v_record from fmat.idempotency where actor_scope='public:'||p_token_hash and operation='request_create' and key='browser-intake';
    if not found or v_record.input->'details' is distinct from p_input->'details' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   end if;
   v_state:=public.fmat_browser_command('guest_state',jsonb_build_object('kind','guest','requestId',r.id,'tokenHash',p_token_hash),'{}');
   return jsonb_build_object('requestId',r.id,'tokenExpiresAt',r.token_expires_at,'closed',v_state->'closed');
  end if;
  if exists(select 1 from fmat.requests where token_hash=p_token_hash) then raise exception 'NOT_FOUND'; end if;
  -- A rotated token is no longer on its request row. Its creation receipt must
  -- not be mistaken for an unused proof and offered a second creation attempt.
  if exists(select 1 from fmat.idempotency where actor_scope='public:'||p_token_hash and operation='request_create' and key='browser-intake' and result is not null) then raise exception 'NOT_FOUND'; end if;
  if p_operation in ('resume','replay') then return null; end if;
 end if;
 -- Match Auth -> host -> connection ordering used by authenticated setup.
 -- Session logout is irrelevant to a published profile, account revocation is not.
 select id into v_host from fmat.hosts where handle=p_input->>'handle';
 select * into u from auth.users where id=v_host for share;
 if not found or u.deleted_at is not null or u.banned_until>clock_timestamp() or u.email_confirmed_at is null then raise exception 'NOT_FOUND'; end if;
 select * into h from fmat.hosts where id=v_host and handle=p_input->>'handle' for share;
 if not found or not fmat.host_ready(h) then raise exception 'NOT_FOUND'; end if;
 select * into g from fmat.calendar_connections where principal_kind='host' and principal_id=h.id and revoked_at is null for update;
 if not found or not fmat.host_ready(h) then raise exception 'NOT_FOUND'; end if;
 if p_operation='context' then
  return jsonb_build_object('profile',jsonb_build_object('handle',h.handle,'displayName',h.display_name,'timezone',h.rules->>'timezone','durationMinutes',h.rules->'durationMinutes'),
   'grant',jsonb_build_object('principalId',h.id,'connectionId',g.id,'generation',g.generation,'encryptedCredential',g.encrypted_credential,
    'rulesVersion',h.rules_version,'conflictCalendarIds',to_jsonb(h.conflict_calendar_ids),'bookingCalendarId',h.booking_calendar_id));
 end if;
 if (p_input->>'connectionId')::uuid is distinct from g.id or (p_input->>'generation')::uuid is distinct from g.generation
  or (p_input->>'rulesVersion')::integer is distinct from h.rules_version then raise exception 'REVISION_CONFLICT'; end if;
 if p_operation='check' then return jsonb_build_object('current',true); end if;
 if p_operation='refresh' then
  if p_input->>'previousCredential' is distinct from g.encrypted_credential then raise exception 'REVISION_CONFLICT'; end if;
  if length(coalesce(p_input->>'encryptedCredential','')) not between 20 and 131072 then raise exception 'INVALID_INPUT'; end if;
  update fmat.calendar_connections set encrypted_credential=p_input->>'encryptedCredential',updated_at=clock_timestamp() where id=g.id;
  return jsonb_build_object('refreshed',true);
 end if;
 if p_operation='create' then
  if jsonb_typeof(p_input->'details') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input->'details') k
   where k not in ('requesterName','requesterEmail','purpose','timezone','durationMinutes','mode','location','windows')) then raise exception 'INVALID_INPUT'; end if;
  v_details:=fmat.normalize_details(p_input->'details');
  v_result:=public.fmat_command('request_create',jsonb_build_object('kind','public','tokenHash',p_token_hash),
   jsonb_build_object('handle',h.handle,'details',p_input->'details','tokenHash',p_token_hash,'idempotencyKey','browser-intake'));
  select * into strict r from fmat.requests where id=(v_result->>'id')::uuid;
  perform fmat.apply_intake_identity(r.id,h.handle,p_token_hash);
  return jsonb_build_object('requestId',r.id,'tokenExpiresAt',r.token_expires_at,'closed',false);
 end if;
 raise exception 'FORBIDDEN';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_INPUT';
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_requester_identity (
  p_operation text,
  p_authority jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare f fmat.requester_identity_flows; r fmat.requests; v_kind text; v_target text; v_hash text; v_return text; v_identity jsonb;
begin
 if p_operation is null or p_operation not in ('lookup','read','start','consume','save','skip','apply') or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 if p_operation='lookup' then
  select * into f from fmat.requester_identity_flows where state_hash=p_input->>'stateHash';
  if not found or f.binding_hash is distinct from p_input->>'bindingHash' or f.expires_at<=clock_timestamp() or f.consumed_at is not null or f.superseded_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
  return jsonb_build_object('kind',f.kind,'target',f.target);
 end if;
 v_kind:=p_authority->>'kind';v_hash:=p_authority->>'tokenHash';
 if coalesce(v_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'UNAUTHORIZED';end if;
 if v_kind='intake' then
  v_target:=p_authority->>'handle';
  if not fmat.valid_public_handle(v_target) then raise exception 'INVALID_INPUT';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-intake:'||v_hash,0));
  -- A submitted or rotated intake cannot be reused as an unbound identity draft.
  if exists(select 1 from fmat.requests where token_hash=v_hash) or exists(select 1 from fmat.idempotency where actor_scope='public:'||v_hash and operation='request_create' and result is not null) then raise exception 'NOT_FOUND';end if;
  if not exists(select 1 from fmat.hosts h join auth.users u on u.id=h.id where h.handle=v_target and fmat.host_ready(h) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and u.email_confirmed_at is not null) then raise exception 'NOT_FOUND';end if;
  v_return:='/'||v_target;
 elsif v_kind='guest' then
  v_target:=p_authority->>'requestId';
  select * into r from fmat.requests where id=v_target::uuid for update;
  if not found or r.token_hash is distinct from v_hash or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp()
   or r.status not in ('gathering','negotiating','awaiting_approval') then raise exception 'NOT_FOUND';end if;
  v_return:='/booking/'||r.id::text;
 else raise exception 'FORBIDDEN';end if;
 -- Request first, then scope/flow locks. Intake creation uses the same scope lock.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requester-identity:'||v_kind||':'||v_target||':'||v_hash,0));
 select * into f from fmat.requester_identity_flows where kind=v_kind and target=v_target and token_hash=v_hash order by created_at desc,id desc limit 1 for update;
 if p_operation='start' then
  if coalesce(p_input->>'stateHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'bindingHash','') !~ '^[a-f0-9]{64}$'
   or length(coalesce(p_input->>'encryptedVerifier','')) not between 20 and 16384 or jsonb_typeof(p_input->'draft') is distinct from 'object'
   or octet_length((p_input->'draft')::text)>16384 then raise exception 'INVALID_INPUT';end if;
  if v_kind='guest' and r.revision is distinct from (p_input->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
  if (select count(*) from fmat.requester_identity_flows where kind=v_kind and target=v_target and token_hash=v_hash and created_at>clock_timestamp()-interval '10 minutes')>=10 then raise exception 'CONSENT_LIMIT';end if;
  update fmat.requester_identity_flows set superseded_at=clock_timestamp(),encrypted_verifier=null where kind=v_kind and target=v_target and token_hash=v_hash and superseded_at is null;
  insert into fmat.requester_identity_flows(id,kind,target,token_hash,state_hash,binding_hash,encrypted_verifier,draft,request_revision)
   values((p_input->>'flowId')::uuid,v_kind,v_target,v_hash,p_input->>'stateHash',p_input->>'bindingHash',p_input->>'encryptedVerifier',p_input->'draft',r.revision);
  return jsonb_build_object('started',true);
 end if;
 if p_operation='skip' then
  update fmat.requester_identity_flows set superseded_at=clock_timestamp(),encrypted_verifier=null where kind=v_kind and target=v_target and token_hash=v_hash and superseded_at is null;
  return jsonb_build_object('skipped',true);
 end if;
 if p_operation='read' then
  if f.id is null or f.draft_expires_at<=clock_timestamp() then return null;end if;
  return jsonb_build_object('draft',f.draft,'identity',case when f.superseded_at is null and f.saved_at>clock_timestamp()-interval '1 hour' then f.identity-'subject' else null end);
 end if;
 if f.id is null or f.superseded_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
 if p_operation in ('consume','save') then
  if f.expires_at<=clock_timestamp() or (v_kind='guest' and f.request_revision is distinct from r.revision) then raise exception 'OAUTH_STATE_INVALID';end if;
  if p_operation='consume' then
   if f.state_hash is distinct from p_input->>'stateHash' or f.binding_hash is distinct from p_input->>'bindingHash' or f.consumed_at is not null then raise exception 'OAUTH_STATE_INVALID';end if;
   update fmat.requester_identity_flows set consumed_at=clock_timestamp(),encrypted_verifier=null where id=f.id;
   return jsonb_build_object('flowId',f.id,'returnPath',v_return,'encryptedVerifier',f.encrypted_verifier);
  end if;
  if f.id is distinct from (p_input->>'flowId')::uuid or f.consumed_at is null then raise exception 'OAUTH_STATE_INVALID';end if;
  v_identity:=p_input->'identity';
  if jsonb_typeof(v_identity) is distinct from 'object' or length(coalesce(v_identity->>'subject','')) not between 1 and 300
   or length(coalesce(v_identity->>'email','')) not between 3 and 254 or v_identity->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or v_identity->>'email'<>lower(v_identity->>'email') or jsonb_typeof(v_identity->'contactVerified') is distinct from 'boolean'
   or length(coalesce(v_identity->>'name',''))>200 or exists(select 1 from jsonb_object_keys(v_identity) k where k not in ('subject','email','name','contactVerified')) then raise exception 'INVALID_INPUT';end if;
  if f.saved_at is not null then
   if f.identity is distinct from v_identity then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return jsonb_build_object('saved',true);
  end if;
  update fmat.requester_identity_flows set identity=v_identity,saved_at=clock_timestamp() where id=f.id;
  return jsonb_build_object('saved',true);
 end if;
 -- The browser explicitly applies proof only to its current reviewed recipient.
 if v_kind<>'guest' then raise exception 'FORBIDDEN';end if;
 if f.saved_at is null or f.saved_at<=clock_timestamp()-interval '1 hour' or f.identity->>'contactVerified' is distinct from 'true' then raise exception 'CONTACT_NOT_VERIFIED';end if;
 if f.identity->>'email' is distinct from r.details->>'requesterEmail' or p_input->>'email' is distinct from r.details->>'requesterEmail' then raise exception 'REVISION_CONFLICT';end if;
 if f.proof_applied_at is not null then
  if r.contact_verified_email=r.details->>'requesterEmail' then return jsonb_build_object('verified',true,'revision',r.revision);end if;
  raise exception 'OAUTH_STATE_INVALID';
 end if;
 if r.revision is distinct from (p_input->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
 update fmat.requests set contact_verified_email=r.details->>'requesterEmail',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
 update fmat.requester_identity_flows set proof_applied_at=clock_timestamp() where id=f.id;
 insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(r.id,r.revision,'google_contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.current_proposal_version);
 perform fmat.audit('google_contact_verified',jsonb_build_object('kind','guest','requestId',r.id),r.id::text,jsonb_build_object('flowId',f.id));
 return jsonb_build_object('verified',true,'revision',r.revision);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;
$function$;

REVOKE ALL ON FUNCTION "fmat"."valid_public_handle"(text) FROM PUBLIC;

ALTER TABLE "fmat"."hosts"
  ADD CONSTRAINT "hosts_handle_check" CHECK (((handle IS NULL) OR fmat.valid_public_handle(handle)));
