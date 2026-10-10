SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE TABLE "fmat"."setup_bridge_checkpoints" (
  "provider"          text                     NOT NULL,
  "provider_sequence" bigint                   NOT NULL,
  "disposition"       text,
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_bridge_checkpoints_pkey" PRIMARY KEY (PROVIDER),
  CONSTRAINT "setup_bridge_checkpoints_provider_check" CHECK ((provider = 'imessage'::text)),
  CONSTRAINT "setup_bridge_checkpoints_provider_sequence_check" CHECK ((provider_sequence >= 0))
);

ALTER TABLE "fmat"."setup_bridge_checkpoints"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_channel_challenges" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_id"                  uuid                     NOT NULL,
  "secret_hash"              text                     NOT NULL,
  "browser_proof_hash"       text                     NOT NULL,
  "provider"                 text                     NOT NULL,
  "expected_sender_id"       text,
  "expected_conversation_id" text,
  "claimed_sender_id"        text,
  "claimed_conversation_id"  text,
  "claimed_at"               timestamp with time zone,
  "expires_at"               timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  "consumed_at"              timestamp with time zone,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_channel_challenges_browser_proof_hash_check" CHECK ((browser_proof_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "setup_channel_challenges_check1" CHECK (((claimed_sender_id IS NULL) = (claimed_at IS NULL))),
  CONSTRAINT "setup_channel_challenges_check2" CHECK (((claimed_conversation_id IS NULL) = (claimed_at IS NULL))),
  CONSTRAINT "setup_channel_challenges_check3" CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:10:00'::interval)))),
  CONSTRAINT "setup_channel_challenges_check" CHECK (((expected_sender_id IS NULL) = (expected_conversation_id IS NULL))),
  CONSTRAINT "setup_channel_challenges_pkey" PRIMARY KEY (id),
  CONSTRAINT "setup_channel_challenges_provider_check" CHECK ((provider = 'imessage'::text)),
  CONSTRAINT "setup_channel_challenges_secret_hash_check" CHECK ((secret_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "setup_channel_challenges_secret_hash_key" UNIQUE (secret_hash)
);

ALTER TABLE "fmat"."setup_channel_challenges"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_channel_links" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_id"                 uuid                     NOT NULL,
  "conversation_id"         uuid                     NOT NULL,
  "provider"                text                     NOT NULL,
  "sender_id"               text                     NOT NULL,
  "private_conversation_id" text                     NOT NULL,
  "challenge_id"            uuid                     NOT NULL,
  "linked_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at"              timestamp with time zone,
  CONSTRAINT "setup_channel_links_pkey" PRIMARY KEY (id),
  CONSTRAINT "setup_channel_links_private_conversation_id_check" CHECK (((length(private_conversation_id) >= 1) AND (length(private_conversation_id) <= 300))),
  CONSTRAINT "setup_channel_links_provider_check" CHECK ((provider = 'imessage'::text)),
  CONSTRAINT "setup_channel_links_sender_id_check" CHECK (((length(sender_id) >= 1) AND (length(sender_id) <= 300)))
);

ALTER TABLE "fmat"."setup_channel_links"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_conversations" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_id"    uuid                     NOT NULL,
  "revision"   integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_conversations_host_id_key" UNIQUE (host_id),
  CONSTRAINT "setup_conversations_pkey" PRIMARY KEY (id),
  CONSTRAINT "setup_conversations_revision_check" CHECK ((revision >= 0))
);

ALTER TABLE "fmat"."setup_conversations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_drafts" (
  "conversation_id"    uuid                     NOT NULL,
  "revision"           integer                  NOT NULL,
  "base_rules_version" integer                  NOT NULL,
  "settings"           jsonb                    NOT NULL,
  "unresolved"         text[]                   NOT NULL DEFAULT '{}'::text[],
  "status"             text                     NOT NULL DEFAULT 'active'::text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_drafts_base_rules_version_check" CHECK ((base_rules_version >= 0)),
  CONSTRAINT "setup_drafts_pkey" PRIMARY KEY (conversation_id, revision),
  CONSTRAINT "setup_drafts_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "setup_drafts_settings_check" CHECK ((jsonb_typeof(settings) = 'object'::text)),
  CONSTRAINT "setup_drafts_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text, 'confirmed'::text])))
);

ALTER TABLE "fmat"."setup_drafts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_link_continuations" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "secret_hash"             text                     NOT NULL,
  "sender_id"               text                     NOT NULL,
  "private_conversation_id" text                     NOT NULL,
  "expires_at"              timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  "consumed_at"             timestamp with time zone,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_link_continuations_check" CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:10:00'::interval)))),
  CONSTRAINT "setup_link_continuations_pkey" PRIMARY KEY (id),
  CONSTRAINT "setup_link_continuations_private_conversation_id_check" CHECK (((length(private_conversation_id) >= 1) AND (length(private_conversation_id) <= 300))),
  CONSTRAINT "setup_link_continuations_secret_hash_check" CHECK ((secret_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "setup_link_continuations_secret_hash_key" UNIQUE (secret_hash),
  CONSTRAINT "setup_link_continuations_sender_id_check" CHECK (((length(sender_id) >= 1) AND (length(sender_id) <= 300)))
);

ALTER TABLE "fmat"."setup_link_continuations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_provider_inbound" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "link_id"                 uuid                     NOT NULL,
  "provider"                text                     NOT NULL,
  "provider_message_id"     text                     NOT NULL,
  "private_conversation_id" text                     NOT NULL,
  "sender_id"               text                     NOT NULL,
  "sequence"                integer                  NOT NULL,
  "occurred_at"             timestamp with time zone NOT NULL,
  "text"                    text                     NOT NULL,
  "processed_at"            timestamp with time zone,
  "result"                  jsonb,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_provider_inbound_link_id_sequence_key" UNIQUE (link_id, SEQUENCE),
  CONSTRAINT "setup_provider_inbound_pkey" PRIMARY KEY (id),
  CONSTRAINT "setup_provider_inbound_provider_check" CHECK ((provider = 'imessage'::text)),
  CONSTRAINT "setup_provider_inbound_provider_message_id_check" CHECK (((length(provider_message_id) >= 1) AND (length(provider_message_id) <= 500))),
  CONSTRAINT "setup_provider_inbound_provider_provider_message_id_key" UNIQUE (PROVIDER, provider_message_id),
  CONSTRAINT "setup_provider_inbound_sequence_check" CHECK ((sequence > 0)),
  CONSTRAINT "setup_provider_inbound_text_check" CHECK (((length(text) >= 1) AND (length(text) <= 10000)))
);

