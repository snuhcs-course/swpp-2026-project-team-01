import type { DashboardEvent } from "@lib/server/host-dashboard";

/** The full source name, used in accessible event labels. */
export function sourceLabel(event: DashboardEvent) {
  if (event.source === "sent") return "Sent request";
  return event.source === "thyme" ? "Find Me a Time meeting" : "Google Calendar event";
}

/** Where a request the host sent to another host stands; empty for other sources. */
export function sentState(event: DashboardEvent) {
  if (event.source !== "sent") return "";
  if (event.state === "awaiting_host_approval") return "Awaiting approval";
  if (event.state === "booked") return "Booked";
  if (event.state === "booking") return "Booking in progress";
  return "Choosing a time";
}

/** The short source name shown in the detail panel's agenda and badge. */
export function detailSource(event: DashboardEvent) {
  if (event.source === "sent") return `Sent request · ${sentState(event)}`;
  return event.source === "thyme" ? "Thyme meeting" : "Google Calendar";
}

/** The note under an event's details, explaining where it comes from. */
export function detailNote(event: DashboardEvent) {
  if (event.source === "sent") {
    return event.state === "booked"
      ? "A request you sent to another host through Find Me a Time. The meeting is booked."
      : "A request you sent to another host through Find Me a Time. This time is not booked yet.";
  }
  return event.source === "thyme"
    ? "Booked by Thyme. This meeting is shown only once, even if it also appears in Google Calendar."
    : "From your private Google Calendar. Only you can see its details here.";
}

const MODE_LABELS = { in_person: "In person", online: "Online" } as const;

export type MeetingFact = { readonly label: string; readonly value: string; readonly href?: string };

/**
 * A Find Me a Time meeting's details, in the order the host saw them when
 * approving (When · Length · Mode · Place or Meeting link · With · Purpose).
 * Empty for other sources or a booking without its approved details.
 */
export function meetingFacts(event: DashboardEvent, when: string): MeetingFact[] {
  const meeting = event.meeting;
  if (event.source !== "thyme" || !meeting) return [];
  const { guest } = meeting;
  const facts: MeetingFact[] = [
    { label: "When", value: when },
    { label: "Length", value: `${meeting.durationMinutes} minutes` },
    { label: "Mode", value: MODE_LABELS[meeting.mode] },
    meeting.mode === "in_person"
      ? { label: "Place", value: event.location ?? "Not set" }
      : meeting.joinUrl
        ? { href: meeting.joinUrl, label: "Meeting link", value: meeting.joinUrl }
        : { label: "Meeting link", value: "Not set" },
    { label: "With", value: guest.email ? `${guest.name} <${guest.email}>${guest.emailConfirmed ? "" : " (address not confirmed)"}` : guest.name },
  ];
  if (meeting.purpose && meeting.purpose !== event.title) facts.push({ label: "Purpose", value: meeting.purpose });
  return facts;
}

/** The host's own view of the request behind a Find Me a Time meeting. */
export function meetingRequestPath(event: DashboardEvent) {
  return event.source === "thyme" && event.meeting ? `/app?request=${encodeURIComponent(event.meeting.requestId)}` : null;
}

/** Who or what a calendar block is about, shown next to its time. */
export function blockLabel(event: DashboardEvent) {
  return event.source === "thyme" && event.meeting ? `With ${event.meeting.guest.name}` : event.title;
}
