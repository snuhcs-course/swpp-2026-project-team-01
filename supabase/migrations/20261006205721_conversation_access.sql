SET local check_function_bodies = off;

ALTER TABLE "fmat"."booking_identities"
  DROP CONSTRAINT "booking_identities_event_id_check";

CREATE TABLE "fmat"."conversation_grants" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid                     NOT NULL,
  "actor_kind"      text                     NOT NULL,
  "authority_key"   text                     NOT NULL,
  "credential"      jsonb                    NOT NULL,
  "expires_at"      timestamp with time zone NOT NULL,
  "revoked_at"      timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_grants_actor_kind_check" CHECK ((actor_kind = ANY (ARRAY['host'::text, 'guest'::text]))),
  CONSTRAINT "conversation_grants_conversation_id_actor_kind_authority_ke_key" UNIQUE (conversation_id, actor_kind, authority_key),
  CONSTRAINT "conversation_grants_pkey" PRIMARY KEY (id)
);

ALTER TABLE "fmat"."conversation_grants"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "fmat"."conversation_scopes" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "host_id"    uuid                     NOT NULL,
  "request_id" uuid,
  "audience"   text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone,
  CONSTRAINT "conversation_scopes_audience_check" CHECK ((audience = ANY (ARRAY['host_setup'::text, 'host_private'::text, 'request_shared'::text]))),
  CONSTRAINT "conversation_scopes_check" CHECK (((audience = 'host_setup'::text) = (request_id IS NULL))),
  CONSTRAINT "conversation_scopes_host_id_request_id_audience_key" UNIQUE NULLS NOT DISTINCT (host_id, request_id, audience),
  CONSTRAINT "conversation_scopes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "fmat"."conversation_scopes"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fmat.authorize_conversation (
  p_scope fmat.conversation_scopes,
  p_actor jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_request fmat.requests;
begin
  if p_scope.id is null or p_scope.revoked_at is not null then raise exception 'NOT_FOUND'; end if;
  if p_actor->>'kind'='host' then
    if fmat.require_host(p_actor,true)<>p_scope.host_id then raise exception 'NOT_FOUND'; end if;
  elsif p_actor->>'kind'='guest' then
    if p_scope.audience<>'request_shared' or p_scope.request_id::text is distinct from p_actor->>'requestId' then raise exception 'NOT_FOUND'; end if;
    perform fmat.authorize_guest(p_actor,p_scope.request_id);
    if not exists(select 1 from fmat.hosts where id=p_scope.host_id and revoked_at is null) then raise exception 'NOT_FOUND'; end if;
  else raise exception 'FORBIDDEN'; end if;
  if p_scope.request_id is null then return true; end if;
  select * into v_request from fmat.requests where id=p_scope.request_id;
  if v_request.host_id is distinct from p_scope.host_id then raise exception 'NOT_FOUND'; end if;
  return v_request.status not in ('booked','declined','withdrawn','expired')
    and (v_request.expires_at>now() or v_request.status='booking');
end;
$function$;

CREATE OR REPLACE FUNCTION fmat.conversation_projection (
  p_scope    fmat.conversation_scopes,
  p_grant    fmat.conversation_grants,
  p_writable boolean
)
  RETURNS jsonb
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('conversationId',p_scope.id,'audience',p_scope.audience,
    'hostId',p_scope.host_id,'requestId',p_scope.request_id,'grantId',p_grant.id,
    'actorKind',p_grant.actor_kind,'expiresAt',p_grant.expires_at,'readOnly',not p_writable);
$function$;

CREATE OR REPLACE FUNCTION fmat.credential_actor (
  p_credential jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_user auth.users; v_request fmat.requests; v_actor jsonb;
begin
  if jsonb_typeof(p_credential) is distinct from 'object' then raise exception 'UNAUTHORIZED'; end if;
  if p_credential->>'kind'='host' then
    if coalesce((p_credential->>'expiresAt')::timestamptz,now())<=now() then raise exception 'UNAUTHORIZED'; end if;
    select u.* into v_user from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=(p_credential->>'subject')::uuid and s.id=(p_credential->>'sessionId')::uuid
        and (s.not_after is null or s.not_after>now()) and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now()) and u.email_confirmed_at is not null;
    if not found or coalesce(v_user.email,'')='' then raise exception 'UNAUTHORIZED'; end if;
    return jsonb_build_object('kind','host','id',v_user.id,'email',lower(v_user.email));
  elsif p_credential->>'kind'='guest' then
    v_actor:=jsonb_build_object('kind','guest','requestId',p_credential->>'requestId','tokenHash',p_credential->>'tokenHash');
    perform fmat.authorize_guest(v_actor,(p_credential->>'requestId')::uuid);
    select * into v_request from fmat.requests where id=(p_credential->>'requestId')::uuid;
    if not exists(select 1 from fmat.hosts where id=v_request.host_id and revoked_at is null) then raise exception 'NOT_FOUND'; end if;
    return v_actor;
  end if;
  raise exception 'UNAUTHORIZED';
end;
$function$;

