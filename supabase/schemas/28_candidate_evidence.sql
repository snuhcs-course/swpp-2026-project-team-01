-- Private immutable evidence. These rows are not offered candidates or decisions.
create table fmat.candidate_evaluations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references fmat.requests(id) on delete cascade,
  check_id uuid not null,
  request_revision integer not null check(request_revision>0),
  rules_version integer not null check(rules_version>=0),
  basis text not null check(basis ~ '^[a-f0-9]{64}$'),
  candidate_key text not null check(candidate_key ~ '^[a-f0-9]{64}$'),
  candidate jsonb not null check(jsonb_typeof(candidate)='object' and candidate ?& array['start','end']),
  status text not null check(status in ('checks_passed','conflict','clarification')),
  evidence jsonb not null check(jsonb_typeof(evidence)='object' and (evidence->'complete'='false'::jsonb) is true and ((evidence->>'preferences'='pending') or jsonb_typeof(evidence->'preferences')='object') is true and octet_length(evidence::text)<=65536),
  private_context jsonb not null check(jsonb_typeof(private_context)='object' and octet_length(private_context::text)<=262144),
  evaluated_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>evaluated_at),
  unique(request_id,check_id,candidate_key)
);
create index candidate_evaluations_request_idx on fmat.candidate_evaluations(request_id,evaluated_at desc);
alter table fmat.candidate_evaluations enable row level security;
revoke all on fmat.candidate_evaluations from public,anon,authenticated;
create or replace function fmat.reject_candidate_evaluation_update()
returns trigger language plpgsql set search_path='' as $$ begin raise exception 'IMMUTABLE_EVALUATION'; end; $$;
create trigger candidate_evaluations_immutable before update on fmat.candidate_evaluations for each row execute function fmat.reject_candidate_evaluation_update();
