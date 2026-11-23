import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { MENTIONS_NOTES, withHostNotes } from "./host-notes-cases";
import { requesterSession, requesterStubs } from "./support";

// A note prefers online for a first meeting while the host offers either: the
// assistant suggests online first and still lets the guest choose, without
// saying the host prefers it.
export default defineEval({
  tags: ["requester", "live-model", "host-notes"],
  async test(t) {
    const projection = withHostNotes("A first meeting is online.", { durationMinutes: 30, meetingMode: "either", places: "decided per meeting" });
    const { send } = await requesterSession(t, requesterStubs(projection));
    const turn = await send("Hi! We haven't met before. I'd like to talk about a possible research collaboration.");

    t.succeeded();
    t.check(turn.message, satisfies((text) => /online/i.test(String(text ?? "")), "suggests meeting online"));
    t.check(turn.message, satisfies((text) => /in person|in-person/i.test(String(text ?? "")) || /\?/.test(String(text ?? "")), "leaves the choice to the guest"));
    t.check(turn.message, satisfies((text) => !MENTIONS_NOTES.test(String(text ?? "")), "does not quote or attribute the host's notes"));
  },
});
