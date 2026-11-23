import { describe, expect, it } from "vitest";
import { DEFAULT_MEETING_MINUTES, SETUP_FIELD_SCHEMAS, STARTER_DEFAULTS } from "./setup";

describe("default meeting length", () => {
  it("is 60 minutes, and the setup starter default uses the same constant", () => {
    expect(DEFAULT_MEETING_MINUTES).toBe(60);
    expect(STARTER_DEFAULTS.durationMinutes).toBe(DEFAULT_MEETING_MINUTES);
  });
});

// The setup field bounds the messenger and MCP setup tools check before a
// value is drafted (testing baseline rows in the module test map).

describe("setup field bounds", () => {
  // H02 M-3: "Length outside 15–240 or not a multiple of 5 → refused".
  it("takes a meeting length of 15 to 240 minutes in steps of 5", () => {
    const length = SETUP_FIELD_SCHEMAS.durationMinutes;

    for (const minutes of [15, 45, 240]) expect(length.safeParse(minutes).success).toBe(true);
    for (const minutes of [10, 14, 42, 245, 30.5]) expect(length.safeParse(minutes).success).toBe(false);
  });

  // H02 M-4 and H03 M-8.2: "At most N meetings a week", outside 1–50 refused;
  // the field may also be left empty for no limit (H02 W-3).
  it("takes a weekly limit of 1 to 50 meetings, or none", () => {
    const limit = SETUP_FIELD_SCHEMAS.weeklyLimit;

    for (const value of [1, 5, 50, null]) expect(limit.safeParse(value).success).toBe(true);
    for (const value of [0, 51, 2.5]) expect(limit.safeParse(value).success).toBe(false);
  });

  // H01 M-6.2 and H02 M-2.1: hours differ by weekday and repeat every week.
  it("keeps a different window per weekday", () => {
    const windows = [
      { end: "18:00", start: "10:00", weekday: "monday" },
      { end: "20:00", start: "13:00", weekday: "tuesday" },
      { end: "18:00", start: "10:00", weekday: "wednesday" },
      { end: "20:00", start: "13:00", weekday: "thursday" },
      { end: "18:00", start: "10:00", weekday: "friday" },
    ];

    expect(SETUP_FIELD_SCHEMAS.weeklyWindows.parse(windows)).toEqual(windows);
    expect(SETUP_FIELD_SCHEMAS.weeklyWindows.safeParse([]).success).toBe(false);
    expect(SETUP_FIELD_SCHEMAS.weeklyWindows.safeParse([{ end: "10:00", start: "10:00", weekday: "monday" }]).success).toBe(false);
  });
});
