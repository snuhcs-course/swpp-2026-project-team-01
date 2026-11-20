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
