import { z } from "zod";

// The host setup contract shared by the setup domain module, the setup tools,
// the /api/setup routes and the cards (host-setup capability). A draft holds one
// entry per field; confirmation copies accepted values into the confirmed policy.

export const VALUE_SOURCES = ["stated", "inferred", "starter_default"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

export const VALUE_SOURCE_LABELS: Readonly<Record<ValueSource, string>> = {
  stated: "Stated",
  inferred: "Inferred",
  starter_default: "Starter default",
};

// Fewer counted meetings than this and an inference falls back to the starter default.
export const MIN_INFERENCE_SAMPLE = 5;

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const clockSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:MM time.");

// A weekly availability window starts on its weekday in the host timezone. An end
// earlier than the start is on the following local date; equal clocks are invalid
// (meeting-feasibility: overnight weekly host hours).
export const weeklyWindowSchema = z
  .object({ weekday: z.enum(WEEKDAYS), start: clockSchema, end: clockSchema })
  .refine((window) => window.start !== window.end, { message: "A window cannot start and end at the same time." });

export type WeeklyWindow = z.infer<typeof weeklyWindowSchema>;

export function endsNextDay(window: Pick<WeeklyWindow, "start" | "end">) {
  return window.end < window.start;
}

export const MEETING_MODES = ["online", "in_person", "either"] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

// Google Routes DRIVE, TRANSIT and WALK, plus a per-trip choice.
export const TRAVEL_MODES = ["driving", "transit", "walking", "depends"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

export const TRAVEL_MODE_LABELS: Readonly<Record<TravelMode, string>> = {
  driving: "Driving",
  transit: "Public transit",
  walking: "Walking",
  depends: "Depends on the trip",
};

export const locationAnswerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("places"),
    areas: z.array(z.string().trim().min(1).max(100)).max(5),
    venue: z.string().trim().min(1).max(200).nullable(),
  }).refine((answer) => answer.areas.length > 0 || answer.venue !== null, {
    message: "Name at least one area or a venue, or choose Decide per meeting.",
  }),
  z.object({ kind: z.literal("decide_per_meeting") }),
]);

export type LocationAnswer = z.infer<typeof locationAnswerSchema>;

export const noteExclusionSchema = z.object({
  calendarId: z.string().min(1).max(1024),
  eventId: z.string().min(1).max(1024),
  // The provider's updated time when the host confirmed it; a different value
  // later means the entry needs re-checking.
  fingerprint: z.string().max(100),
});

export function isValidTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone.length > 0 && zone.length <= 64;
  } catch {
    return false;
  }
}

// Strips control characters; the public documents escape the rest.
export const displayNameSchema = z
  .string()
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  .transform((value) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim())
  .pipe(z.string().min(1).max(80));

export const SETUP_FIELD_SCHEMAS = {
  timezone: z.string().refine(isValidTimeZone, "Choose an IANA timezone such as Asia/Seoul."),
  weeklyWindows: z.array(weeklyWindowSchema).min(1).max(21),
  weeklyLimit: z.number().int().min(1).max(50).nullable(),
  noteExclusions: z.array(noteExclusionSchema).max(200),
  durationMinutes: z.number().int().min(15).max(240).multipleOf(5),
  bufferBeforeMinutes: z.number().int().min(0).max(120),
  bufferAfterMinutes: z.number().int().min(0).max(120),
  meetingMode: z.enum(MEETING_MODES),
  location: locationAnswerSchema,
  travelMode: z.enum(TRAVEL_MODES),
  travelBufferMinutes: z.number().int().min(0).max(180),
  displayName: displayNameSchema,
  handle: z.string().trim().toLowerCase().min(1).max(64),
} as const;

export type SetupFieldName = keyof typeof SETUP_FIELD_SCHEMAS;
export const SETUP_FIELD_NAMES = Object.keys(SETUP_FIELD_SCHEMAS) as SetupFieldName[];
export type SetupFieldValue<F extends SetupFieldName> = z.output<(typeof SETUP_FIELD_SCHEMAS)[F]>;

// Fields answered only by the host: a suggestion or a model inference never counts.
export const HOST_ANSWER_FIELDS: readonly SetupFieldName[] = ["meetingMode", "location", "travelMode"];

export const IN_PERSON_FIELDS: readonly SetupFieldName[] = ["location", "travelMode", "travelBufferMinutes"];

export const OPTIONAL_FIELDS: readonly SetupFieldName[] = ["weeklyLimit", "noteExclusions"];

export type DraftEntry<F extends SetupFieldName = SetupFieldName> = {
  readonly value: SetupFieldValue<F>;
  readonly source: ValueSource;
  // The host chose this value (Use this, Adjust, Choose my own, or stated it).
  readonly accepted: boolean;
  readonly sampleSize?: number | null;
  readonly reason?: string | null;
};

export type DraftFields = { readonly [F in SetupFieldName]?: DraftEntry<F> };

export const STARTER_DEFAULTS = {
  weeklyWindows: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({
    weekday,
    start: "10:00",
    end: "17:00",
  })),
  weeklyLimit: null,
  noteExclusions: [],
  durationMinutes: 30,
  bufferBeforeMinutes: 10,
  bufferAfterMinutes: 10,
  travelBufferMinutes: 15,
} satisfies { readonly [F in SetupFieldName]?: SetupFieldValue<F> };

// The fields a host must have accepted before confirmation, given the mode.
export function requiredFields(mode: MeetingMode | undefined): SetupFieldName[] {
  const base: SetupFieldName[] = [
    "timezone",
    "weeklyWindows",
    "durationMinutes",
    "bufferBeforeMinutes",
    "bufferAfterMinutes",
    "meetingMode",
    "displayName",
    "handle",
  ];

  return mode === "in_person" || mode === "either" ? [...base, ...IN_PERSON_FIELDS] : base;
}

export const SETUP_NEXT_ACTIONS = [
  "connect_calendar",
  "choose_calendars",
  "analyzing",
  "review_suggestions",
  "confirm_settings",
  "ready",
] as const;
export type SetupNextAction = (typeof SETUP_NEXT_ACTIONS)[number];

export const SETUP_OPERATIONS = [
  "setup.save_calendar_roles",
  "setup.analyze_again",
  "setup.set_up_manually",
  "setup.update_draft",
  "setup.confirm_settings",
] as const;
export type SetupOperation = (typeof SETUP_OPERATIONS)[number];
