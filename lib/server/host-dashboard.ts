import { readCalendarRoles } from "./calendar-roles";
import { bookingJoinUrl } from "../contracts/booking";
import type { LinkPlan, RequestState } from "../contracts/request";
import type { Queryable } from "./database";
import { CalendarAccessError, openHostCalendar, type GoogleCalendarDependencies } from "./google-calendar";

export type DashboardEvent = {
  readonly id: string;
  readonly source: "google" | "thyme" | "sent";
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly location: string | null;
  readonly state?: RequestState;
  // A Find Me a Time meeting's details, as the host saw them when approving.
  readonly meeting?: BookedMeeting;
};

export type BookedMeeting = {
  readonly requestId: string;
  readonly durationMinutes: number;
  readonly mode: "online" | "in_person";
  // The Meet link Google returned, or the requester's own link; online only.
  readonly joinUrl: string | null;
  readonly guest: { readonly name: string; readonly email: string | null; readonly emailConfirmed: boolean };
  readonly purpose: string | null;
};

export type DashboardData = {
  readonly events: DashboardEvent[];
  readonly timeZone: string;
  readonly googleWarning: string | null;
};

export type BookingRow = {
  id: string;
  request_id: string;
  calendar_id: string;
  event_id: string;
  start_at: Date;
  end_at: Date;
  payload: { summary?: unknown; location?: unknown } | null;
  evidence: { iCalUID?: unknown; joinUrl?: unknown } | null;
  details: { mode?: "online" | "in_person"; location?: string | null; linkPlan?: LinkPlan | null } | null;
  requester_name: string | null;
  contact_email: string | null;
  contact_confirmed_email: string | null;
  purpose: string | null;
};

type SentRow = {
  id: string;
  state: RequestState;
  host_name: string | null;
  start_at: Date;
  end_at: Date;
  calendar_id: string | null;
  event_id: string | null;
  evidence: { iCalUID?: unknown } | null;
};

// A confirmed booking as a Find Me a Time meeting: its frozen title and place,
// and the details the host approved (length, mode, join link, guest, purpose).
export function bookedEvent(booking: BookingRow): DashboardEvent {
  const mode = booking.details?.mode;
  const known = mode === "online" || mode === "in_person";
  const email = booking.contact_email ?? null;
  return {
    id: `thyme:${booking.id}`,
    source: "thyme",
    title: typeof booking.payload?.summary === "string" && booking.payload.summary ? booking.payload.summary : "Meeting booked by Thyme",
    start: booking.start_at.toISOString(),
    end: booking.end_at.toISOString(),
    allDay: false,
    location: typeof booking.payload?.location === "string" ? booking.payload.location : mode === "in_person" ? booking.details?.location ?? null : null,
    ...(known ? {
      meeting: {
        durationMinutes: Math.round((booking.end_at.getTime() - booking.start_at.getTime()) / 60_000),
        guest: { email, emailConfirmed: email !== null && booking.contact_confirmed_email === email, name: booking.requester_name ?? "Guest" },
        joinUrl: bookingJoinUrl({ linkPlan: booking.details?.linkPlan ?? null, mode }, booking.evidence),
        mode,
        purpose: booking.purpose?.trim() || null,
        requestId: booking.request_id,
      },
    } : {}),
  };
}

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
    select b.id, b.request_id, b.calendar_id, b.event_id, b.start_at, b.end_at, b.payload, b.evidence,
           p.details, r.requester_name, r.contact_email, r.contact_confirmed_email, r.details ->> 'purpose' as purpose
    from app.bookings b
    join app.proposals p on p.id = b.proposal_id
    join app.requests r on r.id = b.request_id
    where b.host_account_id = ${hostAccountId} and b.state = 'confirmed'
      and b.start_at < ${range.end} and b.end_at > ${range.start}
    order by b.start_at
  `;
  const sent = await db<SentRow[]>`
    select r.id, r.state,
           coalesce(s.settings ->> 'displayName', h.display_name, 'Host') as host_name,
           coalesce(b.start_at, p.start_at) as start_at,
           coalesce(b.end_at, p.end_at) as end_at,
           b.calendar_id, b.event_id, b.evidence
    from app.requester_host_profiles match
    join app.requests r on r.id = match.request_id
    join app.host_accounts h on h.id = r.host_account_id
    left join app.host_settings s on s.host_account_id = r.host_account_id
    left join lateral (
      select start_at, end_at from app.proposals where request_id = r.id order by version desc limit 1
    ) p on true
    left join lateral (
      select start_at, end_at, calendar_id, event_id, evidence from app.bookings
      where request_id = r.id and state = 'confirmed' order by updated_at desc limit 1
    ) b on true
    where match.host_account_id = ${hostAccountId}
      and r.state in ('gathering', 'negotiating', 'awaiting_host_approval', 'booking', 'booked')
      and coalesce(b.start_at, p.start_at) < ${range.end}
      and coalesce(b.end_at, p.end_at) > ${range.start}
    order by start_at
  `;
  const bookedIds = new Set([
    ...bookings.map((booking) => `${booking.calendar_id}:${booking.event_id}`),
    ...sent.filter((request) => request.calendar_id && request.event_id).map((request) => `${request.calendar_id}:${request.event_id}`),
  ]);
  const bookedUids = new Set([...bookings, ...sent].map((booking) => booking.evidence?.iCalUID).filter((uid): uid is string => typeof uid === "string"));
  const events: DashboardEvent[] = bookings.map(bookedEvent);
  events.push(...sent.map((request) => ({
    allDay: false,
    end: request.end_at.toISOString(),
    id: `sent:${request.id}`,
    location: null,
    source: "sent" as const,
    start: request.start_at.toISOString(),
    state: request.state,
    title: `With ${request.host_name ?? "Host"}`,
  })));

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
