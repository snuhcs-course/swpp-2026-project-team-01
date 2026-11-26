import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hostRequestsForModel,
  proposalFeasibility,
  LANGUAGE_NOTE,
  proposeSharedChangesToolInput,
  SHARE_REPEATED_TEXT,
  SHARE_SUBMITTED_TEXT,
  SUGGESTION_RECORDED_TEXT,
  WEEK_NOTE,
} from "./host-review-tools";

const HANGUL = /[ㄱ-ㆎ가-힣]/;

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

// The host review failures the story path evaluation found (documentation 13).
describe("host review assistant texts", () => {
  it("tells the model the host's latest message decides the reply language (#272)", () => {
    expect(LANGUAGE_NOTE).toMatch(/host's latest message/);
    expect(hostRequestsForModel([], "Asia/Seoul").languageNote).toBe(LANGUAGE_NOTE);
    expect(WEEK_NOTE).not.toMatch(HANGUL);
  });

  it("keeps Korean out of the host examples except the service's own Korean messages (#272)", () => {
    const fragment = source("../../agent/instructions/host-imessage.ts");
    const korean = fragment.split("\n").filter((line) => HANGUL.test(line));
    // Only the quoted Korean service messages the host may answer stay, each beside its English.
    expect(korean.map((line) => line.trim())).toEqual([
      '"캘린더를 보니 …"), is a setup answer.',
      'note", or in Korean "메모처럼 보이는 일정이 …") is answered on that page,',
      '"이번 주 확인할 일정이 …"); read_setup_state\'s weeklyNoteList names it.',
    ]);

    const tools = source("../../agent/tools/request.ts");
    const hostTools = tools.slice(tools.lastIndexOf("read_request: defineTool"));
    expect(hostTools).not.toMatch(HANGUL);
  });

  it("reports sharing as submitted for checking, never as sent (#274)", () => {
    for (const text of [SHARE_SUBMITTED_TEXT, SHARE_REPEATED_TEXT]) {
      expect(text).not.toMatch(/^Shared/);
      expect(text).toMatch(/checking/);
    }
    expect(SHARE_SUBMITTED_TEXT).toMatch(/only if it passes/);
    expect(SHARE_SUBMITTED_TEXT).toMatch(/never say the changes were sent/);
  });

  it("says a replacement keeps the pending suggestion's other changes (#275)", () => {
    expect(proposeSharedChangesToolInput.shape.changes.description).toMatch(/pending suggestion's other changes stay/);
    expect(SUGGESTION_RECORDED_TEXT).toMatch(/earlier pending suggestion/);
  });

  it("drafts the host's exact time even outside the requester's windows (#276)", () => {
    expect(proposeSharedChangesToolInput.shape.changes.shape.start.description).toMatch(/even outside the requester's windows/);
    expect(source("../../agent/instructions/host-review.ts")).toMatch(/even a time\n  outside the requester's windows/);
  });
});

describe("current proposal explanation", () => {
  it("returns the exact evaluated proposal basis and never borrows another candidate's basis", () => {
    const start = "2026-12-01T01:00:00Z", end = "2026-12-01T01:30:00Z";
    const view: Parameters<typeof proposalFeasibility>[0] = {
      proposal: { start, end, durationMinutes: 30, agreedAt: null, linkPlan: null, location: null, mode: "online", version: 1 },
      evaluation: { id: "evaluation", state: "completed", failureCategory: null, weeklyLimitHold: false, exclusions: [],
        candidates: [{ start, end, id: "candidate", status: "offered", belowWeeklyLimit: true, hostLegs: [], basis: ["Inside Tuesday hours", "Free on conflict calendars"] }],
      },
    };
    expect(proposalFeasibility(view)).toEqual({ basis: ["Inside Tuesday hours", "Free on conflict calendars"], hostTrips: [], status: "offered", travel: "Online: no travel is required." });
    expect(proposalFeasibility({ ...view, proposal: { ...view.proposal!, start: "2026-12-01T02:00:00Z" } })).toBeNull();
    expect(proposalFeasibility({ ...view, evaluation: null })).toBeNull();
  });
});
