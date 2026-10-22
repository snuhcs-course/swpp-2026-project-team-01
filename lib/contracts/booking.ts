import type { LinkPlan } from "./request";

// The booking contract shared by the booking job, the host and requester
// projections and the receipt cards (host-review-and-booking design 6 to 10).
// It mirrors app.bookings; the receipt carries only what the confirmed event's
// evidence and frozen payload say.

export const BOOKING_STATES = ["reserved", "dispatching", "confirmed", "failed", "cancelled"] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

// Why a booking failed or was cancelled (app.bookings.failure_category).
export const BOOKING_FAILURES = [
  // Revalidation found the interval no longer feasible.
  "conflict",
  // Revalidation could not finish: its deadline passed or Calendar was unreadable.
  "revalidation_unavailable",
  // Google refused the write.
  "calendar_rejected",
  // The host's Calendar grant was revoked or is missing.
  "calendar_access_revoked",
  // Reconciliation found the event cancelled: the host removed it.
  "event_removed",
  // The approval or agreement no longer names the current proposal.
  "stale_decision",
  // Cancelled before dispatch: withdrawn, declined or expired.
  "withdrawn",
  "declined",
  "expired",
] as const;
export type BookingFailure = (typeof BOOKING_FAILURES)[number];

// What either party sees about the booking. A receipt exists only once the
// booking is confirmed.
export type BookingStatusView = {
  readonly state: BookingState;
  readonly failure: BookingFailure | null;
  readonly receipt: BookingReceipt | null;
};

export type BookingReceipt = {
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly durationMinutes: number;
  readonly mode: "online" | "in_person";
  readonly location: string | null;
  readonly linkPlan: LinkPlan | null;
  // The join link Google returned (Meet) or the requester's own link.
  readonly joinUrl: string | null;
  readonly organizer: { readonly name: string | null; readonly email: string | null };
  readonly requester: { readonly name: string; readonly email: string };
  // Google's event page, shown to the host only.
  readonly calendarUrl: string | null;
};

// The authored status lines both audiences share.
export const BOOKING_STATUS_TEXT: Readonly<Record<BookingState, { readonly en: string; readonly ko: string }>> = {
  cancelled: { en: "Booking was cancelled before it started.", ko: "예약이 시작되기 전에 취소되었습니다." },
  confirmed: { en: "Booked. The event is in the calendar.", ko: "예약되었습니다. 일정이 캘린더에 있습니다." },
  dispatching: {
    en: "Booking in progress. We are confirming the event with Google Calendar.",
    ko: "예약 진행 중입니다. Google Calendar에서 일정을 확인하고 있습니다.",
  },
  failed: { en: "Booking did not go through.", ko: "예약이 완료되지 않았습니다." },
  reserved: { en: "Booking in progress.", ko: "예약 진행 중입니다." },
};

// One person on a receipt: "Name <address>", or the address alone when there is
// no name or the name is the address itself (Google returns no display name for
// a primary calendar's owner).
export function personLine(name: string | null, email: string | null) {
  const trimmed = name?.trim() || null;
  if (!email) return trimmed ?? "";
  return trimmed && trimmed.toLowerCase() !== email.toLowerCase() ? `${trimmed} <${email}>` : email;
}
