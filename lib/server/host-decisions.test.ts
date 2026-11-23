import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HostRequestItem } from "../contracts/host-request";
import { matchHostRequests } from "./channel-selection";
import { approveProposalToolInput, chooseDecisionTarget, declineRequestToolInput, hostRequestsForModel } from "./host-review-tools";
import { requestRef } from "./request-ref";

// Several decisions in one host message (issue #382): approve_proposal and
// decline_request name the request they decide, resolved as
// switch_conversation resolves it, among the host's own requests.

function item(requestId: string, requesterName: string, state: HostRequestItem["state"], extra: Partial<HostRequestItem> = {}): HostRequestItem {
  return {
    bookedStart: null,
    needsDecision: state === "awaiting_host_approval",
    proposalStart: null,
    purpose: "Coffee chat",
    requestId,
    requesterName,
    sample: false,
    state,
    updatedAt: "2026-11-24T00:00:00.000Z",
    ...extra,
  };
}

const BOUND = "00000000-0000-4000-8000-000000000001";
const EUNWOO = "00000000-0000-4000-8000-000000000002";
const DOHYEON_A = "00000000-0000-4000-8000-000000000003";
const DOHYEON_B = "00000000-0000-4000-8000-000000000004";
const OLD_EUNWOO = "00000000-0000-4000-8000-000000000005";
const SAMPLE = "00000000-0000-4000-8000-000000000006";

const REQUESTS = [
  item(BOUND, "김민지", "awaiting_host_approval"),
  item(EUNWOO, "이은우", "awaiting_host_approval"),
  item(DOHYEON_A, "박도현", "awaiting_host_approval"),
  item(DOHYEON_B, "박도현", "negotiating"),
  item(OLD_EUNWOO, "이은우", "declined"),
  item(SAMPLE, "Sample guest", "awaiting_host_approval", { sample: true }),
];

describe("matchHostRequests", () => {
  it("finds a request by reference, with or without the word request", () => {
    expect(matchHostRequests(REQUESTS, requestRef(EUNWOO)).map((entry) => entry.requestId)).toEqual([EUNWOO]);
    expect(matchHostRequests(REQUESTS, `request ${requestRef(EUNWOO).toLowerCase()}`).map((entry) => entry.requestId)).toEqual([EUNWOO]);
  });

  it("finds a request by the requester's name as the host wrote it, open ahead of closed", () => {
    expect(matchHostRequests(REQUESTS, "이은우").map((entry) => entry.requestId)).toEqual([EUNWOO]);
    expect(matchHostRequests(REQUESTS, "박도현").map((entry) => entry.requestId)).toEqual([DOHYEON_A, DOHYEON_B]);
    expect(matchHostRequests(REQUESTS, "nobody")).toEqual([]);
  });
});

describe("matchHostRequests for a decision", () => {
  const LEES = [item(EUNWOO, "Eunwoo Lee", "negotiating"), item(DOHYEON_A, "Lee", "awaiting_host_approval")];

  it("takes only the exact name, without a possessive", () => {
    for (const reference of ["Eunwoo Lee", "eunwoo lee's", "Eunwoo Lee's request"]) {
      expect(matchHostRequests(LEES, reference, { exactName: true }).map((entry) => entry.requestId)).toEqual([EUNWOO]);
    }
    for (const reference of ["이은우님 거", "이은우 씨 요청", "이은우의 요청"]) {
      expect(matchHostRequests(REQUESTS, reference, { exactName: true }).map((entry) => entry.requestId)).toEqual([EUNWOO]);
    }
  });

  it("never lets part of a name decide another requester's request", () => {
    expect(matchHostRequests(LEES, "Eunwoo", { exactName: true })).toEqual([]);
    expect(chooseDecisionTarget(LEES, BOUND, "Eunwoo Lee's", "approve")).toMatchObject({ requestId: EUNWOO });
    expect(chooseDecisionTarget(LEES, BOUND, "Lee", "approve")).toMatchObject({ requestId: DOHYEON_A });
    // Switching keeps its looser match.
    expect(matchHostRequests(LEES, "Lee").map((entry) => entry.requestId)).toEqual([EUNWOO, DOHYEON_A]);
  });
});

