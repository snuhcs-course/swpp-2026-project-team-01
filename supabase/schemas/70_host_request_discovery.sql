-- Private navigation projection for the current authorized assistant context.
-- The public conversation RPC establishes host/audience authority first.
create or replace function fmat.host_request_model_page(p_host_id uuid,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare page jsonb; rows jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or p_input-array['search','status','beforeCreatedAt','beforeId']<>'{}'::jsonb
  or (p_input?'search' and jsonb_typeof(p_input->'search') is distinct from 'string')
  or (p_input?'status' and jsonb_typeof(p_input->'status') is distinct from 'string')
  or (p_input?'beforeCreatedAt' and jsonb_typeof(p_input->'beforeCreatedAt') is distinct from 'string')
  or (p_input?'beforeId' and jsonb_typeof(p_input->'beforeId') is distinct from 'string')
  then raise exception 'INVALID_INPUT'; end if;
 page:=fmat.host_request_page(p_host_id,p_input);
 select coalesce(jsonb_agg(jsonb_build_object(
  'requestId',item->'requestId','revision',item->'revision','title',item->'title',
  'status',item->'status','closed',item->'closed','createdAt',item->'createdAt',
  'updatedAt',item->'updatedAt','proposalVersion',item->'proposalVersion'
 ) order by position),'[]'::jsonb) into rows
 from jsonb_array_elements(page->'requests') with ordinality as entry(item,position);
 return jsonb_build_object('requests',rows,'nextCursor',page->'nextCursor');
end;
$$;
revoke all on function fmat.host_request_model_page(uuid,jsonb) from public,anon,authenticated,service_role;
