-- Preserve Calendar-dependent scheduling for pre-existing guest grants. The new
-- selector requires reconnect for older scope bundles; they must not turn manual.
update fmat.requests r set availability_mode='calendar'
where exists(select 1 from fmat.calendar_connections c where c.principal_kind='guest' and c.principal_id=r.id and c.revoked_at is null);
-- Remove obsolete guest secrets already closed/revoked/expired before the trigger.
update fmat.calendar_connections c set encrypted_credential=null,revoked_at=clock_timestamp(),selected_calendar_ids='{}',updated_at=clock_timestamp()
from fmat.requests r where c.principal_kind='guest' and c.principal_id=r.id
and (r.status in ('booked','declined','withdrawn','expired') or r.token_revoked_at is not null or r.token_expires_at<=clock_timestamp() or r.expires_at<=clock_timestamp() or c.guest_authority_key is distinct from r.token_hash);
