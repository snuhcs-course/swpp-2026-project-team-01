-- Synthetic state for the restore drill (scripts/restore-drill.ts;
-- operations-and-release design 7). It is loaded only into the drill's own
-- source database, never into a database a service uses. Every name and address
-- is generated and uses example.test; no row comes from a real person.

insert into auth.users (id, email, aud, role, created_at, updated_at)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'drill-host-' || n || '@example.test',
       'authenticated', 'authenticated', now(), now()
from generate_series(1, 12) n;

insert into app.host_accounts (id, status, display_name)
select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, case when n % 6 = 0 then 'suspended' else 'active' end,
       'Drill Host ' || n
from generate_series(1, 12) n;

insert into app.google_identities (google_subject, host_account_id, auth_user_id, email)
select 'drill-subject-' || n, ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'drill-host-' || n || '@example.test'
from generate_series(1, 12) n;

insert into app.host_handles (handle, host_account_id)
select 'drill-host-' || n, ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
from generate_series(1, 12) n;

insert into app.handle_assignments (host_account_id, handle)
select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'drill-host-' || n
from generate_series(1, 12) n;

insert into app.host_settings (host_account_id, settings, draft_revision)
select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       jsonb_build_object('timezone', 'Asia/Seoul', 'meetingMinutes', 30, 'note', 'synthetic ' || n), 1
from generate_series(1, 12) n;

-- Five requests per host, one in each of five states.
insert into app.requests (id, host_account_id, state, details, requester_name, contact_email, expires_at, closed_at)
select ('20000000-0000-4000-8000-' || lpad((h * 10 + s)::text, 12, '0'))::uuid,
       ('10000000-0000-4000-8000-' || lpad(h::text, 12, '0'))::uuid,
       (array['gathering', 'negotiating', 'awaiting_host_approval', 'booked', 'expired'])[s],
       jsonb_build_object('durationMinutes', 30, 'purpose', 'Synthetic meeting ' || h || '-' || s),
       'Drill Requester ' || h || '-' || s, 'drill-requester-' || h || '-' || s || '@example.test',
       now() + interval '7 days', case when s >= 4 then now() end
from generate_series(1, 12) h, generate_series(1, 5) s;

insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
select id, md5(id::text), 'synthetic-ciphertext', 'drill' from app.requests;

insert into app.email_deliveries (kind, request_id, sender, recipients, template, language, state, completed_at)
select 'request_creation', id, 'no-reply@findmeatime.com', array[contact_email], 'request_creation', 'en', 'accepted', now()
from app.requests;

insert into app.jobs (kind, payload, producer_environment, state, attempts, max_attempts, failure_category, completed_at)
select 'drill_' || (array['email', 'booking', 'analysis'])[1 + n % 3], jsonb_build_object('n', n), 'local',
       (array['completed', 'exhausted', 'pending'])[1 + n % 3], 1 + n % 5, 5,
       case when n % 3 = 1 then 'handler_failed' end, case when n % 3 = 0 then now() end
from generate_series(1, 90) n;

insert into app.command_outcomes (actor, retry_key, operation, resource_id, input_hash, result)
select 'host_account:drill-' || n, 'retry-' || n, 'drill.probe', 'resource-' || n, md5(n::text), jsonb_build_object('ok', true)
from generate_series(1, 40) n;

insert into app.operator_actions (operator, action, host_account_id, previous_status, reason, environment)
select 'drill', 'suspend', id, 'active', 'synthetic suspension', 'local' from app.host_accounts where status = 'suspended';

insert into app.rejection_observations (category, bucket, count)
values ('authorization_denied', date_bin('1 hour', now(), timestamptz '2000-01-01 00:00:00+00'), 3),
       ('stale_action', date_bin('1 hour', now(), timestamptz '2000-01-01 00:00:00+00'), 2);
