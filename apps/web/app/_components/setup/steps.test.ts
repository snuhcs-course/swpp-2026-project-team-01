import type { SetupFieldName } from "@lib/contracts/setup";
import { describe, expect, it } from "vitest";
import { firstOpenStep, setupSteps, stepAccepted, stepForField, stepIndex } from "./steps";

// The steps' order and where the open card lands: the first step the host has
// not accepted, skipping what was skipped, then the review.

type Fields = Parameters<typeof setupSteps>[0]["fields"];

function stateWith(
  accepted: readonly SetupFieldName[],
  options: { mode?: "online" | "in_person" | "either"; notes?: number; missing?: SetupFieldName[] } = {},
) {
  const fields = new Proxy({} as Record<string, unknown>, {
    get(_, field: string) {
      if (field === "meetingMode" && options.mode) return { proposed: { accepted: true, value: options.mode } };
      return { proposed: { accepted: accepted.includes(field as SetupFieldName), value: null } };
    },
  }) as unknown as Fields;
  const entries = Array.from({ length: options.notes ?? 0 }, (_, index) => ({ eventId: String(index) }));
  return {
    analysis: options.notes === undefined ? null : { evidence: { noteLike: { entries } }, state: "completed" },
    fields,
    missingFields: options.missing ?? [],
  } as unknown as Parameters<typeof setupSteps>[0];
}

describe("setup steps", () => {
  it("orders the online steps and leaves out notes without entries", () => {
    expect(setupSteps(stateWith([], { mode: "online" }))).toEqual(["timezone", "windows", "limit", "duration", "mode", "identity"]);
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
      "identity",
    ]);
    expect(setupSteps(stateWith([], { notes: 0 }))).not.toContain("notes");
  });

  it("starts at the first unaccepted step and ends at the review", () => {
    expect(firstOpenStep(stateWith([]), new Set())).toBe("timezone");
    expect(firstOpenStep(stateWith(["timezone", "weeklyWindows"]), new Set())).toBe("limit");
    const all: SetupFieldName[] = [
      "timezone",
      "weeklyWindows",
      "weeklyLimit",
      "durationMinutes",
      "bufferBeforeMinutes",
      "bufferAfterMinutes",
      "meetingMode",
      "displayName",
      "handle",
    ];
    expect(firstOpenStep(stateWith(all, { mode: "online" }), new Set())).toBe("review");
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
