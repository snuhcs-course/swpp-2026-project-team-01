import { describe, expect, it } from "vitest";
import type { HostRequestView } from "../contracts/host-request";
import { MAX_PROPOSAL_TIMES, proposalTimes } from "../contracts/request";
import { approveInput } from "./bookings";
import { decisionButtons, decisionSuffix, parseCommand, requestRef, requestSummary } from "./imessage-commands";
import { chooseInput } from "./request-proposals";
import { inlineKeyboard, parseCallbackData, telegramButtonsOf } from "./telegram";
import { buttonCommand } from "./whatsapp";

// A guest can agree to several candidate times at once and the host books one
// (multiple-candidate-times, #146). These pin the pure pieces: the command
// inputs, the proposal's times, and the host's messenger summary and buttons.

const EVALUATION = "0a6e3a6c-5d3e-4a4e-9d8e-2f7f3c7b1a10";
const REQUEST = "5c9a0e62-6f1d-4d0b-9f1e-1b2c3d4e5f60";

const time = (start: string, end: string, location: string | null = null) => ({
  end,
  linkPlan: location ? null : ({ kind: "google_meet" } as const),
  location,
  mode: location ? ("in_person" as const) : ("online" as const),
  start,
});

function hostView(times?: ReturnType<typeof time>[]): HostRequestView {
  const first = times?.[0] ?? time("2026-12-01T01:00:00.000Z", "2026-12-01T01:30:00.000Z");
  return {
    booking: null,
    details: { durationMinutes: 30, linkPlan: null, location: null, mode: "online", purpose: "Coffee chat", windows: [] },
    evaluation: null,
    expiresAt: "2026-12-05T00:00:00.000Z",
    hostTimezone: "Asia/Seoul",
    needsDecision: true,
    proposal: {
      agreedAt: "2026-11-23T00:00:00.000Z",
      durationMinutes: 30,
      end: first.end,
      linkPlan: first.linkPlan,
      location: first.location,
      mode: first.mode,
      start: first.start,
      ...(times ? { times } : {}),
      version: 2,
    },
    requestId: REQUEST,
    requester: { email: null, emailConfirmed: false, language: "en", name: "Mina", timezone: "Asia/Seoul" },
    revisedFrom: null,
    revision: 4,
    sample: false,
    state: "awaiting_host_approval",
    suggestion: null,
    weeklyLimit: null,
    weeklyLimitWaived: false,
  };
}

const THREE = [
  time("2026-12-01T01:00:00.000Z", "2026-12-01T01:30:00.000Z"),
  time("2026-12-02T05:00:00.000Z", "2026-12-02T05:30:00.000Z", "Cafe Mori"),
  time("2026-12-03T07:00:00.000Z", "2026-12-03T07:30:00.000Z"),
];

describe("request.choose_candidate input", () => {
  it("takes one candidate or two to three distinct ones, never both", () => {
    expect(chooseInput.safeParse({ candidateId: "c1", evaluationId: EVALUATION }).success).toBe(true);
    expect(chooseInput.safeParse({ candidateIds: ["c1", "c2"], evaluationId: EVALUATION }).success).toBe(true);
    expect(chooseInput.safeParse({ candidateIds: ["c1", "c2", "c3"], evaluationId: EVALUATION }).success).toBe(true);

    expect(chooseInput.safeParse({ candidateIds: ["c1", "c2", "c3", "c4"], evaluationId: EVALUATION }).success).toBe(false);
    expect(chooseInput.safeParse({ candidateIds: ["c1"], evaluationId: EVALUATION }).success).toBe(false);
    expect(chooseInput.safeParse({ candidateIds: ["c1", "c1"], evaluationId: EVALUATION }).success).toBe(false);
    expect(chooseInput.safeParse({ candidateId: "c1", candidateIds: ["c2", "c3"], evaluationId: EVALUATION }).success).toBe(false);
    expect(chooseInput.safeParse({ evaluationId: EVALUATION }).success).toBe(false);
    expect(MAX_PROPOSAL_TIMES).toBe(3);
  });
});

describe("request.approve input", () => {
  it("names a version and, for several times, the 1-based time to book", () => {
    expect(approveInput.safeParse({ version: 2 }).success).toBe(true);
    expect(approveInput.safeParse({ option: 3, version: 2 }).success).toBe(true);
    expect(approveInput.safeParse({ option: 0, version: 2 }).success).toBe(false);
    expect(approveInput.safeParse({ option: 4, version: 2 }).success).toBe(false);
  });
});

