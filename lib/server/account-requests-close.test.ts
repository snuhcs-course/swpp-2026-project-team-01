import { describe, expect, it } from "vitest";
import type { RequestState } from "../contracts/request";
import { createAccountRequestsCloseHandler, type SentRequestFacts, sentRequestClosing } from "./account-requests-close";
import type { ClaimedJob } from "./jobs";
import type { Transaction } from "./database";

// What closing a deleted guest account's sent request does
// (guest-account-history D3); the database paths are in
// tests/integration/guest-account-history.test.ts.

const facts = (state: RequestState, overrides: Partial<SentRequestFacts> = {}): SentRequestFacts => ({
  expired: false,
  meetingAhead: false,
  standingBooking: false,
  state,
  ...overrides,
});

describe("sentRequestClosing", () => {
  it.each(["gathering", "negotiating", "awaiting_host_approval"] as const)("withdraws an open %s request", (state) => {
    expect(sentRequestClosing(facts(state))).toBe("withdraw");
  });

  it("cancels a reserved booking and withdraws a request still booking", () => {
    expect(sentRequestClosing(facts("booking"))).toBe("withdraw_booking");
    expect(sentRequestClosing(facts("booking", { expired: true }))).toBe("withdraw_booking");
  });

  it("cancels a booked meeting still to come and leaves one that started", () => {
    expect(sentRequestClosing(facts("booked", { meetingAhead: true, standingBooking: true }))).toBe("cancel_meeting");
    expect(sentRequestClosing(facts("booked", { standingBooking: true }))).toBe("leave");
  });

  it("cancels the meeting a change is open on, or drops the change once the meeting started", () => {
    expect(sentRequestClosing(facts("negotiating", { meetingAhead: true, standingBooking: true }))).toBe("cancel_meeting");
    expect(sentRequestClosing(facts("booking", { meetingAhead: true, standingBooking: true }))).toBe("cancel_meeting");
    expect(sentRequestClosing(facts("negotiating", { standingBooking: true }))).toBe("drop_change");
  });

  it("leaves an expired open request to the expiry job", () => {
    expect(sentRequestClosing(facts("negotiating", { expired: true }))).toBe("leave");
  });

  it.each(["draft", "declined", "withdrawn", "expired", "cancelled"] as const)("leaves a %s request", (state) => {
    expect(sentRequestClosing(facts(state))).toBe("leave");
  });
});

describe("account_requests_close handler", () => {
  it("does nothing with a malformed payload", async () => {
    const tx = (() => {
      throw new Error("A malformed payload must not reach the database.");
    }) as unknown as Transaction;
    const job = { attempts: 1, fence: 1, id: "job", kind: "account_requests_close", maxAttempts: 20, payload: { requestIds: ["not-an-id"] } } as unknown as ClaimedJob;

    await expect(createAccountRequestsCloseHandler(() => { throw new Error("no notices"); })(tx, job)).resolves.toEqual({ status: "missing" });
  });
});
