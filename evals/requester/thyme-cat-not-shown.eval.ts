import { defineEval } from "eve/evals";
import { PROPOSED, readRequestProjection, requesterSession, requesterStubs } from "./support";

// thyme-mood-cats: the model never adds a cat for an outcome. A recorded
// agreement gets its happy cat from the record, and a time that is no longer
// free is the calendar's news, not the assistant's mistake.
const AGREED = { message: "Agreed. The request now waits for the host's approval; nothing is booked yet.", recorded: true, state: "awaiting_host_approval" };
const TAKEN = {
  message: "Nothing was agreed: this time is no longer free on the host's calendar. Tell the guest, then call evaluate_candidates and offer the new times.",
  recorded: false,
};

export default defineEval({
  tags: ["requester", "live-model", "capability"],
  async test(t) {
    for (const [id, response] of [
      ["agreed", AGREED],
      ["taken", TAKEN],
    ] as const) {
      const stubs = requesterStubs(readRequestProjection(PROPOSED), [{ id: `agree-${id}`, outcome: { response }, tool: "agree_to_proposal" }]);
      const { send } = await requesterSession(t, stubs);
      await send("That time works for me, please go ahead with it.");
    }

    t.succeeded();
    t.calledTool("agree_to_proposal", { count: (count) => count >= 2 });
    t.notCalledTool("show_cat");
  },
});