ALTER TABLE "fmat"."setup_provider_inbound"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_provider_outbound" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "inbound_id"         uuid,
  "link_id"            uuid,
  "continuation_id"    uuid,
  "client_message_id"  uuid                     NOT NULL,
  "text"               text                     NOT NULL,
  "status"             text                     NOT NULL DEFAULT 'prepared'::text,
  "provider_reference" text,
  "error_code"         text,
  "prepared_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_provider_outbound_check" CHECK ((((inbound_id IS NOT NULL) AND (link_id IS
    NOT NULL) AND (continuation_id IS NULL)) OR ((inbound_id IS NULL) AND (link_id IS NULL) AND (continuation_id IS NOT NULL)))),
  CONSTRAINT "setup_provider_outbound_client_message_id_key" UNIQUE (client_message_id),
  CONSTRAINT "setup_provider_outbound_continuation_id_key" UNIQUE (continuation_id),
  CONSTRAINT "setup_provider_outbound_inbound_id_key" UNIQUE (inbound_id),
  CONSTRAINT "setup_provider_outbound_pkey" PRIMARY KEY (id),
  CONSTRAINT "setup_provider_outbound_status_check"
    CHECK ((status = ANY (ARRAY['prepared'::text, 'accepted'::text, 'delivered'::text, 'failed'::text, 'uncertain'::text, 'revoked'::text]))),
  CONSTRAINT "setup_provider_outbound_text_check" CHECK (((length(text) >= 1) AND (length(text) <= 10000)))
);

ALTER TABLE "fmat"."setup_provider_outbound"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_reviews" (
  "conversation_id" uuid                     NOT NULL,
  "revision"        integer                  NOT NULL,
  "draft_revision"  integer                  NOT NULL,
  "settings"        jsonb                    NOT NULL,
  "status"          text                     NOT NULL DEFAULT 'pending'::text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_at"    timestamp with time zone,
  CONSTRAINT "setup_reviews_pkey" PRIMARY KEY (conversation_id, revision),
  CONSTRAINT "setup_reviews_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "setup_reviews_settings_check" CHECK ((jsonb_typeof(settings) = 'object'::text)),
  CONSTRAINT "setup_reviews_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'superseded'::text])))
);

ALTER TABLE "fmat"."setup_reviews"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."setup_turns" (
  "id"                  uuid                     NOT NULL,
  "conversation_id"     uuid                     NOT NULL,
  "sequence"            integer                  NOT NULL,
  "role"                text                     NOT NULL,
  "channel"             text                     NOT NULL,
  "text"                text                     NOT NULL,
  "provider_message_id" text,
  "result"              jsonb,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "setup_turns_channel_check" CHECK ((channel = ANY (ARRAY['web'::text, 'imessage'::text, 'system'::text]))),
  CONSTRAINT "setup_turns_conversation_id_id_key" UNIQUE (conversation_id, id),
  CONSTRAINT "setup_turns_conversation_id_sequence_key" UNIQUE (conversation_id, SEQUENCE),
  CONSTRAINT "setup_turns_pkey" PRIMARY KEY (id),
  CONSTRAINT "setup_turns_role_check" CHECK ((role = ANY (ARRAY['host'::text, 'assistant'::text, 'system'::text]))),
  CONSTRAINT "setup_turns_sequence_check" CHECK ((sequence > 0)),
  CONSTRAINT "setup_turns_text_check" CHECK (((length(text) >= 1) AND (length(text) <= 10000)))
);

ALTER TABLE "fmat"."setup_turns"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.authorize_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if fmat.is_setup_conversation_operation(p_operation) then perform fmat.setup_conversation_authorize(p_operation,p_actor,p_input);
  elsif p_operation like 'jobs_%' or p_operation='foundation_ping' then
    if p_actor->>'kind' not in ('worker','operator') or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  elsif p_operation in ('host_approve','booking_load','booking_dispatch','booking_record_outcome','booking_retry','booking_reconcile') then perform fmat.booking_authorize(p_operation,p_actor,p_input);
  elsif fmat.is_delivery_operation(p_operation) then perform fmat.delivery_authorize(p_actor);
  elsif fmat.is_request_operation(p_operation) then perform fmat.request_authorize(p_operation,p_actor,p_input);
  else perform fmat.onboarding_request_authorize(p_operation,p_actor,p_input); end if;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.dispatch_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_result jsonb; v_connection fmat.calendar_connections; v_host fmat.hosts; v_start timestamptz; v_end timestamptz;
