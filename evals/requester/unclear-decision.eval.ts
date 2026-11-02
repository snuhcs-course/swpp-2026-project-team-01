import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { NAMES_A_CONTROL, readRequestProjection, requesterSession, requesterStubs, THREE_TIMES } from "./support";

// guest-flow-completion U15 (task 8.5): "book it" with three candidate times
// and no proposal names no time, so nothing is chosen or agreed; the assistant
// asks which time, in words.
export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    const { send } = await requesterSession(t, requesterStubs(readRequestProjection(THREE_TIMES)));
    const turn = await send("[iMessage] ok book it");

    t.succeeded();
    t.notCalledTool("choose_time");
    t.notCalledTool("agree_to_proposal");
    t.check(turn.message, satisfies((text) => String(text ?? "").includes("?"), "asks back")).label("asks which time");
    t.check(turn.message, satisfies((text) => !NAMES_A_CONTROL.test(String(text ?? "")), "names no card or button"));
  },
});
