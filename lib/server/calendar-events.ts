import type { LinkPlan } from "../contracts/request";

// The Google Calendar event a booking creates (host-review-and-booking design 5,
// D1, D4, D5), and a group meeting's (group-scheduling design 6). The event ID is the booking ID's 32 hexadecimal digits, which are
// valid base32hex, so it is fixed before dispatch: a repeated insert answers 409
// instead of making a second event, and reconciliation reads the event by it.
// The description carries the meeting details and the join line, never the
// booking link, host notes, rules or reasons.

export function eventIdFor(bookingId: string) {
  const id = bookingId.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("A booking ID is a UUID.");
  return id;
}

export type EventSource = {
  readonly bookingId: string;
  readonly purpose: string | null;
  readonly start: string;
  readonly end: string;
  readonly hostTimezone: string;
  readonly mode: "online" | "in_person";
  readonly location: string | null;
  readonly linkPlan: LinkPlan | null;
  // The requester, or every done participant of a group meeting
  // (group-scheduling design 6); the first names an untitled event.
  readonly attendees: readonly [{ readonly name: string; readonly email: string }, ...{ readonly name: string; readonly email: string }[]];
};

export function eventTitle(purpose: string | null, requesterName: string) {
  const trimmed = purpose?.trim();
  return trimmed ? trimmed.slice(0, 200) : `Meeting with ${requesterName}`;
}

function descriptionOf(source: EventSource) {
  const lines = [eventTitle(source.purpose, source.attendees[0].name)];

  if (source.mode === "in_person" && source.location) lines.push(`Where: ${source.location}`);
  if (source.linkPlan?.kind === "requester_link") lines.push(`Join: ${source.linkPlan.url}`);
  if (source.linkPlan?.kind === "google_meet") lines.push("Join with the Google Meet link on this event.");
  lines.push("", "Scheduled with Find Me a Time.");

  return lines.join("\n");
}

// The frozen events.insert body.
export function buildEventPayload(source: EventSource): Record<string, unknown> {
  const location =
    source.mode === "in_person" ? source.location : source.linkPlan?.kind === "requester_link" ? source.linkPlan.url : null;

  return {
    attendees: source.attendees.map((attendee) => ({ displayName: attendee.name, email: attendee.email })),
    ...(source.linkPlan?.kind === "google_meet" && source.mode === "online"
      ? { conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" }, requestId: source.bookingId } } }
      : {}),
    description: descriptionOf(source),
    end: { dateTime: source.end, timeZone: source.hostTimezone },
    extendedProperties: { private: { fmatBookingId: source.bookingId } },
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    id: eventIdFor(source.bookingId),
    ...(location ? { location } : {}),
    reminders: { useDefault: true },
    start: { dateTime: source.start, timeZone: source.hostTimezone },
    summary: eventTitle(source.purpose, source.attendees[0].name),
  };
}
