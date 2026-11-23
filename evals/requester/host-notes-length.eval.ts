import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { MENTIONS_NOTES, withHostNotes } from "./host-notes-cases";
import { requesterSession, requesterStubs } from "./support";

// A note gives a length for one kind of meeting: once the purpose matches, the
// assistant drafts that length as its own suggestion, without quoting the note
// or saying the host asked for it.
export default defineEval({
  tags: ["requester", "live-model", "host-notes"],
  async test(t) {
    const projection = withHostNotes("투자 상담 미팅은 30분으로 해 주세요.", { durationMinutes: 60, meetingMode: "online", places: null }, {
      details: { ...withHostNotes("", {}).details, durationMinutes: 60, language: "ko", mode: "online" },
      missing: ["purpose"],
    });
    const stubs = requesterStubs(projection, [{
      id: "notes-length",
      tool: "draft_request_review",
      match: { intent: { enum: ["details"] } },
      outcome: { response: { recorded: true, review: { canApply: true, clarifications: [], intent: "details", patch: {}, questions: [] } } },
    }]);
    const { send } = await requesterSession(t, stubs, { language: "ko" });
    const turn = await send("투자 상담을 받고 싶어요. 다음 주 화요일 오후가 좋아요.");

    t.succeeded();
    t.calledTool("draft_request_review", { input: (input) => (input.details as { durationMinutes?: number } | undefined)?.durationMinutes === 30 });
    t.check(turn.message, satisfies((text) => /30\s*분/.test(String(text ?? "")), "proposes the 30-minute length"));
    t.check(turn.message, satisfies((text) => !MENTIONS_NOTES.test(String(text ?? "")), "does not quote or attribute the host's notes"));
  },
});