CREATE OR REPLACE FUNCTION public.fmat_conversation_access (
  p_operation  text,
  p_credential jsonb,
  p_input      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_scope fmat.conversation_scopes; v_grant fmat.conversation_grants;
  v_host_id uuid; v_request_id uuid; v_audience text; v_expiry timestamptz; v_authority text; v_writable boolean;
begin
  v_actor:=fmat.credential_actor(p_credential);
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  if p_operation='identity' then return v_actor-'tokenHash'; end if;
  if p_operation='open' then
    v_audience:=p_input->>'audience'; v_request_id:=(p_input->>'requestId')::uuid;
    if v_audience is null or v_audience not in ('host_setup','host_private','request_shared')
      or (v_audience='host_setup')<>(v_request_id is null) then raise exception 'INVALID_INPUT'; end if;
    if v_actor->>'kind'='host' then v_host_id:=fmat.require_host(v_actor,true);
    else
      if v_audience<>'request_shared' or v_request_id::text is distinct from v_actor->>'requestId' then raise exception 'NOT_FOUND'; end if;
      select host_id into v_host_id from fmat.requests where id=v_request_id;
    end if;
    if v_request_id is not null and not exists(select 1 from fmat.requests where id=v_request_id and host_id=v_host_id) then raise exception 'NOT_FOUND'; end if;
    insert into fmat.conversation_scopes(host_id,request_id,audience) values(v_host_id,v_request_id,v_audience)
      on conflict(host_id,request_id,audience) do nothing;
    select * into v_scope from fmat.conversation_scopes where host_id=v_host_id
      and request_id is not distinct from v_request_id and audience=v_audience;
  elsif p_operation in ('authorize','revoke') then
    select * into v_scope from fmat.conversation_scopes where id=(p_input->>'conversationId')::uuid;
  else raise exception 'INVALID_INPUT'; end if;
  v_writable:=fmat.authorize_conversation(v_scope,v_actor);
  if v_actor->>'kind'='host' then
    v_authority:=p_credential->>'sessionId'; v_expiry:=(p_credential->>'expiresAt')::timestamptz;
  else
    v_authority:=p_credential->>'tokenHash';
    select token_expires_at into v_expiry from fmat.requests where id=v_scope.request_id;
  end if;
  if p_operation='revoke' then
    update fmat.conversation_grants set revoked_at=coalesce(revoked_at,now())
      where conversation_id=v_scope.id and actor_kind=v_actor->>'kind' and authority_key=v_authority;
    return jsonb_build_object('revoked',true);
  end if;
  insert into fmat.conversation_grants(conversation_id,actor_kind,authority_key,credential,expires_at)
    values(v_scope.id,v_actor->>'kind',v_authority,p_credential,v_expiry)
    on conflict(conversation_id,actor_kind,authority_key) do update
      set credential=case when excluded.expires_at>fmat.conversation_grants.expires_at then excluded.credential else fmat.conversation_grants.credential end,
        expires_at=greatest(excluded.expires_at,fmat.conversation_grants.expires_at)
      where fmat.conversation_grants.revoked_at is null
    returning * into v_grant;
  if not found then raise exception 'FORBIDDEN'; end if;
  return fmat.conversation_projection(v_scope,v_grant,v_writable);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_access"(text, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fmat_conversation_check (
  p_grant_id        uuid,
  p_conversation_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_actor jsonb; v_scope fmat.conversation_scopes; v_grant fmat.conversation_grants; v_writable boolean;
begin
  select * into v_grant from fmat.conversation_grants where id=p_grant_id and conversation_id=p_conversation_id;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at<=now() then raise exception 'UNAUTHORIZED'; end if;
  v_actor:=fmat.credential_actor(v_grant.credential);
  select * into v_scope from fmat.conversation_scopes where id=v_grant.conversation_id;
  v_writable:=fmat.authorize_conversation(v_scope,v_actor);
  return fmat.conversation_projection(v_scope,v_grant,v_writable)||jsonb_build_object('actor',v_actor);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_check"(uuid, uuid) FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "fmat"."booking_identities"
  ADD CONSTRAINT "booking_identities_event_id_check" CHECK ((((length(event_id) >= 5) AND (length(event_id) <= 1024)) AND (event_id ~ '^[0-9a-v]+$'::text)));

ALTER TABLE "fmat"."conversation_scopes"
  ADD CONSTRAINT "conversation_scopes_host_id_fkey" FOREIGN KEY (host_id) REFERENCES fmat.hosts(id);

ALTER TABLE "fmat"."conversation_grants"
  ADD CONSTRAINT "conversation_grants_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES fmat.conversation_scopes(id);

ALTER TABLE "fmat"."conversation_scopes"
  ADD CONSTRAINT "conversation_scopes_request_id_fkey" FOREIGN KEY (request_id) REFERENCES fmat.requests(id);

CREATE INDEX conversation_scopes_request_idx ON fmat.conversation_scopes USING btree (request_id);

REVOKE ALL ON FUNCTION "fmat"."authorize_conversation"(fmat.conversation_scopes, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."conversation_projection"(fmat.conversation_scopes, fmat.conversation_grants, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "fmat"."credential_actor"(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fmat_conversation_access"(text, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_access"(text, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_access"(text, jsonb, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fmat_conversation_check"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_check"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fmat_conversation_check"(uuid, uuid) TO "service_role";
