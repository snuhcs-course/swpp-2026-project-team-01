import { describe, expect, it } from "vitest";
import { REQUEST_STATES } from "../contracts/request";
import { localNow, meetingPhase, nextSteps, STATUS_TEXT, statusText } from "./request-status-texts";

const meeting = { end: "2026-11-18T09:56:00Z", start: "2026-11-18T09:26:00Z" };

describe("meetingPhase", () => {
  it("is upcoming before the start, started from the start and ended from the end", () => {
    expect(meetingPhase(meeting, new Date("2026-11-18T09:25:59Z"))).toBe("upcoming");
    expect(meetingPhase(meeting, new Date("2026-11-18T09:26:00Z"))).toBe("started");
    expect(meetingPhase(meeting, new Date("2026-11-18T09:35:00Z"))).toBe("started");
    expect(meetingPhase(meeting, new Date("2026-11-18T09:56:00Z"))).toBe("ended");
  });
});

describe("statusText", () => {
  // #277: a booked meeting that has started no longer reads as cancellable.
  it("says a started or ended booked meeting can no longer be cancelled or changed", () => {
    expect(statusText("booked", "upcoming")).toBe(STATUS_TEXT.booked);
    expect(statusText("booked", null)).toBe(STATUS_TEXT.booked);
    for (const phase of ["started", "ended"] as const) {
      const text = statusText("booked", phase);
      expect(text).toContain("can no longer be cancelled or changed here");
      expect(text).not.toContain("Until it starts");
    }
  });

  // #278: the booking state says nothing changes until it is booked, and never
  // sends the guest to the host.
  it("says nothing changes while the approved meeting is being booked", () => {
    expect(STATUS_TEXT.booking).toContain("Nothing can change here until it is booked");
    expect(STATUS_TEXT.booking).toContain("Once it is booked, the guest can change");
    expect(STATUS_TEXT.booking).not.toMatch(/contact/i);
  });

  it("ignores the meeting phase outside the booked state", () => {
    expect(statusText("negotiating", "started")).toBe(STATUS_TEXT.negotiating);
  });
});

describe("nextSteps", () => {
  const tools = ["apply_request_review", "choose_time", "agree_to_proposal", "change_agreement", "withdraw_request", "cancel_booking", "change_booking"];
  const offered = (text: string) =>
    tools.filter((tool) => text.includes(tool) && !new RegExp(`do not call[^.]*${tool}`).test(text));

  it("lists only the decisions each state's commands accept", () => {
    expect(offered(nextSteps("gathering"))).toEqual(["apply_request_review", "choose_time", "agree_to_proposal", "withdraw_request"]);
    expect(offered(nextSteps("negotiating"))).toEqual(["apply_request_review", "choose_time", "agree_to_proposal", "withdraw_request"]);
    expect(offered(nextSteps("awaiting_host_approval"))).toEqual(["change_agreement", "withdraw_request"]);
    expect(offered(nextSteps("booking"))).toEqual([]);
    expect(offered(nextSteps("booked", "upcoming"))).toEqual(["cancel_booking", "change_booking"]);
    expect(offered(nextSteps("booked", "started"))).toEqual([]);
    expect(offered(nextSteps("booked", "ended"))).toEqual([]);
    for (const state of ["cancelled", "declined", "expired", "withdrawn"] as const) expect(offered(nextSteps(state))).toEqual([]);
  });

  // #278: change_agreement is offered only while the host has not decided.
  it("offers change_agreement only while the request waits for the host", () => {
    for (const state of REQUEST_STATES) {
      expect(offered(nextSteps(state)).includes("change_agreement")).toBe(state === "awaiting_host_approval");
    }
  });
});

describe("localNow", () => {
  it("gives the requester's local date, clock time and weekday", () => {
    expect(localNow("Asia/Seoul", new Date("2026-11-18T09:35:00Z"))).toBe("2026-11-18 18:35 (Wednesday)");
    expect(localNow("UTC", new Date("2026-11-18T23:05:00Z"))).toBe("2026-11-18 23:05 (Wednesday)");
  });
});
