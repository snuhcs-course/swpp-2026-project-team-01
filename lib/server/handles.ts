import {
  HANDLE_CHANGE_LIMIT,
  HANDLE_CHANGE_WINDOW_DAYS,
  handleBaseFromEmail,
  handleProblem,
  normalizeHandle,
} from "../contracts/handles";
import type { Queryable, Transaction } from "./database";

// Public handle assignment (host-admission: stable public identity and the handle
// change limit). Every handle ever assigned stays in app.host_handles under its
// host, so a released handle never resolves to anyone else; app.handle_assignments
// counts changes.

export type HandleAvailability = "available" | "format" | "reserved" | "taken" | "change_limit";

export class HandleError extends Error {
  readonly problem: Exclude<HandleAvailability, "available">;

  constructor(problem: Exclude<HandleAvailability, "available">) {
    super(`The handle cannot be assigned: ${problem}.`);
    this.name = "HandleError";
    this.problem = problem;
  }
}

// Whether the host may take this handle now. Another host's current or released
// handle is taken; the host's own current handle is available without a change.
// The first assignment is free, then at most HANDLE_CHANGE_LIMIT in any rolling
// window.
export async function checkHandle(
  db: Queryable,
  hostAccountId: string,
  candidate: string,
  now = new Date(),
): Promise<{ handle: string; availability: HandleAvailability }> {
  const handle = normalizeHandle(candidate);
  const problem = handleProblem(handle);

  if (problem) return { availability: problem, handle };

  const [owner] = await db<{ host_account_id: string; released_at: Date | null }[]>`
    select host_account_id, released_at from app.host_handles where handle = ${handle}
  `;

  if (owner && owner.host_account_id !== hostAccountId) return { availability: "taken", handle };
  if (owner && owner.released_at === null) return { availability: "available", handle };

  const [counts] = await db<{ recent: number; total: number }[]>`
    select
      count(*)::int as total,
      count(*) filter (
        where n > 1 and assigned_at > ${now}::timestamptz - make_interval(days => ${HANDLE_CHANGE_WINDOW_DAYS})
      )::int as recent
    from (
      select assigned_at, row_number() over (order by id) as n
      from app.handle_assignments
      where host_account_id = ${hostAccountId}
    ) assignments
  `;

  return {
    availability: counts!.total > 0 && counts!.recent >= HANDLE_CHANGE_LIMIT ? "change_limit" : "available",
    handle,
  };
}

// Assigns a handle inside the caller's transaction. The host's handle set and the
// handle itself are locked (always in that order) before the recheck, so two hosts
// racing for one handle, or one host making two changes, serialize. Taking back
// one's own released handle reclaims its row and still counts as a change.
export async function assignHandle(
  tx: Transaction,
  hostAccountId: string,
  candidate: string,
): Promise<{ handle: string; changed: boolean }> {
  const handle = normalizeHandle(candidate);

  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.host_handles:${hostAccountId}`}, 0))`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.handle:${handle}`}, 0))`;

  const { availability } = await checkHandle(tx, hostAccountId, handle);

  if (availability !== "available") throw new HandleError(availability);
  if ((await currentHandle(tx, hostAccountId)) === handle) return { changed: false, handle };

  await tx`
    update app.host_handles set released_at = now()
    where host_account_id = ${hostAccountId} and released_at is null
  `;

  const [assigned] = await tx<{ handle: string }[]>`
    insert into app.host_handles as stored (handle, host_account_id)
    values (${handle}, ${hostAccountId})
    on conflict (handle) do update set released_at = null, assigned_at = now()
      where stored.host_account_id = excluded.host_account_id
    returning handle
  `;

  // The primary key is the backstop if a row appeared without the lock.
  if (!assigned) throw new HandleError("taken");

  await tx`insert into app.handle_assignments (host_account_id, handle) values (${hostAccountId}, ${handle})`;

  return { changed: true, handle };
}

const MAX_PROPOSAL_ATTEMPTS = 50;

// The starter-default handle: the address's local part in handle form, then
// numeric suffixes past reserved and taken names. A host at the change limit keeps
// its current handle. Null when nothing within the attempt bound is available.
export async function proposeHandle(db: Queryable, hostAccountId: string, email: string) {
  const base = handleBaseFromEmail(email);

  for (let attempt = 1; attempt <= MAX_PROPOSAL_ATTEMPTS; attempt += 1) {
    const { availability, handle } = await checkHandle(db, hostAccountId, attempt === 1 ? base : `${base}${attempt}`);

    if (availability === "available") return handle;
    if (availability === "change_limit") return currentHandle(db, hostAccountId);
  }

  return null;
}

export async function currentHandle(db: Queryable, hostAccountId: string) {
  const [row] = await db<{ handle: string }[]>`
    select handle from app.host_handles where host_account_id = ${hostAccountId} and released_at is null
  `;

  return row?.handle ?? null;
}
