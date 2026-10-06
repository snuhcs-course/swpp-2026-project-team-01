SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

ALTER TABLE "fmat"."runtime_messages"
  ADD COLUMN "dispatch_token" uuid;

ALTER TABLE "fmat"."runtime_messages"
  ADD COLUMN "dispatch_until" timestamp WITH time zone;

ALTER TABLE "fmat"."runtime_messages"
  ADD COLUMN "next_dispatch_at" timestamp WITH time zone NOT NULL DEFAULT (now() + '00:00:30'::interval);

ALTER TABLE "fmat"."runtime_messages"
  ADD COLUMN "dispatch_attempts" integer NOT NULL DEFAULT 0;

ALTER TABLE "fmat"."runtime_messages"
  ADD COLUMN "dispatch_error" text;

CREATE OR REPLACE FUNCTION fmat.wake_runtime_dispatch()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_url text; v_secret text;
begin
  if not exists(select 1 from fmat.runtime_messages where status='pending' and next_dispatch_at<=clock_timestamp()
    and (dispatch_until is null or dispatch_until<=clock_timestamp())) then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name='fmat_runtime_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='fmat_runtime_dispatch_secret';
  if v_url is null or v_secret is null then return null; end if;
  if v_url !~ '^https://[^/]+/api/internal/conversations/dispatch$' or v_secret !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DISPATCH_CONFIGURATION'; end if;
  return net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),body:='{}'::jsonb,timeout_milliseconds:=10000);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_runtime_dispatch (
  p_operation text,
  p_input     jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_message fmat.runtime_messages; v_result jsonb:='[]';
begin
  if p_operation='claim' then
    for v_message in select * from fmat.runtime_messages
      where status='pending' and next_dispatch_at<=clock_timestamp()
        and (dispatch_until is null or dispatch_until<=clock_timestamp())
      order by next_dispatch_at,id limit 5 for update skip locked
    loop
      update fmat.runtime_messages set dispatch_token=gen_random_uuid(),
        dispatch_until=clock_timestamp()+interval '90 seconds',dispatch_attempts=dispatch_attempts+1
        where id=v_message.id returning * into v_message;
      v_result:=v_result||jsonb_build_array(jsonb_build_object('messageId',v_message.id,
        'conversationId',v_message.conversation_id,'grantId',v_message.grant_id,'text',v_message.text,
        'leaseToken',v_message.dispatch_token,'sessionId',
        (select runtime_session_id from fmat.conversation_scopes where id=v_message.conversation_id)));
    end loop;
    return v_result;
  elsif p_operation='finish' then
    if p_input->>'outcome' is null or p_input->>'outcome' not in ('sent','retry','revoked') then raise exception 'INVALID_INPUT'; end if;
    select * into v_message from fmat.runtime_messages where id=(p_input->>'messageId')::uuid for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if v_message.dispatch_token is distinct from (p_input->>'leaseToken')::uuid
      or v_message.dispatch_token is null or v_message.dispatch_until<=clock_timestamp() then raise exception 'LEASE_LOST'; end if;
    update fmat.runtime_messages set dispatch_token=null,dispatch_until=null,
      next_dispatch_at=clock_timestamp()+interval '5 minutes',
      dispatch_error=case p_input->>'outcome' when 'sent' then null when 'revoked' then 'ACCESS_REVOKED' else 'DISPATCH_RETRY' end,
      status=case when status='pending' and p_input->>'outcome'='revoked' then 'failed' else status end,
      settled_at=case when status='pending' and p_input->>'outcome'='revoked' then clock_timestamp() else settled_at end
      where id=v_message.id;
    return jsonb_build_object('recorded',true);
  else raise exception 'INVALID_INPUT'; end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_runtime_dispatch"(text, jsonb) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

CREATE INDEX runtime_messages_due_idx ON fmat.runtime_messages USING btree (next_dispatch_at)
  WHERE (status = 'pending'::text);

REVOKE ALL ON FUNCTION "fmat"."wake_runtime_dispatch"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_runtime_dispatch"(text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_runtime_dispatch"(text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_runtime_dispatch"(text, jsonb) TO "service_role";
