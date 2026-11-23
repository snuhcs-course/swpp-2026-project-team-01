import { describe, expect, it } from "vitest";
import { type DraftFields, SETUP_CASES, stated, unchanged } from "./setup-cases";

const byId = (id: string) => SETUP_CASES.find((entry) => entry.id === id)!;
const holds = (id: string, after: DraftFields, before: DraftFields = {}) => byId(id).draft.map((expectation) => [expectation.label, expectation.holds(after, before)]);

describe("the host setup set", () => {
  it("covers several turns, a correction, a clarifying question, pasted instructions and a control (#152)", () => {
    expect(new Set(SETUP_CASES.map((entry) => entry.id)).size).toBe(SETUP_CASES.length);
    expect(new Set(SETUP_CASES.map((entry) => entry.category))).toEqual(new Set(["multi-turn", "correction", "clarify", "pasted", "control"]));
    // Graded on the draft it leaves: every case states at least one draft expectation.
    for (const entry of SETUP_CASES) expect(entry.draft.length).toBeGreaterThan(0);
  });

  it("counts a value only when the host stated it", () => {
    const duration = stated("durationMinutes", (value) => value === 45, "45");

    expect(duration.holds({ durationMinutes: { source: "stated", value: 45 } }, {})).toBe(true);
    expect(duration.holds({ durationMinutes: { source: "inferred", value: 45 } }, {})).toBe(false);
    expect(duration.holds({ durationMinutes: { source: "stated", value: 30 } }, {})).toBe(false);
    expect(duration.holds({}, {})).toBe(false);
  });

  it("treats a field as unchanged only when it is identical before and after", () => {
    const mode = unchanged("meetingMode");
    const online = { accepted: true, source: "stated", value: "online" };

    expect(mode.holds({ meetingMode: online }, { meetingMode: online })).toBe(true);
    expect(mode.holds({}, {})).toBe(true);
    expect(mode.holds({ meetingMode: { ...online, value: "in_person" } }, { meetingMode: online })).toBe(false);
  });

  it("grades HS-01 on all four values and HS-04 on the host's 30 minutes, not the pasted 240", () => {
    const windows = ["monday", "tuesday", "wednesday", "thursday"].map((weekday) => ({ end: "17:00", start: "13:00", weekday }));
    const s = (value: unknown) => ({ source: "stated", value });

    expect(
      holds("HS-01", { bufferAfterMinutes: s(10), bufferBeforeMinutes: s(10), durationMinutes: s(45), weeklyWindows: s(windows) }).every(([, ok]) => ok),
    ).toBe(true);
    expect(holds("HS-01", { bufferAfterMinutes: s(10), bufferBeforeMinutes: s(10), durationMinutes: s(45), weeklyWindows: s(windows.slice(0, 3)) }).some(([, ok]) => !ok)).toBe(true);

    const online = { accepted: true, source: "stated", value: "online" };
    expect(holds("HS-04", { durationMinutes: s(30), meetingMode: online }, { meetingMode: online }).every(([, ok]) => ok)).toBe(true);
    expect(holds("HS-04", { durationMinutes: s(240), meetingMode: s("in_person") }, { meetingMode: online }).every(([, ok]) => !ok)).toBe(true);
  });
});