describe("proposalTimes", () => {
  it("lists a proposal's several times, or its one time", () => {
    const one = { ...THREE[0]!, start: THREE[0]!.start };
    expect(proposalTimes(one)).toEqual([THREE[0]]);
    const several = { ...THREE[0]!, times: THREE.map((entry, index) => ({ ...entry, candidateId: `c${index}` })) };
    expect(proposalTimes(several).map((entry) => entry.start)).toEqual(THREE.map((entry) => entry.start));
  });
});

describe("the host's messenger summary of several times", () => {
  it("numbers each time and asks which one to book", () => {
    const summary = requestSummary(hostView(THREE));
    expect(summary).toContain("Proposal 2: the guest can make any of these 3 times, 30 minutes each. You book one.");
    expect(summary).toMatch(/^1\. .*online\.$/m);
    expect(summary).toMatch(/^2\. .*in person at Cafe Mori\.$/m);
    expect(summary).toMatch(/^3\. /m);
    expect(summary).toContain('"book time 2"');
  });

  it("keeps a proposal of one time as it was", () => {
    const summary = requestSummary(hostView());
    expect(summary).toMatch(/^Proposal 2: .*, 30 minutes, online\.$/m);
    expect(summary).toContain('"book it"');
  });

  it("offers one button per time, within WhatsApp's three", () => {
    const ref = requestRef(REQUEST);
    const buttons = decisionButtons(hostView(THREE));
    expect(buttons?.items).toEqual([
      { id: `a:${ref}-2-1`, title: "Book time 1" },
      { id: `a:${ref}-2-2`, title: "Book time 2" },
      { id: `a:${ref}-2-3`, title: "Book time 3" },
    ]);
    expect(decisionButtons(hostView())?.items.map((item) => item.id)).toEqual([`a:${ref}-2`, `d:${ref}-2`, `s:${ref}`]);
  });

  it("turns each WhatsApp tap back into approve of that time", () => {
    for (const [index, item] of decisionButtons(hostView(THREE))!.items.entries()) {
      const command = parseCommand(buttonCommand(item.id)!);
      expect(command?.name).toBe("approve");
      expect(decisionSuffix((command as { ref: string }).ref.slice(7))).toEqual({ option: index + 1, version: 2 });
    }
    expect(buttonCommand("d:K7Q2MX-2-1")).toBeNull();
  });

  it("makes the same buttons a Telegram keyboard, with Decline and details", () => {
    const ref = requestRef(REQUEST);
    const telegram = telegramButtonsOf(decisionButtons(hostView(THREE))!);
    expect(telegram).toEqual({ kind: "decision", options: 3, ref, version: 2 });
    const keyboard = inlineKeyboard(telegram!);
    expect(keyboard.inline_keyboard[0]!.map((button) => button.callback_data)).toEqual([`a:${ref}-2-1`, `a:${ref}-2-2`, `a:${ref}-2-3`]);
    expect(keyboard.inline_keyboard[1]!.map((button) => button.callback_data)).toEqual([`d:${ref}-2`, `s:${ref}`]);
    expect(telegramButtonsOf(decisionButtons(hostView())!)).toEqual({ kind: "decision", ref, version: 2 });
  });
});

describe("references to one of several times", () => {
  it("reads approve <ref>-<version>-<n> from a tap or typed words", () => {
    expect(parseCallbackData("a:K7Q2MX-2-3")).toEqual({ name: "approve", ref: "K7Q2MX-2-3" });
    expect(parseCommand("approve k7q2mx-2-1")).toEqual({ name: "approve", ref: "K7Q2MX-2-1" });
    expect(decisionSuffix("2")).toEqual({ option: null, version: 2 });
    expect(decisionSuffix("2-3")).toEqual({ option: 3, version: 2 });
  });

  it("refuses a time on a decline and malformed numbers", () => {
    for (const data of ["d:K7Q2MX-2-1", "a:K7Q2MX-2-0", "a:K7Q2MX-2-1-1", "a:K7Q2MX-2-x"]) expect(parseCallbackData(data)).toBeNull();
    expect(decisionSuffix("2-0")).toBeNull();
    expect(decisionSuffix("0")).toBeNull();
    expect(decisionSuffix("2-1-1")).toBeNull();
  });
});
