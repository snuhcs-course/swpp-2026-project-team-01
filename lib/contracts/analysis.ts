import type { Weekday } from "./setup";

// Calendar analysis evidence (host-setup: analysis evidence dimensions). The job
// stores AnalysisEvidence in app.calendar_analyses for 24 hours; the analysis card
// reads AnalysisCard, and the setup tools give the model only AnalysisForModel,
// which carries no event titles or identities. No attendee address is ever part
// of any of them.

export type AnalysisState = "pending" | "completed" | "failed";

export type ScannedCalendar = {
  readonly id: string;
  readonly summary: string;
  // Whether the scan read it; null while the scan is pending.
  readonly ok: boolean | null;
};

export type AnalysisEvidence = {
  // The host timezone the hours, weekdays and weeks are counted in.
  readonly timezone: string;
  // The primary calendar's own zone, when the scan could read the calendar list.
  // Scans stored before it was recorded lack it.
  readonly primaryTimeZone?: string | null;
  readonly scannedCalendars: readonly { readonly id: string; readonly summary: string; readonly ok: boolean }[];
  readonly preferredTimes: {
    readonly sampleSize: number;
    readonly samples?: readonly { readonly weekday: Weekday; readonly startMinute: number; readonly endMinute: number }[];
    readonly cells: readonly { readonly weekday: Weekday; readonly hour: number; readonly count: number }[];
    // Per weekday, the earliest start and latest end of counted meetings in
    // minutes from that day's local midnight (an end past midnight exceeds 1440).
    readonly spans: readonly { readonly weekday: Weekday; readonly startMinute: number; readonly endMinute: number }[];
  };
  readonly meetingLoad: {
    readonly sampleSize: number;
    // Weeks with at least one counted meeting, starting Monday in the host timezone.
    readonly weeks: readonly { readonly weekStart: string; readonly internal: number; readonly external: number }[];
    // The quietest week, 0 when a full week inside the range had no meeting.
    readonly min: number;
    readonly max: number;
  };
  readonly noteLike: {
    readonly entries: readonly {
      readonly calendarId: string;
      readonly eventId: string;
      // The provider's updated time, so a changed entry can be re-checked.
      readonly fingerprint: string;
      readonly title: string;
      readonly start: string;
      readonly allDay: boolean;
      // Scans stored before the note classifier (calendar-note-review) lack the
      // fields below; they expire within 24 hours.
      readonly end?: string;
      // The series a recurring occurrence belongs to (Google's recurringEventId).
      readonly seriesId?: string | null;
      // Whether the event has a location or a conference link: the classifier
      // gets only these flags, never the location text.
      readonly hasLocation?: boolean;
      readonly hasConferenceLink?: boolean;
      // The note classifier's recommendation and its short reason; absent when no
      // classifier ran. A recommendation frees nothing.
      readonly verdict?: "note" | "event" | "unsure";
      // The reason in English and Korean, so the review shows the host's screen
      // language; scans stored before that carry one reason, in the
      // conversation's language at scan time.
      readonly reasons?: { readonly en: string; readonly ko: string } | null;
      readonly reason?: string | null;
    }[];
  };
  readonly places: {
    readonly candidates?: readonly { readonly name: string; readonly count: number }[];
    readonly sampleSize: number;
    readonly area: { readonly name: string; readonly count: number } | null;
    readonly venue: { readonly name: string; readonly count: number } | null;
  };
  readonly durations: { readonly sampleSize: number; readonly medianMinutes: number | null };
  // Trips that could have shared a day (same-day-trips): counts only, never a
  // place. Scans stored before it was recorded lack it.
  readonly trips?: {
    // Local days with a busy, timed in-person event (a location and no
    // conference link).
    readonly inPersonDays: number;
    // Days with an in-person event at a place other than the most frequent one,
    // where that place also holds an in-person event on another day.
    readonly repeatedAwayDays: number;
  };
};

// The analysis card's projection: what was read, its result and the evidence,
// including note-like titles, which only the host sees.
export type AnalysisCard = {
  readonly id: string;
  readonly state: AnalysisState;
  readonly range: { readonly start: string; readonly end: string };
  readonly calendars: readonly ScannedCalendar[];
  readonly evidence: AnalysisEvidence | null;
  readonly failureCategory: string | null;
  readonly createdAt: string;
  // When the scan finished (ISO time), for its receipt in the setup conversation.
  readonly completedAt: string | null;
};

// The model's projection: counts and ranges, the number of note-like entries but
// never their titles, no place names, no event or calendar identities, and
// calendar names only as quoted data (JSON string literals with Markdown and
// line breaks escaped), because other people can write that text.
export type AnalysisForModel = {
  readonly state: AnalysisState;
  readonly range: { readonly start: string; readonly end: string };
  readonly calendars: readonly { readonly name: string; readonly ok: boolean | null }[];
  readonly failureCategory: string | null;
  readonly evidence: {
    readonly timezone: string;
    readonly preferredTimes: AnalysisEvidence["preferredTimes"];
    readonly meetingLoad: AnalysisEvidence["meetingLoad"];
    readonly noteLikeCount: number;
    readonly places: { readonly sampleSize: number };
    readonly durations: AnalysisEvidence["durations"];
    readonly trips: AnalysisEvidence["trips"] | null;
  } | null;
};

// The in-person place evidence for the location card. It is only a hint: the
// location is a host answer that a suggestion never fills.
export type PlaceHint = {
  readonly area: string | null;
  readonly venue: string | null;
  readonly sampleSize: number;
};
