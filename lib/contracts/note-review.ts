// The note review (calendar-note-review design 7): what the host's review page
// shows. It is built on the server from the latest scan, the calendar roles and
// the host's decisions; the browser sends back only item keys and choices, so it
// can decide nothing the review did not show. The page draws one week at a time
// like Google Calendar: the candidates in yellow and, for context, the host's
// other busy entries of that week in grey, read live from Google.

export type NoteVerdict = "note" | "event" | "unsure";
export type NoteScope = "series" | "occurrence";
export type NoteWritebackState = "pending" | "done" | "failed" | "not_writable";

export type NoteOccurrence = {
  // Opaque to the browser: names the occurrence in a "this time only" choice.
  readonly id: string;
  readonly start: string;
  readonly end: string | null;
  readonly allDay: boolean;
};

export type NoteReviewItem = {
  // Opaque to the browser: names the item in a confirmation.
  readonly key: string;
  readonly title: string;
  readonly calendarName: string;
  // The occurrence shown first: the next one of a series.
  readonly start: string;
  readonly end: string | null;
  readonly allDay: boolean;
  // A series, shown on every listed occurrence, with the scope choice.
  readonly repeats: boolean;
  // Every listed occurrence still ahead (one for an entry that does not repeat).
  readonly occurrences: readonly NoteOccurrence[];
  readonly verdict: NoteVerdict | null;
  readonly reason: string | null;
  // False for a subscribed or read-only calendar: freeing it changes only Find
  // Me a Time (design 6). The page shows no words about it.
  readonly writable: boolean;
  // The host's standing answer about this entry, when there is one, so the week
  // can be changed after Confirm: checked for free, unchecked for keep busy.
  readonly decision: "free" | "keep_busy" | null;
};

export type NoteReviewDecision = {
  readonly id: string;
  // From the latest scan when it still lists the entry, so a decision stores no title.
  readonly title: string | null;
  // The entry's time from the same scan (for a series, its next occurrence).
  readonly start: string | null;
  readonly end: string | null;
  readonly allDay: boolean;
  readonly calendarName: string;
  readonly decision: "free" | "keep_busy";
  readonly scope: NoteScope;
  readonly writebackState: NoteWritebackState | null;
  readonly writebackFailure: string | null;
  readonly updatedAt: string;
};

// A busy entry of the shown week that is not a candidate, drawn for context. Its
// title reaches only the signed-in host; no attendee is ever part of it.
export type NoteWeekEvent = {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
};

export type NoteWeek = {
  // The Monday that starts the week, in the host timezone.
  readonly start: string;
  readonly timezone: string;
  readonly today: string;
  // The neighbouring weeks inside the scan's range ahead, or null.
  readonly previous: string | null;
  readonly next: string | null;
  readonly events: readonly NoteWeekEvent[];
  // Google could not be read: only the candidates are drawn.
  readonly contextUnavailable: boolean;
};

export type NoteReview = {
  // pending: a scan is running; unavailable: no completed scan to review.
  readonly state: "ready" | "pending" | "unavailable";
  // The scan the items come from; a confirmation names it.
  readonly analysisId: string | null;
  readonly items: readonly NoteReviewItem[];
  readonly decisions: readonly NoteReviewDecision[];
  // The week the page asked for, when the review is ready.
  readonly week: NoteWeek | null;
};

export type NoteReviewChoice = {
  readonly key: string;
  readonly decision: "free" | "keep_busy";
  readonly scope?: NoteScope;
  // For scope "occurrence": which occurrence; the first one ahead when absent.
  readonly occurrence?: string;
};
