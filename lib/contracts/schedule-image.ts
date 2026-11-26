import type { LocalRange } from "./slot-preview";
import type { Weekday } from "./setup";

// The host's schedule as one picture in the linked messenger
// (messenger-schedule-image design 2): up to a week of the Dashboard's events,
// laid out by local day, as the outbox seals it and the renderer draws it.

export const SCHEDULE_IMAGE_MAX_DAYS = 7;

export type ScheduleImageKind = "approved_meeting" | "booked_meeting" | "calendar_event" | "request_to_decide" | "sent_request";

// A timed entry's part on one day, HH:MM in the host's timezone; end "24:00" runs to midnight.
export type ScheduleImageEntry = LocalRange & { readonly kind: ScheduleImageKind; readonly title: string };

export type ScheduleImageAllDay = { readonly kind: ScheduleImageKind; readonly title: string };

export type ScheduleImageDay = {
  readonly date: string;
  readonly weekday: Weekday;
  readonly allDay: readonly ScheduleImageAllDay[];
  readonly entries: readonly ScheduleImageEntry[];
};

export type ScheduleImage = {
  readonly timezone: string;
  readonly from: string;
  readonly through: string;
  // The hours the grid spans.
  readonly grid: LocalRange;
  readonly days: readonly ScheduleImageDay[];
  // Unavailable when Google Calendar could not be read: only Find Me a Time meetings and requests are drawn.
  readonly googleCalendar: "read" | "unavailable";
};
