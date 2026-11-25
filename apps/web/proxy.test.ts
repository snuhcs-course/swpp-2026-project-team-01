import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("proxy matcher", () => {
  it("never sees the analytics relay", () => {
    const matcher = new RegExp(`^${config.matcher[0]!}$`);
    expect(matcher.test("/ingest/e/")).toBe(false);
    expect(matcher.test("/ingest/static/recorder.js")).toBe(false);
    expect(matcher.test("/privacy")).toBe(true);
    expect(matcher.test("/some-host")).toBe(true);
  });
});
