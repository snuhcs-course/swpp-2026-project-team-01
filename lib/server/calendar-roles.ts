import { z } from "zod";
import type { CalendarRef } from "../contracts/setup";
import { ensureDraftForAnalysis, lockActiveHost, publishAnalysis } from "./analysis";
import { assertRevision, type CommandDefinition, CommandError } from "./commands";
import type { Queryable } from "./database";
import {
  CalendarAccessError,
  type CalendarListEntry,
  type GoogleCalendarDependencies,
  openHostCalendar,
} from "./google-calendar";

// Calendar roles (host-setup: calendar roles from actual calendars). The host picks
// conflict calendars and one booking destination from the live calendar list, by
// provider identity, never by name. Saving them starts the first scan. Confirmed
// settings keep their own copy, so a ready host stays public on the confirmed
// destination until confirming again.

const WRITABLE_ROLES = new Set(["owner", "writer"]);
// How long a confirmed destination counts as verified before the next state read
// rechecks it against the live calendar list.
const RECHECK_AFTER_MS = 60 * 60 * 1000;

// Calendars Google generates from other data, not the host's commitments.
const GENERATED_CALENDAR = /#(holiday|contacts|weeknum)@group\.v\.calendar\.google\.com$/;

export function isWritable(calendar: Pick<CalendarRef, "accessRole">) {
  return WRITABLE_ROLES.has(calendar.accessRole);
}

function conflictReason(calendar: CalendarListEntry) {
  if (calendar.primary) return "Your main calendar.";
  if (isWritable(calendar)) return "You manage this calendar, so its events are yours.";
  return "Shared with you; its events can still take up your time.";
}

// Recommends conflict calendars and the booking destination, each with a short
// reason. Holiday, birthday and week-number calendars are left out because they are
// not commitments, as are free/busy-only calendars, whose events cannot be read.
export function recommendCalendarRoles(calendars: readonly CalendarListEntry[]): {
  conflict: { id: string; reason: string }[];
  booking: { id: string; reason: string } | null;
} {
  const conflict = calendars
    .filter((calendar) => !GENERATED_CALENDAR.test(calendar.id))
    .filter((calendar) => calendar.primary || ["owner", "writer", "reader"].includes(calendar.accessRole))
    .map((calendar) => ({ id: calendar.id, reason: conflictReason(calendar) }));

  const writable = calendars.filter((calendar) => isWritable(calendar) && !GENERATED_CALENDAR.test(calendar.id));
  const primary = writable.find((calendar) => calendar.primary);
  const destination = primary ?? writable.find((calendar) => calendar.accessRole === "owner") ?? writable[0];

  return {
    booking: destination
      ? {
          id: destination.id,
          reason: primary ? "Your main calendar, which you can add events to." : "You can add events to this calendar.",
        }
      : null,
    conflict,
  };
}

export type SavedCalendarRoles = {
  readonly revision: number;
  readonly conflictCalendars: CalendarRef[];
  readonly bookingCalendar: CalendarRef;
  readonly destinationVerifiedAt: string;
};

export async function readCalendarRoles(db: Queryable, hostAccountId: string): Promise<SavedCalendarRoles | null> {
  const [row] = await db<{
    booking_calendar: CalendarRef;
    conflict_calendars: CalendarRef[];
    destination_verified_at: Date;
    revision: number;
  }[]>`
    select revision, conflict_calendars, booking_calendar, destination_verified_at
    from app.calendar_roles
    where host_account_id = ${hostAccountId}
  `;

  if (!row) return null;

  return {
    bookingCalendar: row.booking_calendar,
    conflictCalendars: row.conflict_calendars,
    destinationVerifiedAt: row.destination_verified_at.toISOString(),
    revision: row.revision,
  };
}

function toRef(calendar: CalendarListEntry): CalendarRef {
  return {
    accessRole: calendar.accessRole,
    id: calendar.id,
    summary: calendar.summary,
    ...(calendar.primary ? { primary: true } : {}),
  };
}

const saveRolesInput = z.object({
  conflictCalendarIds: z.array(z.string().min(1).max(1024)).min(1).max(50),
  bookingCalendarId: z.string().min(1).max(1024),
});

