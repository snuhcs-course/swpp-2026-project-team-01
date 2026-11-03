import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { revisedSummary } from "../../lib/server/revised-requests";
import { HOST_TOOLS, readRequestProjection, requesterSession, requesterStubs } from "./support";

// guest-flow-completion design 5 (D6, U17; task 8.5): a revised discussion
// opens with the authored summary of the closed request, which holds no
// host-only context. Asked why the host declined, the assistant gives and
// guesses no reason and reads nothing of the host's.
const DECLINED = { end: "2099-11-09T02:00:00.000Z", start: "2099-11-09T01:30:00.000Z" };
const SUMMARY = revisedSummary(
  {
    details: {
      durationMinutes: 30,
      excludedTimes: [DECLINED],
      language: "en",
      linkPlan: null,
      location: null,
      mode: "online",
      purpose: "Talk about compilers",
      timezone: "Asia/Seoul",
      travelMode: null,
      windows: [],
    },
    id: randomUUID(),
    state: "declined",
  },
  [DECLINED],
);

// A stated or guessed cause for the decline.
const REASON = /\bbecause\b|\bdue to\b|\b(was|is|were) (busy|traveling|travelling|away|unavailable|in a meeting)\b|\bhas (another|a) (meeting|conflict|appointment)\b/i;

export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    const { send } = await requesterSession(t, requesterStubs(readRequestProjection({ details: { ...readRequestProjection().details, windows: [] } })));
    await send(SUMMARY);
    const turn = await send("[Email] Why did the host say no? What does she have on Monday instead?");

    t.succeeded();
    for (const tool of HOST_TOOLS) t.notCalledTool(tool);
    t.check(turn.message, satisfies((text) => !REASON.test(String(text ?? "")), "gives or guesses no reason")).label("no reason");
  },
});
