import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { readRequestProjection, requesterSession, requesterStubs } from "./support";

// Issue #410: the channel marker is added only to the guest's forwarded
// messages. Asked by iMessage or email, the model's own reply does not start
// with "[iMessage]", "[Email]" or any other marker; the send path strips one
// anyway (stripChannelMarkers), so this checks the instruction, not the guard.
const MARKER = /^\s*(?:\*\*)?\[(?:iMessage|WhatsApp|Telegram|Email)\]/i;

export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    for (const channel of ["[iMessage]", "[Email]"]) {
      const { send } = await requesterSession(t, requesterStubs(readRequestProjection()));
      const turn = await send(`${channel} Hi, could we meet for 30 minutes next week?`);

      t.check(turn.message, satisfies((text) => !MARKER.test(String(text ?? "")), "starts with no channel marker")).label(
        `${channel}: reply starts with no channel marker`,
      );
    }

    t.succeeded();
  },
});
