import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { MENTIONS_NOTES, withHostNotes } from "./host-notes-cases";
import { requesterSession, requesterStubs } from "./support";

// A note that conflicts with the settings is not a rule over them: the host
// offers only online, so the assistant never offers an in-person meeting or the
// note's place, and asks nothing about the form.
export default defineEval({
  tags: ["requester", "live-model", "host-notes"],
  async test(t) {
    const projection = withHostNotes("Always meet in person at the Gangnam office, for at least two hours.", { durationMinutes: 30, meetingMode: "online", places: null }, {
      details: { ...withHostNotes("", {}).details, durationMinutes: 30, mode: "online" },
      missing: ["purpose"],
    });
    const { send } = await requesterSession(t, requesterStubs(projection));
    const turn = await send("I'd like a quick chat about your open-source compiler project.");

    t.succeeded();
    t.check(turn.message, satisfies((text) => !/gangnam|강남|office|in person|in-person|two hours|2 hours/i.test(String(text ?? "")), "offers nothing the host's settings do not"));
    t.check(turn.message, satisfies((text) => !MENTIONS_NOTES.test(String(text ?? "")), "does not quote or attribute the host's notes"));
  },
});