// setup.save_calendar_roles. `live` is the calendar list the caller read just
// before running the command, so every saved ID is one the host has now and the
// destination is writable now. In one transaction it share-locks the active
// account, checks the expected roles revision (none saved yet: null or 0), saves
// the roles, keeps the draft row and publishes the scan for this revision.
export function saveCalendarRolesCommand(
  live: readonly CalendarListEntry[],
): CommandDefinition<{ conflictCalendarIds: string[]; bookingCalendarId: string }, { revision: number; analysisId: string }> {
  const byId = new Map(live.map((calendar) => [calendar.id, calendar]));

  return {
    input: saveRolesInput,
    operation: "setup.save_calendar_roles",
    async run(tx, context) {
      const hostAccountId = context.actor.id;
      await lockActiveHost(tx, hostAccountId);

      const conflictIds = [...new Set(context.input.conflictCalendarIds)];
      const conflict = conflictIds.map((id) => byId.get(id));
      const booking = byId.get(context.input.bookingCalendarId);

      if (conflict.some((calendar) => !calendar) || !booking || !isWritable(booking)) {
        throw new CommandError("invalid_input");
      }

      // Serializes saves for one host, including the first, which has no row to lock.
      await tx`select pg_advisory_xact_lock(hashtextextended(${`app.calendar_roles:${hostAccountId}`}, 0))`;

      const [current] = await tx<{ revision: number }[]>`
        select revision from app.calendar_roles where host_account_id = ${hostAccountId}
      `;

      if (current) {
        assertRevision(current.revision, context.expectedRevision);
      } else if (context.expectedRevision !== null && context.expectedRevision !== 0) {
        throw new CommandError("stale_revision");
      }

      const conflictRefs = (conflict as CalendarListEntry[]).map(toRef);
      const [saved] = await tx<{ revision: number }[]>`
        insert into app.calendar_roles as stored (
          host_account_id, conflict_calendars, booking_calendar, destination_verified_at
        ) values (
          ${hostAccountId}, ${tx.json(conflictRefs)}, ${tx.json(toRef(booking))}, now()
        )
        on conflict (host_account_id) do update set
          revision = stored.revision + 1,
          conflict_calendars = excluded.conflict_calendars,
          booking_calendar = excluded.booking_calendar,
          destination_verified_at = excluded.destination_verified_at,
          updated_at = now()
        returning revision
      `;

      await ensureDraftForAnalysis(tx, hostAccountId);
      const analysisId = await publishAnalysis(tx, hostAccountId, saved!.revision, `roles-${saved!.revision}`);
      return { analysisId, revision: saved!.revision };
    },
  };
}

export type DestinationRecheck = "fresh" | "verified" | "unwritable" | "revoked" | "unknown";

// When a ready host opens setup, a confirmed destination last verified more than
// an hour ago is rechecked against the live calendar list. A missing or read-only
// destination is marked unwritable in the confirmed settings, which makes the host
// not ready until confirming again; a revoked grant was already marked invalid by
// the client. An unavailable Calendar changes nothing ("unknown").
export async function recheckConfirmedDestination(
  deps: GoogleCalendarDependencies,
  hostAccountId: string,
  now: Date = new Date(),
): Promise<DestinationRecheck> {
  const [row] = await deps.db<{ id: string | null; unwritable_at: string | null; verified_at: string | null }[]>`
    select settings -> 'bookingCalendar' ->> 'id' as id,
           settings -> 'bookingCalendar' ->> 'verifiedAt' as verified_at,
           settings -> 'bookingCalendar' ->> 'unwritableAt' as unwritable_at
    from app.host_settings
    where host_account_id = ${hostAccountId}
  `;

  if (!row?.id) return "unknown";
  if (row.unwritable_at) return "unwritable";

  const verifiedAt = row.verified_at ? Date.parse(row.verified_at) : Number.NaN;
  if (now.getTime() - verifiedAt < RECHECK_AFTER_MS) return "fresh";

  let calendars: CalendarListEntry[];

  try {
    const calendar = await openHostCalendar(deps, hostAccountId);
    calendars = (await calendar.listCalendars()).calendars;
  } catch (error) {
    if (error instanceof CalendarAccessError && error.category !== "calendar_unavailable") return "revoked";
    if (error instanceof CalendarAccessError) return "unknown";
    throw error;
  }

  const destination = calendars.find((calendar) => calendar.id === row.id);
  const stamp = now.toISOString();
  const writable = destination !== undefined && isWritable(destination);

  // Guarded by the destination ID, so a confirmation that changed the destination
  // meanwhile is never marked by this stale check.
  await deps.db`
    update app.host_settings
    set settings = jsonb_set(
          settings, ${writable ? ["bookingCalendar", "verifiedAt"] : ["bookingCalendar", "unwritableAt"]}::text[],
          to_jsonb(${stamp}::text)
        ),
        updated_at = now()
    where host_account_id = ${hostAccountId}
      and settings -> 'bookingCalendar' ->> 'id' = ${row.id}
      and settings -> 'bookingCalendar' ->> 'unwritableAt' is null
  `;

  return writable ? "verified" : "unwritable";
}
