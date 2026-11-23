import { GOOGLE_CALENDAR_SCOPES } from "../contracts/google-scopes";
import type { Queryable } from "./database";

// Readiness, the second half of the shared guard: a public booking profile needs
// an active account, confirmed settings with a booking destination not since found
// unwritable, a current handle, and a Google grant that can still write events.
// Every public surface and the workspace derive it here, from durable records.

// The one "Calendar is usable" predicate, over a provider_grants row aliased `g`:
// a stored refresh token, not marked invalid, with all three Calendar scopes.
// Readiness and the setup step's Calendar connection both use it, so a host is
// never ready on a grant that setup reports as disconnected.
export function calendarUsable(q: Queryable) {
  return q`(
    g.refresh_token_ciphertext is not null
    and g.invalidated_at is null
    and coalesce(g.granted_scopes @> ${[...GOOGLE_CALENDAR_SCOPES]}::text[], false)
  )`;
}

export type Readiness = {
  readonly ready: boolean;
  readonly handle: string | null;
  readonly displayName: string | null;
};

export async function readReadiness(db: Queryable, hostAccountId: string): Promise<Readiness> {
  const [row] = await db<{ display_name: string | null; handle: string | null; ready: boolean }[]>`
    select
      h.handle,
      s.settings ->> 'displayName' as display_name,
      (
        a.status = 'active'
        and s.host_account_id is not null
        and s.settings -> 'bookingCalendar' ->> 'id' is not null
        and s.settings -> 'bookingCalendar' ->> 'unwritableAt' is null
        and h.handle is not null
        and ${calendarUsable(db)}
      ) as ready
    from app.host_accounts a
    left join app.host_settings s on s.host_account_id = a.id
    left join app.host_handles h on h.host_account_id = a.id and h.released_at is null
    left join app.provider_grants g on g.host_account_id = a.id
    where a.id = ${hostAccountId}
  `;

  if (!row) return { displayName: null, handle: null, ready: false };

  return { displayName: row.display_name, handle: row.handle, ready: row.ready };
}

// The ready host behind a public handle, or null for an unknown, released,
// unready or suspended one, which every public surface treats the same way.
// Whether the host saved settings at least once. Readiness can lapse later (a
// revoked grant, a booking calendar that is no longer writable), but setup is
// not starting over, so the chat setup's overview and step lines are left out.
export async function savedSettingsOnce(db: Queryable, hostAccountId: string) {
  const [row] = await db`select 1 from app.host_settings where host_account_id = ${hostAccountId}`;
  return row !== undefined;
}

export async function findReadyHostByHandle(db: Queryable, handle: string) {
  const [row] = await db<{ host_account_id: string }[]>`
    select host_account_id from app.host_handles where handle = ${handle} and released_at is null
  `;

  if (!row) return null;

  const readiness = await readReadiness(db, row.host_account_id);
  const [preference] = await db<{ accepting_requests: boolean }[]>`
    select accepting_requests from app.host_accounts where id = ${row.host_account_id}
  `;
  return preference?.accepting_requests && readiness.ready && readiness.handle && readiness.displayName
    ? { displayName: readiness.displayName, handle: readiness.handle, hostAccountId: row.host_account_id }
    : null;
}
