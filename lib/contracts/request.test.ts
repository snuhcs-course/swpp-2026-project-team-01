import { describe, expect, it } from "vitest";
import {
  ACTIONABLE_REQUEST_STATES,
  CLOSED_REQUEST_STATES,
  isActionableRequestState,
  isClarificationCategory,
  isClosedRequestState,
  REQUEST_STATES,
} from "./request";

describe("request states", () => {
  it("closes withdrawn, expired, booked and declined requests only", () => {
    expect(REQUEST_STATES.filter(isClosedRequestState)).toEqual(["booked", "declined", "withdrawn", "expired"]);
  });

  it("lets withdrawal and expiry close gathering, negotiating and awaiting approval", () => {
    expect(REQUEST_STATES.filter(isActionableRequestState)).toEqual([
      "gathering",
      "negotiating",
      "awaiting_host_approval",
    ]);
  });

  it("treats booking as neither actionable nor closed", () => {
    expect(isActionableRequestState("booking")).toBe(false);
    expect(isClosedRequestState("booking")).toBe(false);
    expect([...ACTIONABLE_REQUEST_STATES, ...CLOSED_REQUEST_STATES]).not.toContain("booking");
  });
});

describe("clarification categories", () => {
  it("accepts an authored category and rejects anything else", () => {
    expect(isClarificationCategory("ambiguous_local_time")).toBe(true);
    expect(isClarificationCategory("missing_weather")).toBe(false);
  });
});
