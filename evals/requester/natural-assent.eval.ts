import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { NAMES_A_CONTROL, PROPOSED, readRequestProjection, requesterSession, requesterStubs } from "./support";

// guest-flow-completion U15 (task 8.5): a decision in words counts. "book it"
// by iMessage or email on a proposal records the agreement on that proposal's
// version through agree_to_proposal, and the plain-text reply says it waits for
// the host's approval without naming a card or button.
const AGREED = { message: "Agreed. The request now waits for the host's approval; nothing is booked yet.", recorded: true, state: "awaiting_host_approval" };

export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    for (const channel of ["[iMessage]", "[Email]"]) {
      const stubs = requesterStubs(readRequestProjection(PROPOSED), [
        { id: `agree-${channel}`, outcome: { response: AGREED }, tool: "agree_to_proposal" },
      ]);
      const { send } = await requesterSession(t, stubs);
      const turn = await send(`${channel} book it`);

      t.check(turn.message, includes(/approv/i)).label(`${channel}: says it waits for the host's approval`);
      t.check(turn.message, satisfies((text) => !NAMES_A_CONTROL.test(String(text ?? "")), "names no card or button")).label(
        `${channel}: names no card or button`,
      );
    }

    t.succeeded();
    t.calledTool("agree_to_proposal", { count: (count) => count >= 2, input: { version: 1 } });
  },
});
