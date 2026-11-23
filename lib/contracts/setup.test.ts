import { describe, expect, it } from "vitest";
import { DEFAULT_MEETING_MINUTES, STARTER_DEFAULTS } from "./setup";

describe("default meeting length", () => {
  it("is 60 minutes, and the setup starter default uses the same constant", () => {
    expect(DEFAULT_MEETING_MINUTES).toBe(60);
    expect(STARTER_DEFAULTS.durationMinutes).toBe(DEFAULT_MEETING_MINUTES);
  });
});
