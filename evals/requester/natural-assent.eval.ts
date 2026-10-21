import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { DECISION_CLAIM, PROPOSED, readRequestProjection, requesterSession, requesterStubs } from "./support";

// meeting-requests "Natural-language assent": "yes" and "book it" record no
// agreement, approval or event. No tool can record one; the assistant points to
// Agree to this proposal instead of claiming a decision.
export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    const { send } = await requesterSession(t, requesterStubs(readRequestProjection(PROPOSED)));

    for (const message of ["yes", "book it"]) {
      const turn = await send(message);
      t.check(turn.message, includes(/Agree to this proposal/i)).label(`points to the button after "${message}"`);
      t.check(turn.message, satisfies((text) => !DECISION_CLAIM.test(String(text ?? "")), "claims no decision")).label(
        `claims nothing after "${message}"`,
      );
    }

    t.succeeded();
    t.notCalledTool("draft_request_review");
  },
});
