import { describe, expect, it } from "vitest";
import { STARTER_DEFAULTS, type ConfirmedSettings, type DraftFields } from "../contracts/setup";
import {
  buildFieldViews,
  buildSuggestions,
  deriveNextAction,
  differsFromConfirmed,
  missingFields,
  type NextActionInput,
  proposalHash,
  proposedOf,
  type ProposedFields,
} from "./setup";

const base: NextActionInput = {
  analysisPending: false,
  analysisSkipped: false,
  calendarConnected: true,
  hasRoles: true,
  missingCount: 0,
  ready: false,
};

describe("deriveNextAction", () => {
  it.each<[string, Partial<NextActionInput>, string]>([
    ["no Calendar grant", { calendarConnected: false, hasRoles: false }, "connect_calendar"],
    ["an invalid grant after roles were saved", { calendarConnected: false }, "connect_calendar"],
    ["no saved roles", { hasRoles: false }, "choose_calendars"],
    ["a pending scan", { analysisPending: true, missingCount: 3 }, "analyzing"],
    ["a pending scan the host skipped", { analysisPending: true, analysisSkipped: true, missingCount: 3 }, "review_suggestions"],
    ["missing values", { missingCount: 1 }, "review_suggestions"],
    ["every value present", {}, "confirm_settings"],
    ["readiness, even with draft edits pending", { missingCount: 2, ready: true }, "ready"],
  ])("derives the step for %s", (_name, input, expected) => {
    expect(deriveNextAction({ ...base, ...input })).toBe(expected);
  });
});

function proposal(overrides: Partial<Record<string, unknown>> = {}): ProposedFields {
  const entry = (value: unknown, source: "stated" | "inferred" | "starter_default" = "starter_default", accepted = false) => ({
    accepted,
    reason: null,
    sampleSize: null,
    source,
    value,
  });

  return {
    bufferAfterMinutes: entry(10),
    bufferBeforeMinutes: entry(10),
    displayName: entry("Alice Kim", "inferred"),
    durationMinutes: entry(30),
    handle: entry("alice"),
    noteExclusions: entry([]),
    timezone: entry("Asia/Seoul"),
    travelBufferMinutes: entry(15),
    weeklyLimit: entry(null),
    weeklyWindows: entry(STARTER_DEFAULTS.weeklyWindows),
    ...overrides,
  } as ProposedFields;
}

const stated = (value: unknown) => ({ accepted: false, reason: null, sampleSize: null, source: "stated" as const, value });
const accepted = (value: unknown) => ({ accepted: true, reason: null, sampleSize: null, source: "inferred" as const, value });

describe("missingFields", () => {
  it("requires the host's own mode answer", () => {
    expect(missingFields(proposal(), true)).toEqual(["meetingMode"]);
    // A suggested, unaccepted mode is not an answer.
    expect(
      missingFields(proposal({ meetingMode: { ...accepted("online"), accepted: false } }), true),
    ).toEqual(["meetingMode"]);
    expect(missingFields(proposal({ meetingMode: stated("online") }), true)).toEqual([]);
    expect(missingFields(proposal({ meetingMode: accepted("online") }), true)).toEqual([]);
  });

  it("skips location and transport for an online-only host", () => {
    expect(missingFields(proposal({ meetingMode: stated("online"), travelBufferMinutes: null }), true)).toEqual([]);
  });

  it("requires location and transport answers in person or either", () => {
    expect(missingFields(proposal({ meetingMode: stated("either") }), true)).toEqual(["location", "travelMode"]);
    expect(
      missingFields(
        proposal({
          location: { ...accepted({ kind: "decide_per_meeting" }), accepted: false },
          meetingMode: stated("in_person"),
          travelMode: stated("transit"),
        }),
        true,
      ),
    ).toEqual(["location"]);
    expect(
      missingFields(
        proposal({
          location: stated({ kind: "decide_per_meeting" }),
          meetingMode: stated("in_person"),
          travelBufferMinutes: null,
          travelMode: stated("depends"),
        }),
        true,
      ),
    ).toEqual(["travelBufferMinutes"]);
  });

  it("counts invalid values and an unavailable handle as missing", () => {
    expect(
      missingFields(
        proposal({ meetingMode: stated("online"), weeklyWindows: stated([{ end: "09:00", start: "09:00", weekday: "monday" }]) }),
        true,
      ),
    ).toEqual(["weeklyWindows"]);
    expect(missingFields(proposal({ meetingMode: stated("online") }), false)).toEqual(["handle"]);
  });
});

