import { describe, expect, it } from "vitest";
import { revisedFromOutcome, revisedFromText } from "./host-request";

// A revised request follows a declined, expired or withdrawn request, and /app
// names the earlier one and how it ended (guest-flow-completion design 5, #59).

describe("the revised request's origin", () => {
  it("keeps each closed state a revised request can follow", () => {
    expect(revisedFromOutcome("declined")).toBe("declined");
    expect(revisedFromOutcome("expired")).toBe("expired");
    expect(revisedFromOutcome("withdrawn")).toBe("withdrawn");
  });

  it("names no origin for any other state", () => {
    expect(revisedFromOutcome("booked")).toBeNull();
    expect(revisedFromOutcome("cancelled")).toBeNull();
    expect(revisedFromOutcome("negotiating")).toBeNull();
    expect(revisedFromOutcome(null)).toBeNull();
  });

  it("tells the host the guest withdrew the earlier request", () => {
    expect(revisedFromText({ outcome: "withdrawn", ref: "R-ABC123" })).toBe("Follows request R-ABC123, which the guest withdrew.");
  });

  it("tells the host they declined the earlier request or that it expired", () => {
    expect(revisedFromText({ outcome: "declined", ref: "R-ABC123" })).toBe("Follows request R-ABC123, which you declined.");
    expect(revisedFromText({ outcome: "expired", ref: "R-ABC123" })).toBe("Follows request R-ABC123, which expired.");
  });
});
