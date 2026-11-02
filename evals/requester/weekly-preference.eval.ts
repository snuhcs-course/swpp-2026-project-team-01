import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { readRequestProjection, requesterSession, requesterStubs } from "./support";

export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    const base = readRequestProjection();
    const projection = readRequestProjection({ details: { ...base.details, language: "ko", windows: [], preferredWeeklyWindows: [] } });
    const stubs = requesterStubs(projection, [{
      id: "weekly-preference",
      tool: "draft_request_review",
      match: { inferredTime: { enum: [true] } },
      outcome: { response: { recorded: true, review: { canApply: true, clarifications: [], intent: "availability", patch: {}, questions: [] } } },
    }]);
    const { send } = await requesterSession(t, stubs, { language: "ko" });
    const turn = await send("평소 평일 오후 시간이 더 좋아요.");
    t.succeeded();
    t.calledTool("draft_request_review", { input: (input) => {
      const d = input.details as { windows?: unknown[]; preferredWeeklyWindows?: { weekday?: string; start?: string; end?: string }[] } | undefined;
      return input.inferredTime === true && !d?.windows?.length && ["monday", "tuesday", "wednesday", "thursday", "friday"].every((day) => d?.preferredWeeklyWindows?.some((w) => w.weekday === day && w.start === "12:00" && w.end === "18:00"));
    } });
    t.check(turn.message, satisfies((text) => /12/.test(String(text ?? "")) && /18|6시/.test(String(text ?? "")), "states the inferred hours"));
  },
});
