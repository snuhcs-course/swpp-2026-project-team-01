import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { readRequestProjection, requesterSession, requesterStubs } from "./support";

// Testing baseline R01 M-7 (#334): a guest who is also a host asks, on their
// sent request, to change their own meetings in general. The routing sends the
// plain cases to setup; one that also names this meeting stays here, and the
// request's assistant changes nothing on the request for the general part: it
// points to "setup" in their linked chat.
export default defineEval({
  tags: ["requester", "live-model", "capability"],
  async test(t) {
    const projection = readRequestProjection({ yourHostCalendars: { calendars: ["Work"], counted: true } });
    const { send } = await requesterSession(t, requesterStubs(projection));
    const turn = await send("[iMessage] From now on I want my meetings to be 45 minutes by default, for all my guests. Can you set that?");

    t.succeeded();
    t.check(turn.message, includes(/setup|settings|설정/i)).label("points to their host setup");
    // Nothing about this request changes for a message about their meetings in general.
    t.notCalledTool("draft_request_review");
  },
});
