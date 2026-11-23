import { isValidTimeZone } from "../contracts/setup";
import { localDate } from "../contracts/timezone";
import type { Queryable } from "./database";
import { normalizeBusy } from "./feasibility";
import { type CalendarEvent, type GoogleCalendarConfig, openHostCalendar } from "./google-calendar";
import { readRequesterCalendarGrant, readRequesterEvents } from "./requester-calendar";
import { readGuestHostSource } from "./requester-host-profiles";
import type { TokenKey } from "./token-encryption";

// The guest's own busy times beside the offered times (calendar-views design
// 4; requester-calendar-access: private read-only Calendar access). It reads
// the same calendars an evaluation of this request reads, the request's own
// Calendar grant and, for a guest who is a host and chose Calendars, their
// host conflict calendars, under the same busy rules. Only start, end and
// all-day come back (an all-day span as its local dates, end exclusive): no
// title, place, attendee or calendar name, and nothing is stored or logged. It never closes a grant or changes the request.

export const MAX_BUSY_DAYS = 15;
const DAY = 86_400_000;

export type BusySpan = { readonly start: string; readonly end: string; readonly allDay: boolean };

export type RequesterBusy = {
  // Whether this request has a calendar to show; false shows no overlay.
  readonly connected: boolean;
  readonly busy: readonly BusySpan[];
};

export class RequesterBusyUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Your calendar could not be read right now.", options);
    this.name = "RequesterBusyUnavailableError";
  }
}

export type BusyRange = { readonly start: Date; readonly end: Date };

/** The range a query asks for, or null when it is missing, reversed or longer than MAX_BUSY_DAYS. */
export function busyRange(from: string | null, to: string | null): BusyRange | null {
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end <= start || end.getTime() - start.getTime() > MAX_BUSY_DAYS * DAY) return null;
  return { end, start };
}

export type RequesterBusyDependencies = {
  readonly db: Queryable;
  readonly tokenKeys: readonly TokenKey[];
  readonly requesterCalendar: GoogleCalendarConfig;
  readonly hostCalendar: GoogleCalendarConfig;
};

export async function readRequesterBusy(
  deps: RequesterBusyDependencies,
  requestId: string,
  range: BusyRange,
  timeZone: string,
): Promise<RequesterBusy> {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const spans: BusySpan[] = [];
  let connected = false;

  try {
    const grant = await readRequesterCalendarGrant(deps.db, deps.tokenKeys, requestId);
    if (grant) {
      connected = true;
      const events = await readRequesterEvents(deps.requesterCalendar, grant, range);
      spans.push(...toSpans(events, grant.email, zone));
    }

    const guestHost = await readGuestHostSource(deps.db, requestId);
    if (guestHost) {
      connected = true;
      const calendar = await openHostCalendar({ config: deps.hostCalendar, db: deps.db, tokenKeys: deps.tokenKeys }, guestHost.hostAccountId);
      const events: CalendarEvent[] = [];
      for (const entry of guestHost.conflictCalendars) events.push(...(await calendar.listEvents(entry.id, range)));
      spans.push(...toSpans(events, guestHost.email, zone));
    }
  } catch (error) {
    throw new RequesterBusyUnavailableError({ cause: error });
  }

  return { busy: spans.sort((a, b) => a.start.localeCompare(b.start)), connected };
}

// The evaluation's busy rules (cancelled, free, declined and duplicate events
// are not busy), reduced to times only. An all-day event keeps its local dates.
function toSpans(events: readonly CalendarEvent[], selfEmail: string | null, timeZone: string): BusySpan[] {
  return normalizeBusy(events, { endpointKey: () => "", selfEmail, timezone: timeZone }).map((interval) =>
    interval.allDay
      ? { allDay: true, end: localDate(new Date(interval.end), timeZone), start: localDate(new Date(interval.start), timeZone) }
      : { allDay: false, end: new Date(interval.end).toISOString(), start: new Date(interval.start).toISOString() },
  );
}
