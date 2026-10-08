-- Bounded host navigation, separate from private transcript/evidence reads.
create index requests_host_cursor_idx on fmat.requests(host_id,created_at desc,id desc);

create or replace function fmat.host_request_summary(p_request fmat.requests)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('requestId',p_request.id,'revision',p_request.revision,
   'title',left(coalesce(p_request.details->>'purpose',''),200),
   'requesterName',coalesce(p_request.details->>'requesterName',''),
   'status',case when p_request.status in ('gathering','negotiating','awaiting_approval') and p_request.expires_at<=statement_timestamp() then 'expired' else p_request.status end,
   'closed',p_request.status in ('booked','declined','withdrawn','expired') or (p_request.status<>'booking' and p_request.expires_at<=statement_timestamp()),
   'createdAt',p_request.created_at,'updatedAt',p_request.updated_at,'proposalVersion',p_request.current_proposal_version);
$$;


-- Shared projection/query only. Callers must establish current host authority
-- before invoking this private helper; no client role can execute it directly.
create or replace function fmat.host_request_page(p_host_id uuid,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_request fmat.requests; v_item jsonb; v_rows jsonb:='[]'; v_cursor jsonb; v_search text; v_status text; v_before timestamptz; v_id uuid;
begin
 if p_host_id is null then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT';end if;
 v_search:=trim(coalesce(p_input->>'search',''));v_status:=coalesce(p_input->>'status','active');
 if length(v_search)>200 or v_status not in ('active','closed','all') or ((p_input->>'beforeId') is null)<>((p_input->>'beforeCreatedAt') is null) then raise exception 'INVALID_INPUT'; end if;
 v_before:=(p_input->>'beforeCreatedAt')::timestamptz;v_id:=(p_input->>'beforeId')::uuid;
 -- Pagination is stable under updates. The cursor is a position, never authority.
 for v_request in select r.* from fmat.requests r where r.host_id=p_host_id
   and (v_before is null or (r.created_at,r.id)<(v_before,v_id))
   and (v_search='' or position(lower(v_search) in lower(coalesce(r.details->>'purpose','')||' '||coalesce(r.details->>'requesterName','')))>0)
   and (v_status='all' or (v_status='closed')=(r.status in ('booked','declined','withdrawn','expired') or (r.status<>'booking' and r.expires_at<=statement_timestamp())))
   order by r.created_at desc,r.id desc limit 31
 loop
   if jsonb_array_length(v_rows)=30 then return jsonb_build_object('requests',v_rows,'nextCursor',v_cursor); end if;
   v_item:=fmat.host_request_summary(v_request);v_rows:=v_rows||jsonb_build_array(v_item);
   v_cursor:=jsonb_build_object('beforeCreatedAt',v_request.created_at,'beforeId',v_request.id);
 end loop;
 return jsonb_build_object('requests',v_rows,'nextCursor',null);
end;
$$;
revoke all on function fmat.host_request_page(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.fmat_host_requests(p_operation text,p_credential jsonb,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor jsonb; v_request fmat.requests;
begin
 if p_credential->>'kind' is distinct from 'host' then raise exception 'FORBIDDEN'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 if p_operation='read' then
   -- Match the request -> host -> Auth lock order used by conversation/evaluation.
   select * into v_request from fmat.requests where id=(p_input->>'requestId')::uuid for update;
 end if;
 v_actor:=fmat.calendar_actor(p_credential);
 if p_operation='read' then
   if v_request.id is null or v_request.host_id::text is distinct from v_actor->>'id' then raise exception 'NOT_FOUND'; end if;
   return fmat.host_request_summary(v_request);
 elsif p_operation<>'list' then raise exception 'FORBIDDEN'; end if;
 return fmat.host_request_page((v_actor->>'id')::uuid,p_input);
end;
$$;
revoke all on function fmat.host_request_summary(fmat.requests) from public,anon,authenticated,service_role;
revoke all on function public.fmat_host_requests(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fmat_host_requests(text,jsonb,jsonb) to service_role;
