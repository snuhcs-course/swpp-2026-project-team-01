-- One reusable row per principal plus the service row; no message content or
-- credentials. Service serialization also fixes lock order across principals.
create table fmat.conversation_budgets (
  name text primary key check(name='service' or name ~ '^(host|guest):[a-f0-9-]{36}$'),
  minute_started_at timestamptz not null,
  minute_used integer not null check(minute_used>=0),
  hour_started_at timestamptz not null,
  hour_used integer not null check(hour_used>=0)
);
alter table fmat.conversation_budgets enable row level security;
revoke all on fmat.conversation_budgets from public,anon,authenticated,service_role;

create or replace function fmat.conversation_budget_charge(p_kind text,p_id uuid)
returns void language plpgsql set search_path='' as $$
declare key text; b fmat.conversation_budgets; checked_at timestamptz; minute_limit integer; hour_limit integer;
begin
 if p_kind is null or p_kind not in ('host','guest') or p_id is null then raise exception 'UNAUTHORIZED';end if;
 foreach key in array array['service',p_kind||':'||p_id::text] loop
  insert into fmat.conversation_budgets values(key,clock_timestamp(),0,clock_timestamp(),0) on conflict do nothing;
  perform 1 from fmat.conversation_budgets where name=key for update;
 end loop;
 checked_at:=clock_timestamp();
 foreach key in array array['service',p_kind||':'||p_id::text] loop
  select * into strict b from fmat.conversation_budgets where name=key;
  if b.minute_started_at+interval '1 minute'<=checked_at then b.minute_started_at:=checked_at;b.minute_used:=0;end if;
  if b.hour_started_at+interval '1 hour'<=checked_at then b.hour_started_at:=checked_at;b.hour_used:=0;end if;
  minute_limit:=case when key='service' then 200 else 20 end;
  hour_limit:=case when key='service' then 2000 else 100 end;
  if b.minute_used>=minute_limit or b.hour_used>=hour_limit then raise exception 'CONVERSATION_RATE_LIMIT';end if;
  update fmat.conversation_budgets set minute_started_at=b.minute_started_at,minute_used=b.minute_used+1,
   hour_started_at=b.hour_started_at,hour_used=b.hour_used+1 where name=key;
 end loop;
end;
$$;
revoke all on function fmat.conversation_budget_charge(text,uuid) from public,anon,authenticated,service_role;
