import { describe, expect, it } from "vitest";
import { PERMISSION_REASONS } from "./permission-reasons";

// Issue #203: every ask carries one line that says why and how far it reaches.
describe("permission reasons", () => {
  it("has one line per ask in both chat languages", () => {
    expect(Object.keys(PERMISSION_REASONS.ko).sort()).toEqual(Object.keys(PERMISSION_REASONS.en).sort());
    for (const language of ["en", "ko"] as const) {
      for (const line of Object.values(PERMISSION_REASONS[language])) {
        expect(line).not.toContain("\n");
        expect(line.length).toBeLessThanOrEqual(160);
      }
    }
  });

  it("names the scope of each ask, not only the reason", () => {
    const en = PERMISSION_REASONS.en;
    expect(en.googleSignIn).toMatch(/reads your calendars/);
    expect(en.googleSignIn).toMatch(/adds only the meetings you approve/);
    expect(en.calendarRoles).toMatch(/only the calendars you choose/);
    expect(en.calendarRoles).toMatch(/only to the one you pick/);
    expect(en.noteReview).toMatch(/Only the entries you check/);
    expect(en.noteReview).toMatch(/nothing is deleted/);
  });
});
