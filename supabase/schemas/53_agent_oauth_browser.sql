-- Browser grant management uses current owner authority, independently of the
-- original ten-minute authorization attempt or its initiating-browser cookie.
create or replace function public.fmat_oauth_grants_read(p_credential jsonb,p_cursor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor fmat.oauth_grants; v_cursor fmat.oauth_grants; v_rows jsonb; v_next uuid;
begin
  v_actor:=fmat.oauth_browser_authority(p_credential);
  if v_actor.actor_id is null then return '{"error":"invalid_grant"}';end if;
  if p_cursor is not null then
    select * into v_cursor from fmat.oauth_grants where id=p_cursor and actor_kind=v_actor.actor_kind and actor_id=v_actor.actor_id;
    if not found then return '{"error":"invalid_request"}';end if;
  end if;
  with page as (
    select g.id,c.name as client_name,g.scope,g.expires_at,c.disabled_at is not null as client_disabled,g.created_at
    from fmat.oauth_grants g join fmat.oauth_clients c on c.id=g.client_id
    where g.actor_kind=v_actor.actor_kind and g.actor_id=v_actor.actor_id and g.revoked_at is null and g.expires_at>clock_timestamp()
      and (p_cursor is null or (g.created_at,g.id)<(v_cursor.created_at,v_cursor.id))
    order by g.created_at desc,g.id desc limit 51
  ), numbered as (select *,row_number() over(order by created_at desc,id desc) as n from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'clientName',client_name,'scope',scope,'expiresAt',expires_at,'clientDisabled',client_disabled) order by n) filter(where n<=50),'[]'::jsonb),
    case when count(*)>50 then (array_agg(id order by n) filter(where n=50))[1] else null end
  into v_rows,v_next from numbered;
  if not fmat.oauth_authority_current(v_actor) or v_actor.expires_at<=clock_timestamp()
    or (v_actor.actor_kind='host' and (p_credential->>'expiresAt')::timestamptz<=clock_timestamp()) then return '{"error":"invalid_grant"}';end if;
  return jsonb_build_object('grants',v_rows,'nextCursor',v_next);
end$$;
create index oauth_grants_owner_page on fmat.oauth_grants(actor_kind,actor_id,created_at desc,id desc) where revoked_at is null;
revoke execute on function public.fmat_oauth_grants_read(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.fmat_oauth_grants_read(jsonb,uuid) to service_role;