begin
  if fmat.is_setup_conversation_operation(p_operation) then return fmat.setup_conversation_command(p_operation,p_actor,p_input); end if;
  if p_operation like 'jobs_%' or p_operation='foundation_ping' then return fmat.foundation_command(p_operation,p_actor,p_input); end if;
  if p_operation in ('host_approve','booking_load','booking_dispatch','booking_record_outcome','booking_retry','booking_reconcile') then return fmat.booking_command(p_operation,p_actor,p_input); end if;
  if fmat.is_delivery_operation(p_operation) then return fmat.delivery_command(p_operation,p_actor,p_input); end if;
  if fmat.is_request_operation(p_operation) then
    v_result:=fmat.request_command(p_operation,p_actor,p_input);
    if p_operation='evaluation_read' then
      select * into strict v_host from fmat.hosts where id=(v_result->>'hostId')::uuid;
      select min((w->>'start')::timestamptz)-interval '1 day',max((w->>'end')::timestamptz)+interval '1 day' into v_start,v_end from jsonb_array_elements(v_result->'details'->'windows') w;
      v_result:=v_result||jsonb_build_object('localBookings',(select coalesce(jsonb_agg(jsonb_build_object('payload',a.payload,'startsAt',a.starts_at,'endsAt',a.ends_at,'mode',p.details->>'mode','calendarId',a.calendar_id) order by a.starts_at,a.id),'[]'::jsonb) from fmat.booking_attempts a join fmat.proposals p on p.request_id=a.request_id and p.version=a.proposal_version where a.host_id=v_host.id and a.request_id<>(v_result->>'requestId')::uuid and a.phase='confirmed' and (a.calendar_id=any(v_host.conflict_calendar_ids) or a.calendar_id=v_host.booking_calendar_id) and a.starts_at<v_end and a.ends_at>v_start));
    end if;
    return v_result;
  end if;
  if p_operation='connection_read' then
    perform 1 from fmat.calendar_connections where principal_kind=case when p_input ? 'hostId' then 'host' else 'guest' end and principal_id=coalesce(p_input->>'hostId',p_input->>'requestId')::uuid for share;
  elsif p_operation='token_update' then
    select * into v_connection from fmat.calendar_connections where id=(p_input->>'connectionId')::uuid for update;
    if not found or v_connection.revoked_at is not null or v_connection.provider_subject is distinct from p_input->>'providerSubject' then raise exception 'RECONNECT_REQUIRED'; end if;
    if v_connection.updated_at is distinct from (p_input->>'expectedUpdatedAt')::timestamptz then raise exception 'FEASIBILITY_STALE'; end if;
  end if;
  v_result:=fmat.onboarding_request_dispatch(p_operation,p_actor,p_input);
  if p_operation in ('connection_read','token_update') then
    select * into v_connection from fmat.calendar_connections where id=coalesce(v_result->>'connectionId',p_input->>'connectionId')::uuid;
    if found then v_result:=v_result||jsonb_build_object('updatedAt',v_connection.updated_at,'providerSubject',v_connection.provider_subject); end if;
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.ensure_setup_conversation (
  p_host_id uuid
)
  RETURNS fmat.setup_conversations
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_conversation fmat.setup_conversations;
begin
  insert into fmat.setup_conversations(host_id) values(p_host_id) on conflict(host_id) do nothing;
  select * into strict v_conversation from fmat.setup_conversations where host_id=p_host_id;
  return v_conversation;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.is_setup_conversation_operation (
  p_operation text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select p_operation in ('setup_conversation_read','setup_turn_append','setup_review_confirm','setup_link_challenge_start','setup_link_challenge_claim','setup_link_confirm','setup_link_unlink','setup_channel_authorize','setup_provider_inbound_record','setup_provider_outbound_prepare','setup_provider_outbound_record','setup_turn_lookup','setup_bridge_resume','setup_bridge_checkpoint','setup_provider_outbound_claim','setup_provider_outbound_authorize','setup_link_inbound_start');
$function$;

CREATE OR REPLACE FUNCTION fmat.request_authorize (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests;
begin
  case p_operation
  when 'mutation_replay' then
    if p_input->>'operation' not in ('proposal_create','proposal_revise','manual_allowance_save','preference_exception_save','details_update') or p_input->>'operation' is null then raise exception 'INVALID_INPUT'; end if;
    perform fmat.request_authorize(p_input->>'operation',p_actor,p_input);
  when 'request_create' then
    if p_actor->>'kind' is distinct from 'public' then raise exception 'FORBIDDEN'; end if;
  when 'requests_list' then perform fmat.require_host(p_actor,true);
  when 'evaluation_read','candidates_save','extraction_save','request_expire','model_claim','assistant_message_save' then
    if p_actor->>'kind' is distinct from 'worker' or coalesce(p_actor->>'id','')='' then raise exception 'FORBIDDEN'; end if;
  when 'contact_recover','contact_redeem' then
    if p_actor->>'kind' is distinct from 'public' then raise exception 'FORBIDDEN'; end if;
    select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
    if not found or v_request.status in ('booked','declined','withdrawn','expired') or v_request.expires_at<=now() then raise exception 'NOT_FOUND'; end if;
    if p_operation='contact_recover' and lower(trim(coalesce(p_input->>'email',''))) is distinct from v_request.details->>'requesterEmail' then raise exception 'NOT_FOUND'; end if;
  when 'request_read','message_add','details_update','proposal_create','proposal_revise','requester_agree','requester_withdraw','host_decline','private_note_save','private_context_save','manual_allowance_save','preference_exception_save','contact_start','contact_confirm','request_calendar_disconnect' then
    v_request:=fmat.require_request(p_actor,(p_input->>'requestId')::uuid);
    if p_operation in ('proposal_revise','host_decline','private_note_save','private_context_save','manual_allowance_save','preference_exception_save') and p_actor->>'kind'<>'host' then raise exception 'FORBIDDEN'; end if;
    if p_operation in ('requester_agree','requester_withdraw','contact_start','contact_confirm','request_calendar_disconnect') and p_actor->>'kind'<>'guest' then raise exception 'FORBIDDEN'; end if;
    if p_operation<>'request_read' and v_request.status in ('booked','withdrawn','declined','expired') then raise exception 'REQUEST_CLOSED'; end if;
    if p_operation<>'request_read' and v_request.expires_at<=now() and v_request.status<>'booking' then raise exception 'REQUEST_EXPIRED'; end if;
  else raise exception 'UNKNOWN_OPERATION'; end case;
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.request_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests; v_host fmat.hosts; v_details jsonb; v_id uuid; v_start timestamptz; v_end timestamptz; v_proposal jsonb; v_version integer;
  v_challenge fmat.contact_challenges; v_replay fmat.idempotency; v_scope text; v_hash text; v_encrypted text; v_purpose text; v_mode text; v_location text;
begin
  perform fmat.request_authorize(p_operation,p_actor,p_input);
  if p_operation='mutation_replay' then
    if jsonb_typeof(p_input->'clientInput') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input->'clientInput') k where k not in ('requestId','expectedRevision','start','end','mode','location','edge','durationMinutes','confirmed','proposalVersion','reason','idempotencyKey','patch','reviewedRevision')) then raise exception 'INVALID_INPUT'; end if;
    if p_input->'clientInput'->>'requestId' is distinct from p_input->>'requestId' then raise exception 'INVALID_INPUT'; end if;
    v_scope:=p_actor->>'kind'||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash');
    select * into v_replay from fmat.idempotency where actor_scope=v_scope and operation=p_input->>'operation' and key=p_input->>'idempotencyKey';
    if not found or v_replay.result is null then return jsonb_build_object('found',false); end if;
    if p_input->>'operation'='details_update' then
      if v_replay.input->'clientInput' is distinct from p_input->'clientInput' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    elsif ((case when p_input->>'operation'='manual_allowance_save' then v_replay.input->'clientInput' else v_replay.input end) @> (p_input->'clientInput')) is not true then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('found',true,'result',v_replay.result);
  end if;
  if p_operation='request_create' then
    select * into v_host from fmat.hosts where handle=p_input->>'handle' for share;
    if not found or not fmat.host_ready(v_host) then raise exception 'NOT_FOUND'; end if;
    if coalesce(p_input->>'tokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
    v_details:=fmat.normalize_details(p_input->'details');
    insert into fmat.requests(host_id,details,token_hash,status,expires_at) values(v_host.id,v_details,p_input->>'tokenHash',case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end,fmat.request_expiry(v_details,now())) returning * into v_request;
    perform fmat.audit(p_operation,p_actor,v_request.id::text);
    return fmat.request_view(v_request.id,'{"kind":"guest"}');
  elsif p_operation='requests_list' then
    return jsonb_build_object('requests',(select coalesce(jsonb_agg(fmat.request_view(id,p_actor) order by created_at desc),'[]'::jsonb) from fmat.requests where host_id=fmat.require_host(p_actor,true)));
  elsif p_operation='request_expire' then return jsonb_build_object('expired',fmat.expire_requests()); end if;
  select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_operation='request_read' then return fmat.request_view(v_request.id,p_actor); end if;
  if p_operation in ('contact_recover','contact_redeem') then
    if v_request.status in ('booked','withdrawn','declined','expired') or v_request.expires_at<=now() then raise exception 'NOT_FOUND'; end if;
  else
    if v_request.status in ('booked','withdrawn','declined','expired') then raise exception 'REQUEST_CLOSED'; end if;
    if v_request.expires_at<=now() and v_request.status<>'booking' then raise exception 'REQUEST_EXPIRED'; end if;
  end if;
  select * into v_host from fmat.hosts where id=v_request.host_id;
  if p_operation='evaluation_read' then
    if not fmat.host_ready(v_host) then raise exception 'RECONNECT_REQUIRED'; end if;
    return jsonb_build_object('requestId',v_request.id,'hostId',v_request.host_id,'revision',v_request.revision,'details',v_request.details,'rules',v_host.rules,'rulesVersion',v_host.rules_version,'privateSchedulingContext',v_request.private_scheduling_context,
      'requesterConnection',exists(select 1 from fmat.calendar_connections where principal_kind='guest' and principal_id=v_request.id and revoked_at is null));
  end if;
  if p_operation not in ('contact_recover','contact_redeem') then
    if (p_input->>'expectedRevision')::integer is distinct from v_request.revision then raise exception 'REVISION_CONFLICT'; end if;
    if v_request.status='booking' and p_operation<>'requester_withdraw' then raise exception 'BOOKING_PENDING'; end if;
  end if;
  case p_operation
  when 'preference_exception_save' then
    if p_input->>'confirmed' is distinct from 'true' or length(trim(coalesce(p_input->>'reason',''))) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
    if v_request.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_CONFLICT'; end if;
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'STALE_EVALUATION'; end if;
    select details into strict v_proposal from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version;
    update fmat.requests set private_scheduling_context=jsonb_set(private_scheduling_context,'{preferenceException}',jsonb_build_object('proposalVersion',current_proposal_version,'rulesVersion',v_host.rules_version,'proposalDetails',v_proposal,'hostId',p_actor->>'id','confirmedAt',now(),'reason',trim(p_input->>'reason'))) where id=v_request.id;
  when 'model_claim' then
    if v_request.model_calls>=8 then return jsonb_build_object('allowed',false); end if;
    update fmat.requests set model_calls=model_calls+1 where id=v_request.id;
    return jsonb_build_object('allowed',true);
  when 'assistant_message_save' then
    if length(trim(coalesce(p_input->>'text',''))) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.request_messages(request_id,role,audience,text,actor) values(v_request.id,'assistant','shared',trim(p_input->>'text'),p_actor);
  when 'private_context_save','manual_allowance_save' then
    if p_operation='private_context_save' then
      if jsonb_typeof(p_input->'physicalContext') is distinct from 'array' or jsonb_array_length(p_input->'physicalContext')>10
        or length(coalesce(p_input->>'candidatePhysicalLocation',''))>2000 then raise exception 'INVALID_INPUT'; end if;
      for v_details in select value from jsonb_array_elements(p_input->'physicalContext') loop
        if length(coalesce(v_details->>'location','')) not between 1 and 2000 or coalesce(v_details->>'at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'INVALID_INPUT'; end if;
      end loop;
      update fmat.requests set private_scheduling_context=jsonb_build_object('physicalContext',p_input->'physicalContext','candidatePhysicalLocation',p_input->>'candidatePhysicalLocation','manualTravelAllowances','[]'::jsonb) where id=v_request.id;
    else
      v_details:=p_input->'allowance';
      if p_input->>'confirmed' is distinct from 'true' or (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version
        or v_details->>'hostId' is distinct from p_actor->>'id' or coalesce((v_details->>'durationMinutes')::integer,0) not between 1 and 1440
        or (v_details->'context'->>'rulesVersion')::integer is distinct from v_host.rules_version
        or coalesce(v_details->'context'->'slot'->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or coalesce(v_details->'context'->'slot'->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or jsonb_array_length(coalesce(v_request.private_scheduling_context->'manualTravelAllowances','[]'::jsonb))>=20 then raise exception 'INVALID_INPUT'; end if;
      update fmat.requests set private_scheduling_context=jsonb_set(private_scheduling_context,'{manualTravelAllowances}',coalesce(private_scheduling_context->'manualTravelAllowances','[]'::jsonb)||jsonb_build_array(v_details)) where id=v_request.id;
    end if;
    update fmat.requests set candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status='negotiating' where id=v_request.id;
  when 'message_add','private_note_save' then
    if length(trim(coalesce(p_input->>'text',''))) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
    insert into fmat.request_messages(request_id,role,audience,text,actor) values(v_request.id,case when p_actor->>'kind'='guest' then 'requester' else 'host' end,
      case when p_operation='private_note_save' then 'host' else 'shared' end,trim(p_input->>'text'),p_actor-'tokenHash');
    if p_operation='private_note_save' then update fmat.requests set private_notes=trim(p_input->>'text') where id=v_request.id; end if;
  when 'details_update','extraction_save' then
    if p_operation='extraction_save' and (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version then raise exception 'STALE_EVALUATION'; end if;
    v_details:=fmat.normalize_details(p_input->'details');
    update fmat.requests set details=v_details,candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,
      status=case when fmat.details_complete(v_details) then 'negotiating' else 'gathering' end,expires_at=fmat.request_expiry(v_details,created_at),
      contact_verified_email=case when v_details->>'requesterEmail'=details->>'requesterEmail' then contact_verified_email else null end where id=v_request.id;
    update fmat.contact_challenges set consumed_at=now() where request_id=v_request.id and consumed_at is null and email<>v_details->>'requesterEmail';
  when 'candidates_save' then
    if (p_input->>'rulesVersion')::integer is distinct from v_host.rules_version or not fmat.host_ready(v_host) then raise exception 'STALE_EVALUATION'; end if;
    if jsonb_typeof(p_input->'candidates') is distinct from 'array' or jsonb_array_length(p_input->'candidates')>300 or jsonb_typeof(coalesce(p_input->'privateDiagnostics','[]'::jsonb)) is distinct from 'array' or jsonb_typeof(coalesce(p_input->'privateTravelChecks','[]'::jsonb)) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    for v_details in select value from jsonb_array_elements(p_input->'candidates') loop
      if coalesce(v_details->>'start','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(v_details->>'end','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or (v_details->>'start')::timestamptz<=now() or (v_details->>'end')::timestamptz-(v_details->>'start')::timestamptz<>make_interval(mins=>(v_request.details->>'durationMinutes')::integer)
        or not exists(select 1 from jsonb_array_elements(v_request.details->'windows') w where (w->>'start')::timestamptz<=(v_details->>'start')::timestamptz and (w->>'end')::timestamptz>=(v_details->>'end')::timestamptz) then raise exception 'INVALID_INPUT'; end if;
    end loop;
    update fmat.requests set candidates=(select coalesce(jsonb_agg(jsonb_build_object('start',c->>'start','end',c->>'end')),'[]'::jsonb) from jsonb_array_elements(p_input->'candidates') c),private_diagnostics=coalesce(p_input->'privateDiagnostics','[]'::jsonb)||case when p_input->>'unresolved'='true' then jsonb_build_array(jsonb_build_object('code','evaluation_unresolved')) else '[]'::jsonb end,private_travel_checks=coalesce(p_input->'privateTravelChecks','[]'::jsonb),evaluated_rules_version=v_host.rules_version,evaluated_at=now() where id=v_request.id;
    if v_request.current_proposal_version is not null and not exists(select 1 from fmat.proposals p,jsonb_array_elements(p_input->'candidates') c where p.request_id=v_request.id and p.version=v_request.current_proposal_version and (p.details->>'start')::timestamptz=(c->>'start')::timestamptz and (p.details->>'end')::timestamptz=(c->>'end')::timestamptz) then
      update fmat.requests set current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=v_request.id;
    end if;
  when 'proposal_create','proposal_revise' then
    if not fmat.details_complete(v_request.details) then raise exception 'DETAILS_REQUIRED'; end if;
    if p_operation='proposal_create' and (v_request.evaluated_rules_version is distinct from v_host.rules_version or v_request.evaluated_at is null or v_request.evaluated_at<now()-interval '5 minutes') then raise exception 'STALE_EVALUATION'; end if;
    v_start:=(p_input->>'start')::timestamptz; v_end:=(p_input->>'end')::timestamptz;
    if p_operation='proposal_create' and not exists(select 1 from jsonb_array_elements(v_request.candidates) c where (c->>'start')::timestamptz=v_start and (c->>'end')::timestamptz=v_end) then raise exception 'CANDIDATE_INVALID'; end if;
    v_mode:=coalesce(p_input->>'mode',v_request.details->>'mode'); v_location:=coalesce(p_input->>'location',v_request.details->>'location');
    if p_operation='proposal_revise' then
      v_details:=p_input->'validatedEvidence';
      if (v_details->>'rulesVersion')::integer is distinct from v_host.rules_version or (v_details->>'requestRevision')::integer is distinct from v_request.revision
        or (v_details->>'start')::timestamptz is distinct from v_start or (v_details->>'end')::timestamptz is distinct from v_end
        or v_details->>'mode' is distinct from v_mode or v_details->>'location' is distinct from v_location then raise exception 'STALE_EVALUATION'; end if;
      v_details:=fmat.normalize_details(v_request.details||jsonb_build_object('mode',v_mode,'location',v_location));
      if not fmat.details_complete(v_details) then raise exception 'DETAILS_REQUIRED'; end if;
      if v_end-v_start<>make_interval(mins=>(v_details->>'durationMinutes')::integer) or v_start<=now()
        or not exists(select 1 from jsonb_array_elements(v_details->'windows') w where (w->>'start')::timestamptz<=v_start and (w->>'end')::timestamptz>=v_end) then raise exception 'CANDIDATE_INVALID'; end if;
      update fmat.requests set details=v_details,candidates=jsonb_build_array(jsonb_build_object('start',v_start,'end',v_end)),evaluated_rules_version=v_host.rules_version,evaluated_at=now() where id=v_request.id;
    elsif v_mode is distinct from v_request.details->>'mode' or v_location is distinct from v_request.details->>'location' then raise exception 'STALE_EVALUATION'; end if;
    select coalesce(max(version),0)+1 into v_version from fmat.proposals where request_id=v_request.id;
    v_proposal:=jsonb_build_object('version',v_version,'start',v_start,'end',v_end,'timezone',v_request.details->>'timezone','mode',v_mode,'location',v_location,
      'requesterName',v_request.details->>'requesterName','requesterEmail',v_request.details->>'requesterEmail','purpose',v_request.details->>'purpose');
    insert into fmat.proposals(request_id,version,details,rules_version) values(v_request.id,v_version,v_proposal,v_host.rules_version);
    update fmat.requests set current_proposal_version=v_version,requester_agreed_version=null,host_approved_version=null,status='negotiating' where id=v_request.id;
  when 'requester_agree' then
    if v_request.current_proposal_version is null or (p_input->>'proposalVersion')::integer is distinct from v_request.current_proposal_version then raise exception 'PROPOSAL_CONFLICT'; end if;
    if not exists(select 1 from fmat.proposals where request_id=v_request.id and version=v_request.current_proposal_version and rules_version=v_host.rules_version) then raise exception 'STALE_EVALUATION'; end if;
    update fmat.requests set requester_agreed_version=current_proposal_version,status='awaiting_approval' where id=v_request.id;
  when 'requester_withdraw' then
    if v_request.status='booking' and not fmat.withdraw_allowed(v_request.id) then raise exception 'BOOKING_PENDING'; end if;
    update fmat.requests set status='withdrawn',token_revoked_at=now(),requester_agreed_version=null,host_approved_version=null where id=v_request.id;
  when 'host_decline' then update fmat.requests set status='declined',token_revoked_at=now(),host_approved_version=null where id=v_request.id;
  when 'request_calendar_disconnect' then
    update fmat.calendar_connections set encrypted_credential=null,revoked_at=now(),updated_at=now() where principal_kind='guest' and principal_id=v_request.id;
    update fmat.requests set candidates='[]',private_diagnostics='[]',private_travel_checks='[]',current_proposal_version=null,requester_agreed_version=null,host_approved_version=null,evaluated_at=null,evaluated_rules_version=null,status='negotiating' where id=v_request.id;
    update fmat.oauth_exchanges set expires_at=least(expires_at,now()),encrypted_verifier=null where actor->>'kind'='guest' and actor->>'requestId'=v_request.id::text and saved_at is null;
  when 'contact_start','contact_recover' then
    if p_operation='contact_recover' and lower(trim(coalesce(p_input->>'email',''))) is distinct from v_request.details->>'requesterEmail' then raise exception 'NOT_FOUND'; end if;
    if coalesce(v_request.details->>'requesterEmail','')='' then raise exception 'DETAILS_REQUIRED'; end if;
    v_purpose:=case when p_operation='contact_start' then 'verification' else 'recovery' end;
    v_hash:=case when p_operation='contact_start' then p_input->>'codeHash' else p_input->>'tokenHash' end;
    v_encrypted:=case when p_operation='contact_start' then p_input->>'encryptedCode' else p_input->>'encryptedToken' end;
    if coalesce(v_hash,'') !~ '^[0-9a-f]{64}$' or length(coalesce(v_encrypted,''))<20 then raise exception 'INVALID_INPUT'; end if;
    if exists(select 1 from fmat.contact_challenges where request_id=v_request.id and purpose=v_purpose and created_at>now()-interval '1 minute') then raise exception 'RATE_LIMITED'; end if;
    update fmat.contact_challenges set consumed_at=now() where request_id=v_request.id and purpose=v_purpose and consumed_at is null;
    insert into fmat.contact_challenges(request_id,email,purpose,secret_hash) values(v_request.id,v_request.details->>'requesterEmail',v_purpose,v_hash) returning id into v_id;
    insert into fmat.outbox(dedupe_key,audience,recipient,payload) values('contact:'||v_id::text,'requester',jsonb_build_object('email',v_request.details->>'requesterEmail'),
      jsonb_build_object('kind','contact_'||v_purpose,'requestId',v_request.id,'challengeId',v_id,'encryptedSecret',v_encrypted)) returning id into v_id;
    perform fmat.enqueue_job('contact_delivery','contact-delivery:'||v_id::text,jsonb_build_object('outboxId',v_id));
    if p_operation='contact_recover' then return jsonb_build_object('status','pending'); end if;
  when 'contact_confirm','contact_redeem' then
    v_purpose:=case when p_operation='contact_confirm' then 'verification' else 'recovery' end;
    v_hash:=case when p_operation='contact_confirm' then p_input->>'codeHash' else p_input->>'tokenHash' end;
    select * into v_challenge from fmat.contact_challenges where request_id=v_request.id and purpose=v_purpose and secret_hash=v_hash and consumed_at is null order by created_at desc limit 1 for update;
    if not found or v_challenge.expires_at<=now() or v_challenge.email is distinct from v_request.details->>'requesterEmail' then raise exception 'CONTACT_INVALID'; end if;
    update fmat.contact_challenges set consumed_at=now() where id=v_challenge.id;
    update fmat.requests set contact_verified_email=v_challenge.email where id=v_request.id;
    if p_operation='contact_redeem' then
      if coalesce(p_input->>'newTokenHash','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
      update fmat.requests set token_hash=p_input->>'newTokenHash',token_expires_at=now()+interval '30 days',token_revoked_at=null where id=v_request.id;
    end if;
  else raise exception 'UNKNOWN_OPERATION'; end case;
  update fmat.requests set revision=revision+1,updated_at=now() where id=v_request.id returning * into v_request;
  insert into fmat.request_history(request_id,revision,operation,actor,proposal_version) values(v_request.id,v_request.revision,p_operation,p_actor-'tokenHash',v_request.current_proposal_version);
  perform fmat.audit(p_operation,p_actor,v_request.id::text,jsonb_build_object('revision',v_request.revision,'proposalVersion',v_request.current_proposal_version));
  return fmat.request_view(v_request.id,case when p_actor->>'kind'='host' then p_actor else '{"kind":"guest"}'::jsonb end);
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.setup_channel_authority (
  p_input jsonb
)
  RETURNS fmat.setup_channel_links
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_link fmat.setup_channel_links;
begin
  if p_input->>'provider' is distinct from 'imessage' or (p_input->>'isGroup')::boolean is distinct from false
    or length(coalesce(p_input->>'senderId','')) not between 1 and 300
    or length(coalesce(p_input->>'privateConversationId','')) not between 1 and 300 then raise exception 'FORBIDDEN'; end if;
  select l.* into v_link from fmat.setup_channel_links l join fmat.hosts h on h.id=l.host_id
    where l.provider=p_input->>'provider' and l.sender_id=p_input->>'senderId' and l.private_conversation_id=p_input->>'privateConversationId'
      and l.revoked_at is null and h.revoked_at is null for update of l,h;
  if not found then raise exception 'LINK_NOT_FOUND'; end if;
  return v_link;
end;
$function$;

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
    perform 1 from fmat.setup_provider_outbound o left join fmat.setup_channel_links l on l.id=o.link_id left join fmat.hosts h on h.id=l.host_id left join fmat.setup_link_continuations c on c.id=o.continuation_id
      where (o.client_message_id=nullif(p_input->>'clientMessageId','')::uuid or o.id=nullif(p_input->>'intentId','')::uuid)
        and ((l.id is not null and (l.revoked_at is not null or h.revoked_at is not null)) or (c.id is not null and (c.consumed_at is not null or c.expires_at<=now())));
    if not found then raise exception 'OUTBOUND_CONFLICT'; end if;
  elsif p_operation in ('setup_provider_outbound_record','setup_provider_outbound_authorize') then
    perform 1 from fmat.setup_provider_outbound o join fmat.setup_channel_links l on l.id=o.link_id join fmat.hosts h on h.id=l.host_id
      where (o.client_message_id=nullif(p_input->>'clientMessageId','')::uuid or o.id=nullif(p_input->>'intentId','')::uuid) and l.revoked_at is null and h.revoked_at is null for share of l,h;
    if not found then
      perform 1 from fmat.setup_provider_outbound o join fmat.setup_link_continuations c on c.id=o.continuation_id
        where (o.client_message_id=nullif(p_input->>'clientMessageId','')::uuid or o.id=nullif(p_input->>'intentId','')::uuid) and c.consumed_at is null and c.expires_at>now() for share of c;
      if not found then raise exception 'LINK_NOT_FOUND'; end if;
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
    select o.* into v_outbound from fmat.setup_provider_outbound o left join fmat.setup_channel_links l on l.id=o.link_id left join fmat.hosts h on h.id=l.host_id left join fmat.setup_link_continuations c on c.id=o.continuation_id
      where ((l.id is not null and l.revoked_at is null and h.revoked_at is null) or (c.id is not null and c.consumed_at is null and c.expires_at>now()))
        and (case when p_operation='setup_provider_outbound_claim' then o.status='prepared' or (o.status='uncertain' and o.updated_at<=now()-interval '30 seconds') else o.id=(p_input->>'intentId')::uuid and o.status='uncertain' end)
      order by (o.status='prepared') desc,o.updated_at,o.id limit 1 for update of o skip locked;
    if not found then return jsonb_build_object('action','none','authorized',false); end if;
    if v_outbound.link_id is not null then
      select l.* into v_link from fmat.setup_channel_links l join fmat.hosts h on h.id=l.host_id where l.id=v_outbound.link_id and l.revoked_at is null and h.revoked_at is null for share of l,h;
      if not found then raise exception 'LINK_NOT_FOUND'; end if;
    else
      select * into v_continuation from fmat.setup_link_continuations where id=v_outbound.continuation_id and consumed_at is null and expires_at>now() for share;
      if not found then raise exception 'CHALLENGE_INVALID'; end if;
    end if;
    v_dispatch:=p_operation='setup_provider_outbound_claim' and v_outbound.status='prepared';
    if p_operation='setup_provider_outbound_claim' then update fmat.setup_provider_outbound set status='uncertain',updated_at=now() where id=v_outbound.id; end if;
    return jsonb_build_object('action',case when v_dispatch then 'dispatch' else 'reconcile' end,'intentId',v_outbound.id,'authorized',true,'providerMessageId',v_outbound.provider_reference,
      'conversationId',coalesce(v_link.private_conversation_id,v_continuation.private_conversation_id),'clientMessageId',v_outbound.client_message_id,'body',v_outbound.text,'createdAt',v_outbound.prepared_at);
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
    if not found or v_challenge.secret_hash is distinct from p_input->>'challengeSecretHash' or v_challenge.expires_at<=now() or v_challenge.consumed_at is not null then raise exception 'CHALLENGE_INVALID'; end if;
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
    perform 1 from fmat.hosts where id=v_host_id and revoked_at is null for update;
    if not found then raise exception 'HOST_NOT_ADMITTED'; end if;
    if exists(select 1 from fmat.setup_channel_challenges where host_id=v_host_id and created_at>now()-interval '1 minute') then raise exception 'RATE_LIMITED'; end if;
    if p_input ? 'continuationId' then
      select * into v_continuation from fmat.setup_link_continuations where id=(p_input->>'continuationId')::uuid for update;
      if not found or v_continuation.secret_hash is distinct from p_input->>'continuationSecretHash' or v_continuation.consumed_at is not null or v_continuation.expires_at<=now() then raise exception 'CHALLENGE_INVALID'; end if;
      update fmat.setup_link_continuations set consumed_at=now() where id=v_continuation.id;
    end if;
    v_conversation:=fmat.ensure_setup_conversation(v_host_id);
    update fmat.setup_channel_challenges set consumed_at=now() where host_id=v_host_id and consumed_at is null;
    insert into fmat.setup_channel_challenges(host_id,secret_hash,browser_proof_hash,provider,expected_sender_id,expected_conversation_id) values(v_host_id,p_input->>'challengeSecretHash',p_input->>'browserProofHash','imessage',v_continuation.sender_id,v_continuation.private_conversation_id) returning * into v_challenge;
    return jsonb_build_object('challengeId',v_challenge.id,'provider',v_challenge.provider,'expiresAt',v_challenge.expires_at);
  elsif p_operation='setup_link_confirm' then
    select * into v_challenge from fmat.setup_channel_challenges where id=(p_input->>'challengeId')::uuid and host_id=v_host_id for update;
    if not found or v_challenge.browser_proof_hash is distinct from p_input->>'browserProofHash' or v_challenge.claimed_at is null or v_challenge.expires_at<=now() or v_challenge.consumed_at is not null then raise exception 'CHALLENGE_INVALID'; end if;
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
declare v_conversation fmat.setup_conversations; v_draft fmat.setup_drafts; v_review fmat.setup_reviews; v_link fmat.setup_channel_links; v_challenge fmat.setup_channel_challenges;
begin
  select * into v_conversation from fmat.setup_conversations where host_id=p_host_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_draft from fmat.setup_drafts where conversation_id=v_conversation.id order by revision desc limit 1;
  select * into v_review from fmat.setup_reviews where conversation_id=v_conversation.id order by revision desc limit 1;
  select * into v_link from fmat.setup_channel_links where host_id=p_host_id and revoked_at is null order by linked_at desc limit 1;
  select * into v_challenge from fmat.setup_channel_challenges where host_id=p_host_id and consumed_at is null and expires_at>now() order by created_at desc limit 1;
  return jsonb_build_object(
    'id',v_conversation.id,'revision',v_conversation.revision,
    'turns',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'sequence',t.sequence,'role',t.role,'channel',t.channel,'text',t.text,'createdAt',t.created_at) order by t.sequence),'[]'::jsonb) from fmat.setup_turns t where t.conversation_id=v_conversation.id),
    'draft',case when v_draft.conversation_id is null then null else jsonb_build_object('revision',v_draft.revision,'baseRulesVersion',v_draft.base_rules_version,'settings',v_draft.settings,'unresolved',to_jsonb(v_draft.unresolved),'status',v_draft.status,'createdAt',v_draft.created_at) end,
    'review',case when v_review.conversation_id is null then null else jsonb_build_object('revision',v_review.revision,'draftRevision',v_review.draft_revision,'settings',v_review.settings,'status',v_review.status,'createdAt',v_review.created_at) end,
    'setup',fmat.setup_view(p_host_id),
    'linkChallenge',case when v_challenge.id is null then null else jsonb_build_object('id',v_challenge.id,'expiresAt',v_challenge.expires_at,'claimed',v_challenge.claimed_at is not null,'maskedSender',case when v_challenge.claimed_sender_id is null then null else left(v_challenge.claimed_sender_id,2)||'…'||right(v_challenge.claimed_sender_id,2) end) end,
    'channelLink',case when v_link.id is null then null else jsonb_build_object('id',v_link.id,'provider',v_link.provider,'linkedAt',v_link.linked_at) end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_command (
  p_operation text,
  p_actor     jsonb,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_scope text; v_key text; v_record fmat.idempotency; v_result jsonb; v_identity_input jsonb;
begin
  if jsonb_typeof(p_actor) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object' or p_actor->>'kind' is null or p_actor->>'kind' not in ('host','guest','worker','operator','public') then raise exception 'INVALID_INPUT'; end if;
  perform fmat.authorize_command(p_operation,p_actor,p_input);
  if p_operation like 'jobs_%' or p_operation in ('oauth_consume','credential_save','token_update','oauth_cleanup','host_public','setup_read','calendar_read','requests_list','request_read','connection_read','evaluation_read','candidates_save','extraction_save','assistant_message_save','model_claim','request_expire','mutation_replay','delivery_load','delivery_dispatch','delivery_record','booking_load','booking_dispatch','booking_record_outcome','setup_conversation_read','setup_channel_authorize','setup_turn_lookup','setup_bridge_resume','setup_bridge_checkpoint','setup_provider_outbound_claim','setup_provider_outbound_authorize') then return fmat.dispatch_command(p_operation,p_actor,p_input); end if;
  v_key:=p_input->>'idempotencyKey';
  if v_key is null or length(v_key) not between 1 and 200 then raise exception 'IDEMPOTENCY_REQUIRED'; end if;
  v_scope:=coalesce(p_actor->>'kind','')||':'||coalesce(p_actor->>'id',p_actor->>'tokenHash',p_actor->>'email','public');
  v_identity_input:=case
    when p_operation='oauth_start' then jsonb_build_object('context',p_input->'context','idempotencyKey',v_key)
    when p_operation='contact_start' then p_input-'encryptedCode'
    when p_operation='contact_recover' then p_input-'encryptedToken'
    when p_operation='manual_allowance_save' then jsonb_set(p_input,'{allowance}',(p_input->'allowance')-'confirmedAt')
    when p_operation='setup_turn_append' then jsonb_build_object('text',p_input->'text','channel',p_input->'channel','expectedRevision',p_input->'expectedRevision','clientTurnId',p_input->'clientTurnId','providerMessageId',p_input->'providerMessageId','provider',p_input->'provider','senderId',p_input->'senderId','privateConversationId',p_input->'privateConversationId','isGroup',p_input->'isGroup','idempotencyKey',v_key)
    else p_input end;
  insert into fmat.idempotency(actor_scope,operation,key,input) values(v_scope,p_operation,v_key,v_identity_input) on conflict do nothing;
  select * into strict v_record from fmat.idempotency where actor_scope=v_scope and operation=p_operation and key=v_key for update;
  if v_record.input<>v_identity_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_record.result is not null then
    if p_operation='oauth_start' and not exists(select 1 from fmat.oauth_exchanges where id=(v_record.result->>'exchangeId')::uuid and consumed_at is null and expires_at>now()) then raise exception 'OAUTH_STATE_INVALID'; end if;
    if p_operation='request_create' and not exists(select 1 from fmat.requests r join fmat.hosts h on h.id=r.host_id where r.id=(v_record.result->>'id')::uuid and r.token_hash=p_input->>'tokenHash' and r.token_revoked_at is null and r.expires_at>now() and fmat.host_ready(h)) then raise exception 'REQUEST_CLOSED'; end if;
    if p_operation='contact_redeem' and not exists(select 1 from fmat.requests where id=(p_input->>'requestId')::uuid and token_hash=p_input->>'newTokenHash' and token_revoked_at is null and expires_at>now()) then raise exception 'CONTACT_INVALID'; end if;
    return v_record.result;
  end if;
  v_result:=fmat.dispatch_command(p_operation,p_actor,p_input);
  update fmat.idempotency set result=v_result where actor_scope=v_scope and operation=p_operation and key=v_key;
  return v_result;
end;
$function$;

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."setup_channel_challenges"
  ADD CONSTRAINT "setup_channel_challenges_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."setup_channel_links"
  ADD CONSTRAINT "setup_channel_links_challenge_id_fkey" FOREIGN KEY (challenge_id) REFERENCES fmat.setup_channel_challenges(id);

ALTER TABLE "fmat"."setup_channel_links"
  ADD CONSTRAINT "setup_channel_links_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."setup_conversations"
  ADD CONSTRAINT "setup_conversations_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."setup_channel_links"
  ADD CONSTRAINT "setup_channel_links_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES fmat.setup_conversations(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."setup_drafts"
  ADD CONSTRAINT "setup_drafts_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES fmat.setup_conversations(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."setup_provider_inbound"
  ADD CONSTRAINT "setup_provider_inbound_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.setup_channel_links(id);

ALTER TABLE "fmat"."setup_provider_outbound"
  ADD CONSTRAINT "setup_provider_outbound_continuation_id_fkey" FOREIGN KEY (continuation_id) REFERENCES fmat.setup_link_continuations(id);

ALTER TABLE "fmat"."setup_provider_outbound"
  ADD CONSTRAINT "setup_provider_outbound_inbound_id_fkey" FOREIGN KEY (inbound_id) REFERENCES fmat.setup_provider_inbound(id);

ALTER TABLE "fmat"."setup_provider_outbound"
  ADD CONSTRAINT "setup_provider_outbound_link_id_fkey" FOREIGN KEY (link_id) REFERENCES fmat.setup_channel_links(id);

ALTER TABLE "fmat"."setup_reviews"
  ADD CONSTRAINT "setup_reviews_conversation_id_draft_revision_fkey" FOREIGN KEY (conversation_id, draft_revision) REFERENCES fmat.setup_drafts(conversation_id, revision);

ALTER TABLE "fmat"."setup_reviews"
  ADD CONSTRAINT "setup_reviews_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES fmat.setup_conversations(id) ON DELETE CASCADE;

ALTER TABLE "fmat"."setup_turns"
  ADD CONSTRAINT "setup_turns_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES fmat.setup_conversations(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX setup_channel_challenges_active_host_idx ON fmat.setup_channel_challenges USING btree (host_id)
  WHERE (consumed_at IS NULL);

CREATE INDEX setup_channel_challenges_host_idx ON fmat.setup_channel_challenges USING btree (host_id, created_at DESC);

CREATE UNIQUE INDEX setup_channel_links_active_conversation_idx ON fmat.setup_channel_links USING btree (PROVIDER, private_conversation_id)
  WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX setup_channel_links_active_host_idx ON fmat.setup_channel_links USING btree (host_id, PROVIDER)
  WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX setup_channel_links_active_sender_idx ON fmat.setup_channel_links USING btree (PROVIDER, sender_id)
  WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX setup_drafts_one_active_idx ON fmat.setup_drafts USING btree (conversation_id)
  WHERE (status = 'active'::text);

CREATE UNIQUE INDEX setup_reviews_one_pending_idx ON fmat.setup_reviews USING btree (conversation_id)
  WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX setup_turns_provider_message_idx ON fmat.setup_turns USING btree (provider_message_id)
  WHERE (provider_message_id IS NOT NULL);

REVOKE ALL ON FUNCTION "fmat"."ensure_setup_conversation"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."is_setup_conversation_operation"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."setup_channel_authority"(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."setup_conversation_authorize"(text, jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."setup_conversation_command"(text, jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."setup_conversation_view"(uuid) FROM PUBLIC;
