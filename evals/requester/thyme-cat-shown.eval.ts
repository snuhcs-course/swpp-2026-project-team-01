import { defineEval } from "eve/evals";
import { PROPOSED, readRequestProjection, requesterSession, requesterStubs } from "./support";

// thyme-mood-cats: show_cat is called with sorry when the assistant owns a
// mistake it made, and with happy only when the guest asks to see the happy cat.
export default defineEval({
  tags: ["requester", "live-model", "capability"],
  async test(t) {
    const mistake = await requesterSession(t, requesterStubs(readRequestProjection(PROPOSED)));
    await mistake.send("What time is the proposed meeting?");
    await mistake.send("You told me the wrong timezone earlier. The proposal is in Korea time (GMT+9), right? Please correct it.");

    const asked = await requesterSession(t, requesterStubs(readRequestProjection(PROPOSED)));
    await asked.send("Show me the happy cat!");

    t.succeeded();
    t.calledTool("show_cat", { input: { cat: "sorry" } });
    t.calledTool("show_cat", { input: { cat: "happy" } });
  },
});