describe("chooseDecisionTarget", () => {
  it("decides the named request and says which", () => {
    expect(chooseDecisionTarget(REQUESTS, BOUND, "이은우", "approve")).toEqual({
      named: { ref: requestRef(EUNWOO), requester: expect.stringContaining("이은우") },
      requestId: EUNWOO,
    });
    expect(chooseDecisionTarget(REQUESTS, BOUND, "김민지", "decline")).toMatchObject({ requestId: BOUND });
  });

  it("approves the only one of a requester's requests that awaits approval", () => {
    expect(chooseDecisionTarget(REQUESTS, BOUND, "박도현", "approve")).toMatchObject({ requestId: DOHYEON_A });
  });

  it("decides nothing for a name that matches several requests and lists them", () => {
    const result = chooseDecisionTarget(REQUESTS, BOUND, "박도현", "decline");
    expect(result).toMatchObject({ problem: expect.stringMatching(/nothing was declined for it/) });
    expect("matches" in result && result.matches?.map((entry) => entry.ref)).toEqual([requestRef(DOHYEON_A), requestRef(DOHYEON_B)]);
  });

  it("decides nothing for a reference that is not one of the host's requests", () => {
    expect(chooseDecisionTarget(REQUESTS, BOUND, "ZZZZZZ", "approve")).toEqual({
      problem: expect.stringMatching(/^No request matches "ZZZZZZ"; nothing was approved/),
    });
  });

  it("never decides another request's sample tutorial", () => {
    expect(chooseDecisionTarget(REQUESTS, BOUND, requestRef(SAMPLE), "approve")).toMatchObject({ problem: expect.any(String) });
    expect(chooseDecisionTarget(REQUESTS, SAMPLE, requestRef(SAMPLE), "approve")).toMatchObject({ requestId: SAMPLE });
  });
});

describe("decision tool inputs", () => {
  it("take an optional request reference and stay strict", () => {
    expect(approveProposalToolInput.parse({ request: " 이은우 ", version: 2 })).toEqual({ request: "이은우", version: 2 });
    expect(approveProposalToolInput.parse({ version: 2 })).toEqual({ version: 2 });
    expect(declineRequestToolInput.parse({ request: "6ADSRV", version: null })).toMatchObject({ request: "6ADSRV", version: null });
    expect(approveProposalToolInput.safeParse({ request: "", version: 1 }).success).toBe(false);
    expect(approveProposalToolInput.safeParse({ requestId: EUNWOO, version: 1 }).success).toBe(false);
  });
});

describe("list_host_requests for the model", () => {
  it("gives each request with a proposal its proposalVersion", () => {
    const listed = hostRequestsForModel([REQUESTS[0]!, REQUESTS[3]!], "Asia/Seoul", new Date("2026-11-24T00:00:00Z"), [], new Map([[BOUND, 3]]));
    expect(listed.requests[0]).toMatchObject({ proposalVersion: 3, ref: requestRef(BOUND) });
    expect(listed.requests[1]).not.toHaveProperty("proposalVersion");
  });
});

describe("host messenger instructions", () => {
  it("apply every clear decision in one turn and ask only about unclear ones", () => {
    const fragment = readFileSync(new URL("../../agent/instructions/host-imessage.ts", import.meta.url), "utf8").replace(/\s+/g, " ");
    expect(fragment).toMatch(/One message may carry several decisions/);
    expect(fragment).toMatch(/Never switch the conversation for it, and never ask the host to repeat a decision they already made/);
    expect(fragment).toMatch(/Ask only about a decision that is unclear/);
  });
});
