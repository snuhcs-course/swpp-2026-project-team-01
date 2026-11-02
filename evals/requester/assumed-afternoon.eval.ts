import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { readRequestProjection, requesterSession, requesterStubs } from "./support";

export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    const base = readRequestProjection();
    const projection = readRequestProjection({
      details: { ...base.details, language: "ko", windows: [] },
      today: "2026-11-03 (Tuesday)",
    });
    const stubs = requesterStubs(projection, [{
      id: "inferred-availability",
      tool: "draft_request_review",
      match: { inferredTime: { enum: [true] } },
      outcome: { response: { recorded: true, review: { canApply: true, clarifications: [], intent: "availability", patch: {}, questions: [] } } },
    }]);
    const { send } = await requesterSession(t, stubs, { language: "ko" });
    const turn = await send("이번주는 안되는데 다음주는 될거같아. 오후시간이면 더 좋고.");
    t.succeeded();
    t.calledTool("draft_request_review", { input: (input) => {
      const d = input.details as { windows?: { date?: string; start?: string; end?: string }[]; preferredWindows?: { date?: string; start?: string; end?: string }[] } | undefined;
      const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
      return input.inferredTime === true && dates.every((date) => d?.windows?.some((w) => w.date === date && w.start === "00:00" && w.end === "23:59") && d?.preferredWindows?.some((w) => w.date === date && w.start === "12:00" && w.end === "18:00"));
    } });
    t.check(turn.message, satisfies((text) => /12/.test(String(text ?? "")) && /18|6시/.test(String(text ?? "")), "states the inferred hours"));
  },
});
