import { readCalendarRoles } from "./calendar-roles";
import type { Queryable } from "./database";
import { CalendarAccessError, openHostCalendar, type GoogleCalendarDependencies } from "./google-calendar";

export type DashboardEvent = {
  readonly id: string;
  readonly source: "google" | "thyme";
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly location: string | null;
};

export type DashboardData = {
  readonly events: DashboardEvent[];
  readonly timeZone: string;
  readonly googleWarning: string | null;
};

type BookingRow = {
  id: string;
  calendar_id: string;
  event_id: string;
  start_at: Date;
  end_at: Date;
  payload: { summary?: unknown; location?: unknown } | null;
  evidence: { iCalUID?: unknown } | null;
};

// Only the signed-in host's confirmed bookings and selected conflict calendars
// reach this projection. Booking events are shown once, even when Google returns
// the same event from the destination or an attendee copy.
export async function readHostDashboard(
  db: Queryable,
  calendarDeps: GoogleCalendarDependencies,
  hostAccountId: string,
  range: { start: Date; end: Date },
): Promise<DashboardData> {
  const [settings] = await db<{ time_zone: string | null }[]>`
    select settings ->> 'timezone' as time_zone
    from app.host_settings where host_account_id = ${hostAccountId}
  `;
  const bookings = await db<BookingRow[]>`
    select id, calendar_id, event_id, start_at, end_at, payload, evidence
    from app.bookings
    where host_account_id = ${hostAccountId} and state = 'confirmed'
      and start_at < ${range.end} and end_at > ${range.start}
    order by start_at
  `;
  const bookedIds = new Set(bookings.map((booking) => `${booking.calendar_id}:${booking.event_id}`));
  const bookedUids = new Set(bookings.map((booking) => booking.evidence?.iCalUID).filter((uid): uid is string => typeof uid === "string"));
  const events: DashboardEvent[] = bookings.map((booking) => ({
    id: `thyme:${booking.id}`,
    source: "thyme",
    title: typeof booking.payload?.summary === "string" ? booking.payload.summary : "Meeting booked by Thyme",
    start: booking.start_at.toISOString(),
    end: booking.end_at.toISOString(),
    allDay: false,
    location: typeof booking.payload?.location === "string" ? booking.payload.location : null,
  }));

  let googleWarning: string | null = null;
  try {
    const roles = await readCalendarRoles(db, hostAccountId);
    const calendar = await openHostCalendar(calendarDeps, hostAccountId);
    const ids = [...new Set([...(roles?.conflictCalendars.map((item) => item.id) ?? []), ...(roles ? [roles.bookingCalendar.id] : [])])];
    const lists = await Promise.all(ids.map((id) => calendar.listEvents(id, range)));
    const seen = new Set<string>();
    for (const item of lists.flat()) {
      if (item.status === "cancelled" || bookedIds.has(`${item.calendarId}:${item.id}`) || (item.iCalUID && bookedUids.has(item.iCalUID))) continue;
      const identity = item.iCalUID ?? `${item.calendarId}:${item.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const start = item.start.dateTime ?? item.start.date;
      const end = item.end.dateTime ?? item.end.date;
      if (!start || !end) continue;
      events.push({
        id: `google:${identity}`,
        source: "google",
        title: item.summary?.trim() || "Untitled event",
        start,
        end,
        allDay: !item.start.dateTime,
        location: item.location,
      });
    }
  } catch (error) {
    if (!(error instanceof CalendarAccessError)) throw error;
    googleWarning = error.message;
  }

  return {
    events: events.sort((a, b) => a.start.localeCompare(b.start)),
    timeZone: settings?.time_zone || "UTC",
    googleWarning,
  };
}
