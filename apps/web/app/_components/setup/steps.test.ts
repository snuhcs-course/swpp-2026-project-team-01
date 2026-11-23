import type { SetupFieldName } from "@lib/contracts/setup";
import { describe, expect, it } from "vitest";
import { SETUP_STEP_NAMES } from "@lib/contracts/setup-progress";
import { firstOpenStep, setupSteps, STEP_LABELS, stepAccepted, stepForField, stepIndex } from "./steps";

// The steps' order and where the open card lands: the first step the host has
// not accepted, skipping what was skipped, then the review.

type Fields = Parameters<typeof setupSteps>[0]["fields"];

function stateWith(
  accepted: readonly SetupFieldName[],
  options: {
    mode?: "online" | "in_person" | "either";
    notes?: number;
    missing?: SetupFieldName[];
    location?: { kind: "places"; areas: string[]; venue: null } | { kind: "decide_per_meeting" };
    // The notes for Thyme; answered with none unless a test says otherwise.
    assistantNotes?: { text: string; updatedAt: string } | null;
  } = {},
) {
  const fields = new Proxy({} as Record<string, unknown>, {
    get(_, field: string) {
      if (field === "meetingMode" && options.mode) return { proposed: { accepted: true, value: options.mode } };
      if (field === "location" && options.location) return { proposed: { accepted: true, value: options.location } };
      return { proposed: { accepted: accepted.includes(field as SetupFieldName), value: null } };
    },
  }) as unknown as Fields;
  const entries = Array.from({ length: options.notes ?? 0 }, (_, index) => ({ eventId: String(index) }));
  return {
    analysis: options.notes === undefined ? null : { evidence: { noteLike: { entries } }, state: "completed" },
    assistantNotes: options.assistantNotes === undefined ? { text: "", updatedAt: "2026-11-23T00:00:00.000Z" } : options.assistantNotes,
    fields,
    missingFields: options.missing ?? [],
  } as unknown as Parameters<typeof setupSteps>[0];
}

describe("setup steps", () => {
  it("orders the online steps and leaves out notes without entries", () => {
    expect(setupSteps(stateWith([], { mode: "online" }))).toEqual(["timezone", "windows", "limit", "duration", "mode", "identity", "assistantNotes"]);
  });

  it("adds the note step only when the scan found entries, and the in-person steps for in person or either", () => {
    expect(setupSteps(stateWith([], { mode: "either", notes: 2 }))).toEqual([
      "timezone",
      "windows",
      "limit",
      "duration",
      "notes",
      "mode",
      "location",
      "transport",
      "travelBuffer",
      "trips",
      "identity",
      "assistantNotes",
    ]);
    expect(setupSteps(stateWith([], { notes: 0 }))).not.toContain("notes");
  });

  it("asks about grouping trips only for in-person places, not a place decided per meeting", () => {
    const places = { areas: ["Yeoksam"], kind: "places" as const, venue: null };
    expect(setupSteps(stateWith([], { location: places, mode: "in_person" }))).toContain("trips");
    expect(setupSteps(stateWith([], { location: { kind: "decide_per_meeting" }, mode: "either" }))).not.toContain("trips");
    expect(setupSteps(stateWith([], { location: places, mode: "online" }))).not.toContain("trips");
    expect(stepForField("groupTrips")).toBe("trips");
  });

  it("starts at the first unaccepted step and ends at the review", () => {
    expect(firstOpenStep(stateWith([]), new Set())).toBe("timezone");
    expect(firstOpenStep(stateWith(["timezone", "weeklyWindows"]), new Set())).toBe("limit");
    const all: SetupFieldName[] = [
      "timezone",
      "weeklyWindows",
      "weeklyLimit",
      "weeklyLimitCounts",
      "durationMinutes",
      "bufferBeforeMinutes",
      "bufferAfterMinutes",
      "meetingMode",
      "displayName",
      "handle",
    ];
    expect(firstOpenStep(stateWith(all, { mode: "online" }), new Set())).toBe("review");
  });

  it("asks for the notes for Thyme last, until the host saves notes or none", () => {
    const all: SetupFieldName[] = ["timezone", "weeklyWindows", "weeklyLimit", "weeklyLimitCounts", "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "meetingMode", "displayName", "handle"];
    expect(firstOpenStep(stateWith(all, { assistantNotes: null, mode: "online" }), new Set())).toBe("assistantNotes");
    expect(firstOpenStep(stateWith(all, { assistantNotes: null, mode: "online" }), new Set(["assistantNotes"]))).toBe("review");
    expect(stepAccepted(stateWith([], { assistantNotes: { text: "A first meeting is online.", updatedAt: "2026-11-23T00:00:00.000Z" } }), "assistantNotes")).toBe(true);
    expect(stepAccepted(stateWith([], { assistantNotes: null }), "assistantNotes")).toBe(false);
  });

  it("needs every value of a group, and an available handle for identity", () => {
    expect(stepAccepted(stateWith(["durationMinutes", "bufferBeforeMinutes"]), "duration")).toBe(false);
    expect(stepAccepted(stateWith(["displayName", "handle"]), "identity")).toBe(true);
    expect(stepAccepted(stateWith(["displayName", "handle"], { missing: ["handle"] }), "identity")).toBe(false);
  });

  it("passes over skipped steps but keeps them in the list", () => {
    const state = stateWith(["timezone"], { mode: "online" });
    expect(firstOpenStep(state, new Set(["windows", "limit"]))).toBe("duration");
    expect(setupSteps(state)).toContain("windows");
  });

  it("places the review after the last step", () => {
    const steps = setupSteps(stateWith([], { mode: "online" }));
    expect(stepIndex(steps, "timezone")).toBe(0);
    expect(stepIndex(steps, "review")).toBe(steps.length);
  });

  it("maps every field to the step that edits it", () => {
    expect(stepForField("bufferAfterMinutes")).toBe("duration");
    expect(stepForField("handle")).toBe("identity");
    expect(stepForField("travelBufferMinutes")).toBe("travelBuffer");
  });
});

// The web names its steps as the chat setup does where they are the same step
// (issue #368), so both surfaces read alike.
describe("step names", () => {
  it("uses the chat setup's names for meeting hours and where the host meets", () => {
    expect(STEP_LABELS.windows).toBe(SETUP_STEP_NAMES.en.hours);
    expect(STEP_LABELS.location).toBe(SETUP_STEP_NAMES.en.place);
  });
});
