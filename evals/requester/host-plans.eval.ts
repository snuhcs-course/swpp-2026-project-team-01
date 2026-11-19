import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { readRequestProjection, requesterSession, requesterStubs, THREE_TIMES } from "./support";

// #309 (UAT G01 step 8): with candidate times shown, a guest asking about the
// host's other plans hears that the assistant cannot see the host's calendar,
// that both calendars are checked privately when times are found, and an
// offer to look at other days or a wider window.
export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    const { send } = await requesterSession(t, requesterStubs(readRequestProjection(THREE_TIMES)));
    const turn = await send("Does the host have other plans that day?");

    t.succeeded();
    t.check(turn.message, satisfies((text) => /\bboth\b/i.test(String(text ?? "")), "says both calendars are checked"));
    t.check(
      turn.message,
      satisfies((text) => /\b(other|another|different|more)\s+(days?|times?|dates?)\b|\bwider\b|\bwiden\b/i.test(String(text ?? "")), "offers other times or a wider window"),
    );
    t.check(turn.message, satisfies((text) => String(text ?? "").includes("?"), "asks back")).label("offers as a question");
  },
});