describe("proposalHash", () => {
  const roles = {
    bookingCalendar: { accessRole: "owner", id: "primary@example.test", summary: "Me" },
    conflictCalendars: [{ accessRole: "owner", id: "primary@example.test", summary: "Me" }],
  };

  it("is stable across key order and ignores labels' evidence text", () => {
    const one = proposal({ meetingMode: stated("online") });
    const reordered = Object.fromEntries(Object.entries(one).reverse()) as ProposedFields;
    const otherReason = { ...one, durationMinutes: { ...one.durationMinutes!, reason: "Another reason." } } as ProposedFields;

    expect(proposalHash(reordered, roles)).toBe(proposalHash(one, roles));
    expect(proposalHash(otherReason, roles)).toBe(proposalHash(one, roles));
  });

  it("changes with a value, a source, the roles, or fields the mode saves", () => {
    const one = proposal({ meetingMode: stated("online") });
    const hash = proposalHash(one, roles);

    expect(proposalHash({ ...one, durationMinutes: stated(45) } as ProposedFields, roles)).not.toBe(hash);
    expect(proposalHash({ ...one, durationMinutes: stated(30) } as ProposedFields, roles)).not.toBe(hash);
    expect(proposalHash(one, { ...roles, bookingCalendar: { ...roles.bookingCalendar, id: "other" } })).not.toBe(hash);
    expect(proposalHash(one, null)).not.toBe(hash);
    // An online-only proposal does not save the travel buffer, so changing it is no change.
    expect(proposalHash({ ...one, travelBufferMinutes: stated(30) } as ProposedFields, roles)).toBe(hash);
  });
});

describe("suggestions and field precedence", () => {
  it("labels starter defaults and the browser zone, and suggests no host answers", () => {
    const suggestions = buildSuggestions({
      browserTimeZone: "Asia/Seoul",
      email: "alice.kim@example.test",
      evidenceSuggestions: null,
      profileName: null,
      proposedHandle: "alice-kim",
    });

    expect(suggestions.timezone).toEqual({
      reason: "From this browser.",
      sampleSize: null,
      source: "starter_default",
      value: "Asia/Seoul",
    });
    expect(suggestions.durationMinutes).toMatchObject({ source: "starter_default", value: 30 });
    expect(suggestions.displayName).toMatchObject({ source: "starter_default", value: "alice.kim" });
    expect(suggestions.handle).toMatchObject({ source: "starter_default", value: "alice-kim" });
    expect(suggestions.meetingMode).toBeUndefined();
    expect(suggestions.location).toBeUndefined();
    expect(suggestions.travelMode).toBeUndefined();
  });

  it("falls back to UTC only without a calendar or browser zone, and infers the profile name", () => {
    const suggestions = buildSuggestions({
      browserTimeZone: "Not/AZone",
      email: null,
      evidenceSuggestions: null,
      profileName: "Alice Kim",
      proposedHandle: null,
    });

    expect(suggestions.timezone).toMatchObject({ source: "starter_default", value: "UTC" });
    expect(suggestions.displayName).toMatchObject({ source: "inferred", value: "Alice Kim" });
    expect(suggestions.handle).toBeUndefined();
  });

  it("keeps a drafted value over a newer suggestion", () => {
    const draft: DraftFields = { durationMinutes: { accepted: true, source: "inferred", value: 45 } };
    const views = buildFieldViews(draft, null, { durationMinutes: { reason: "Median.", sampleSize: 12, source: "inferred", value: 30 } });

    expect(views.durationMinutes.proposed).toMatchObject({ accepted: true, value: 45 });
    expect(views.durationMinutes.suggestion).toMatchObject({ value: 30 });
  });

  it("proposes a ready host's confirmed values, so an untouched draft has no pending change", () => {
    const settings = {
      bookingCalendar: { accessRole: "owner", id: "cal", summary: "Me", verifiedAt: "2026-10-19T00:00:00.000Z" },
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 10,
      conflictCalendars: [{ accessRole: "owner", id: "cal", summary: "Me" }],
      displayName: "Alice",
      durationMinutes: 30,
      handle: "alice",
      location: null,
      meetingMode: "online",
      noteExclusions: [],
      provenance: { meetingMode: "stated" },
      timezone: "Asia/Seoul",
      travelBufferMinutes: null,
      travelMode: null,
      weeklyLimit: null,
      weeklyWindows: STARTER_DEFAULTS.weeklyWindows,
    } satisfies ConfirmedSettings;
    const roles = { bookingCalendar: settings.bookingCalendar, conflictCalendars: [...settings.conflictCalendars] };
    const suggestions = { durationMinutes: { reason: "Median.", sampleSize: 12, source: "inferred" as const, value: 60 } };
    const untouched = proposedOf(buildFieldViews({}, settings, suggestions));
    const edited = proposedOf(
      buildFieldViews({ durationMinutes: { accepted: true, source: "stated", value: 45 } }, settings, suggestions),
    );

    expect(untouched.durationMinutes).toMatchObject({ accepted: true, value: 30 });
    expect(differsFromConfirmed(untouched, roles, settings)).toBe(false);
    expect(differsFromConfirmed(edited, roles, settings)).toBe(true);
    expect(differsFromConfirmed(untouched, { ...roles, bookingCalendar: { ...roles.bookingCalendar, id: "new" } }, settings)).toBe(true);
  });
});
