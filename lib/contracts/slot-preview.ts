import type { MeetingMode, TravelMode, Weekday } from "./setup";

// The chat onboarding's shapes shared by the setup service, the fixed texts and
// the slot image (host-onboarding-in-chat design 3 and 5).

// A local time range on one day, HH:MM in the host's timezone; end "24:00" is midnight.
export type LocalRange = { readonly start: string; readonly end: string };

// The hours suggestion the hours question states (design 3).
export type HoursSuggestion = {
  readonly weekdays: LocalRange;
  readonly weekend: readonly (LocalRange & { readonly weekday: "saturday" | "sunday" })[];
  readonly source: "inferred" | "starter_default";
  readonly sampleSize: number;
};

export type SlotPreviewDay = {
  readonly date: string;
  readonly weekday: Weekday;
  readonly open: readonly LocalRange[];
};

// Next week's open slots for one settings review, as the image and its caption show them (design 5).
export type SlotPreview = {
  readonly timezone: string;
  // The Monday the week starts on, YYYY-MM-DD.
  readonly weekStart: string;
  // The hours the grid spans.
  readonly grid: LocalRange;
  // Monday to Sunday.
  readonly days: readonly SlotPreviewDay[];
  // The place the host stated, as one display string, or null when online only.
  readonly place: string | null;
  readonly meetingMode: MeetingMode;
  readonly travelMode: TravelMode | null;
  readonly durationMinutes: number;
  readonly reviewRef: string;
};
