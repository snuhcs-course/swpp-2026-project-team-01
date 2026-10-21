import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { CLARIFICATION_QUESTIONS } from "../../lib/contracts/clarifications";
import { readRequestProjection, requesterSession, requesterStubs } from "./support";

// meeting-requests "Ambiguous conversational time" and "Supported
// clarification": a relative, date-free time is not turned into a window; the
// assistant declares a question with a clarification category and asks the
// authored question in the request's language, Korean.
const QUESTION = CLARIFICATION_QUESTIONS.missing_date.ko;

export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    const projection = readRequestProjection({
      details: { ...readRequestProjection().details, language: "ko", windows: [] },
      missing: ["windows"],
      readyForTimes: false,
    });
    const stubs = requesterStubs(projection, [
      {
        id: "draft-question",
        match: { intent: { enum: ["question", "unknown"] } },
        outcome: {
          response: {
            recorded: true,
            review: { canApply: false, clarifications: ["missing_date"], intent: "question", patch: null, questions: [QUESTION] },
          },
        },
        tool: "draft_request_review",
      },
    ]);
    const { send } = await requesterSession(t, stubs, { language: "ko" });
    const turn = await send("다음 주 오후 3시쯤 괜찮아요.");

    t.succeeded();
    t.calledTool("draft_request_review", { input: { intent: /^(question|unknown)$/ } });
    t.check(turn.message, includes(QUESTION));
  },
});
