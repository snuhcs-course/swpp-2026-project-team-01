-- Private, bounded recognition, not a general secret detector. Decode ASCII
-- letters/digits/underscore in names only; never decode arbitrary message bytes.
create or replace function fmat.conversation_ascii_name(p_text text)
returns text language plpgsql immutable strict set search_path='' as $$
declare v_match text[]; v_result text:=p_text; v_byte integer;
begin
  for v_match in select regexp_matches(p_text,'%([a-f0-9]{2})','gi') loop
    v_byte:=get_byte(decode(v_match[1],'hex'),0);
    if v_byte between 48 and 57 or v_byte between 65 and 90 or v_byte between 97 and 122 or v_byte=95 then
      v_result:=replace(v_result,'%'||v_match[1],chr(v_byte));
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function fmat.protect_conversation_text(p_text text)
returns text language plpgsql immutable strict set search_path='' as $$
declare v_text text; v_source text:=p_text; v_match text[]; v_offset integer; v_position integer;
begin
  if length(p_text) not between 1 and 10000 then raise exception 'INVALID_INPUT'; end if;
  -- [x] means removed credential material. It is shorter than every recognized
  -- shape, so protection never expands an accepted input past the ledger limit.
  -- Reconstruct by position: replacing a short match globally could remove only
  -- the prefix of another, longer credential and leave its suffix behind.
  v_text:=''; v_offset:=1;
  for v_match in select regexp_matches(v_source,'(https?://[^[:space:]<>#]+#([^[:space:]<>]+))','gi') loop
    v_position:=v_offset+strpos(substr(v_source,v_offset),v_match[1])-1;
    v_text:=v_text||substr(v_source,v_offset,v_position-v_offset);
    if fmat.conversation_ascii_name(v_match[2]) ~* 'token|code|state|secret|proof|recovery|invitation|imessage|credential' then
      v_text:=v_text||left(v_match[1],length(v_match[1])-length(v_match[2]))||'[x]';
    else v_text:=v_text||v_match[1]; end if;
    v_offset:=v_position+length(v_match[1]);
  end loop;
  v_source:=v_text||substr(v_source,v_offset); v_text:=''; v_offset:=1;
  for v_match in select regexp_matches(v_source,'(([[:alnum:]_%.-]+)=([^[:space:]&#<>]*))','g') loop
    v_position:=v_offset+strpos(substr(v_source,v_offset),v_match[1])-1;
    v_text:=v_text||substr(v_source,v_offset,v_position-v_offset);
    if fmat.conversation_ascii_name(v_match[2]) ~* 'token|code|state|secret|proof|recovery|invitation|credential' then
      v_text:=v_text||'[x]';
    else v_text:=v_text||v_match[1]; end if;
    v_offset:=v_position+length(v_match[1]);
  end loop;
  v_text:=v_text||substr(v_source,v_offset);
  v_text:=regexp_replace(v_text,'\mBearer[[:space:]]+[A-Za-z0-9._~+/-]+=*','[x]','gi');
  return regexp_replace(v_text,'\mLINK[[:space:]]+[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[[:space:]]+[A-Za-z0-9_-]{32,}','[x]','gi');
end;
$$;

create or replace function fmat.conversation_input_fingerprint(p_scope uuid,p_grant uuid,p_client uuid,p_text text)
returns text language sql immutable strict set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_array('runtime-input:v1',p_scope,p_grant,p_client,p_text)::text,'UTF8')),'hex')
$$;

-- Nullable only for the interval before the separately reviewed data backfill.
-- New admission always writes this private digest of the original exact input.
alter table fmat.runtime_messages add column input_fingerprint text
  check(input_fingerprint ~ '^[a-f0-9]{64}$');
revoke all on function fmat.conversation_ascii_name(text) from public,anon,authenticated,service_role;
revoke all on function fmat.protect_conversation_text(text) from public,anon,authenticated,service_role;
revoke all on function fmat.conversation_input_fingerprint(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
