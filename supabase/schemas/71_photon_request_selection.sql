-- Selection belongs to a verified link. Replacement links start in setup.
alter table fmat.photon_links add column selected_request_id uuid references fmat.requests(id) on delete set null;
create index photon_links_selected_request_idx on fmat.photon_links(selected_request_id);
-- Frozen dispatch authority, also used by authored navigation replies that do
-- not invoke a model. Historical setup receipts retain their existing binding.
alter table fmat.photon_inbox
 add column conversation_id uuid references fmat.conversation_scopes(id),
 add column execution_grant_id uuid references fmat.conversation_grants(id),
 add constraint photon_inbox_context_pair check((conversation_id is null)=(execution_grant_id is null));
create index photon_inbox_conversation_idx on fmat.photon_inbox(conversation_id);
create index photon_inbox_execution_grant_idx on fmat.photon_inbox(execution_grant_id);

create or replace function fmat.photon_scoped_reply(p_scope uuid,p_text text)
returns text language plpgsql stable set search_path='' as $$
declare request_id uuid; prefix text;
begin
 select s.request_id into request_id from fmat.conversation_scopes s where s.id=p_scope and s.audience='host_private';
 if request_id is null then return p_text;end if;
 prefix:='Request '||request_id::text||E'\n\n';
 if length(prefix||p_text)<=4000 then return prefix||p_text;end if;
 return prefix||left(p_text,3900)||E'\nOpen your host workspace for the full reply.';
end;
$$;
revoke all on function fmat.photon_scoped_reply(uuid,text) from public,anon,authenticated,service_role;
