import { describe, expect, it } from "vitest";
import { checkWindows, intentProblem, localPatchSchema, storedPatch } from "./request-reviews";

const at = (iso: string) => Date.parse(iso);

describe("storedPatch", () => {
  it("converts local windows in the zone with the date-specific offset", () => {
    const converted = storedPatch(
      { meetingLink: "https://meet.example.test/x", windows: [{ date: "2026-11-02", end: "11:00", start: "10:00" }] },
      "America/New_York",
    );

    expect(converted).toEqual({
      ok: true,
      patch: {
        linkPlan: { kind: "requester_link", url: "https://meet.example.test/x" },
        windows: [{ end: "2026-11-02T16:00:00.000Z", start: "2026-11-02T15:00:00.000Z" }],
      },
    });
  });

  it("converts preferred time windows without treating them as required availability", () => {
    const result = storedPatch({ preferredWindows: [{ date: "2026-11-09", start: "12:00", end: "18:00" }] }, "Asia/Seoul");
    expect(result).toEqual({ ok: true, patch: { preferredWindows: [{ start: "2026-11-09T03:00:00.000Z", end: "2026-11-09T09:00:00.000Z" }] } });
  });

  it("accepts a two-week preference without expanding it beyond the supported limit", () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${String(i + 2).padStart(2, "0")}`, start: "12:00", end: "18:00" }));
    expect(localPatchSchema.safeParse({ windows: days, preferredWindows: days }).success).toBe(true);
    const result = storedPatch({ preferredWindows: days }, "Asia/Seoul");
    expect(result.ok && result.patch.preferredWindows).toHaveLength(14);
  });

  it("accepts a recurring weekly preference for this request", () => {
    const weekly = [{ weekday: "monday" as const, start: "12:00", end: "18:00" }];
    expect(localPatchSchema.safeParse({ preferredWeeklyWindows: weekly }).success).toBe(true);
    expect(localPatchSchema.safeParse({ preferredWeeklyWindows: [{ weekday: "monday", start: "12:00", end: "12:00" }] }).success).toBe(false);
    expect(storedPatch({ preferredWeeklyWindows: weekly }, "Asia/Seoul")).toEqual({ ok: true, patch: { preferredWeeklyWindows: weekly } });
  });

  it("rejects a repeated or skipped local time instead of guessing", () => {
    expect(storedPatch({ windows: [{ date: "2026-11-01", end: "02:30", start: "01:30" }] }, "America/New_York")).toMatchObject({
      ok: false,
      problem: "ambiguous_local_time",
    });
    expect(storedPatch({ windows: [{ date: "2027-03-14", end: "04:00", start: "02:30" }] }, "America/New_York")).toMatchObject({
      ok: false,
      problem: "ambiguous_local_time",
    });
  });
});

describe("checkWindows", () => {
  const window = { end: "2026-11-02T11:00:00.000Z", start: "2026-11-02T10:00:00.000Z" };

  it("rejects a window that has begun even when its end is ahead", () => {
    expect(checkWindows({}, { windows: [window] }, at("2026-11-02T10:01:00Z"))).toBe("started_window");
    expect(checkWindows({}, { windows: [window] }, at("2026-11-02T09:59:00Z"))).toBeNull();
  });

  it("allows the remaining part of a whole local day, including when a review is applied later", () => {
    const day = { start: "2026-11-01T15:00:00.000Z", end: "2026-11-02T14:59:00.000Z" };
    expect(checkWindows({ timezone: "Asia/Seoul", durationMinutes: 30 }, { windows: [day] }, at("2026-11-02T01:00:00Z"))).toBeNull();
    expect(checkWindows({ timezone: "Asia/Seoul", durationMinutes: 30 }, { windows: [day] }, at("2026-11-02T14:45:00Z"))).toBe("too_short");
  });

  it("fits windows to the duration merged from the patch and the details", () => {
    const now = at("2026-11-01T00:00:00Z");
    expect(checkWindows({ durationMinutes: 90 }, { windows: [window] }, now)).toBe("too_short");
    expect(checkWindows({ durationMinutes: 30 }, { durationMinutes: 90, windows: [window] }, now)).toBe("too_short");
    expect(checkWindows({ durationMinutes: 30, windows: [window] }, { durationMinutes: 90 }, now)).toBe("too_short");
    expect(checkWindows({}, { windows: [window] }, now)).toBeNull();
  });
});

describe("intentProblem", () => {
  it("requires a patch for details and availability and none for question and unknown", () => {
    expect(intentProblem({ clarifications: [], intent: "details", patch: null })).toBe("empty_patch");
    expect(intentProblem({ clarifications: ["missing_date"], intent: "question", patch: { purpose: "x" } })).toBe("patch_on_question");
    expect(intentProblem({ clarifications: [], intent: "unknown", patch: null })).toBe("missing_clarification");
    expect(intentProblem({ clarifications: ["booked"], intent: "question", patch: null })).toBe("unsupported_clarification");
    expect(intentProblem({ clarifications: ["missing_time"], intent: "question", patch: null })).toBeNull();
  });
});
