SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE TABLE "fmat"."photon_inbox" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "project_id"     uuid                     NOT NULL,
  "message_id"     text                     NOT NULL,
  "sender_id"      text                     NOT NULL,
  "space_id"       text                     NOT NULL,
  "line"           text                     NOT NULL,
  "text"           text                     NOT NULL,
  "occurred_at"    timestamp with time zone NOT NULL,
  "received_order" bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "received_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at"   timestamp with time zone,
  CONSTRAINT "photon_inbox_line_check" CHECK (((length(line) >= 1) AND (length(line) <= 512))),
  CONSTRAINT "photon_inbox_message_id_check" CHECK (((length(message_id) >= 1) AND (length(message_id) <= 512))),
  CONSTRAINT "photon_inbox_pkey" PRIMARY KEY (id),
  CONSTRAINT "photon_inbox_project_id_message_id_key" UNIQUE (project_id, message_id),
  CONSTRAINT "photon_inbox_received_order_key" UNIQUE (received_order),
  CONSTRAINT "photon_inbox_sender_id_check" CHECK (((length(sender_id) >= 1) AND (length(sender_id) <= 512))),
  CONSTRAINT "photon_inbox_space_id_check" CHECK (((length(space_id) >= 1) AND (length(space_id) <= 512))),
  CONSTRAINT "photon_inbox_text_check" CHECK (((length(text) >= 1) AND (length(text) <= 4000)))
);

ALTER TABLE "fmat"."photon_inbox"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."photon_receivers" (
  "project_id"  uuid                     NOT NULL,
  "receiver_id" uuid                     NOT NULL,
  "enabled"     boolean                  NOT NULL DEFAULT false,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "photon_receivers_pkey" PRIMARY KEY (project_id),
  CONSTRAINT "photon_receivers_receiver_id_key" UNIQUE (receiver_id)
);

ALTER TABLE "fmat"."photon_receivers"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fmat_photon_ingress (
  p_project_id  uuid,
  p_receiver_id uuid,
  p_input       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_receiver fmat.photon_receivers; v_inbox fmat.photon_inbox; v_new_id uuid; v_occurred timestamptz; v_job uuid;
begin
  select * into v_receiver from fmat.photon_receivers where project_id=p_project_id for share;
  if not found or not v_receiver.enabled or v_receiver.receiver_id is distinct from p_receiver_id then
    raise exception 'CONFIGURATION_UNAVAILABLE';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' or
    p_input-array['messageId','senderId','spaceId','line','text','occurredAt']<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array['messageId','senderId','spaceId','line','text','occurredAt']) k
    where jsonb_typeof(p_input->k) is distinct from 'string') then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array['messageId','senderId','spaceId','line']) k
    where length(p_input->>k) not between 1 and 512 or (p_input->>k)~'[[:cntrl:]]') or
    length(p_input->>'text') not between 1 and 4000 or btrim(p_input->>'text')='' then raise exception 'INVALID_INPUT'; end if;
  begin v_occurred:=(p_input->>'occurredAt')::timestamptz;
  exception when others then raise exception 'INVALID_INPUT'; end;
  if not isfinite(v_occurred) then raise exception 'INVALID_INPUT'; end if;

  -- Preserve receipt order within the provider conversation across concurrent
  -- deliveries. Provider timestamps are evidence, not a manufactured sequence.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('photon-ingress',p_project_id,p_input->>'line',p_input->>'spaceId')::text,0));
  insert into fmat.photon_inbox(project_id,message_id,sender_id,space_id,line,text,occurred_at)
    values(p_project_id,p_input->>'messageId',p_input->>'senderId',p_input->>'spaceId',p_input->>'line',p_input->>'text',v_occurred)
    on conflict(project_id,message_id) do nothing returning id into v_new_id;
  select * into strict v_inbox from fmat.photon_inbox where project_id=p_project_id and message_id=p_input->>'messageId';
  if v_inbox.sender_id<>p_input->>'senderId' or v_inbox.space_id<>p_input->>'spaceId' or v_inbox.line<>p_input->>'line'
    or v_inbox.text<>p_input->>'text' or v_inbox.occurred_at<>v_occurred then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if v_new_id is not null then
    v_job:=fmat.enqueue_job('photon_ingress','photon-ingress:'||v_inbox.id::text,jsonb_build_object('inboxId',v_inbox.id));
  end if;
  return jsonb_build_object('inboxId',v_inbox.id,'duplicate',v_new_id is null);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_photon_ingress"(uuid, uuid, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."photon_inbox"
  ADD CONSTRAINT "photon_inbox_project_id_fkey" FOREIGN KEY (project_id) REFERENCES fmat.photon_receivers(project_id);

CREATE INDEX photon_inbox_pending_idx ON fmat.photon_inbox USING btree (project_id, line, space_id, received_order)
  WHERE (processed_at IS NULL);

REVOKE ALL ON FUNCTION "public"."fmat_photon_ingress"(uuid, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_ingress"(uuid, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_photon_ingress"(uuid, uuid, jsonb) TO "service_role";
