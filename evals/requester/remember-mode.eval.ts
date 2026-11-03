import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { readRequestProjection, requesterSession, requesterStubs } from "./support";

export default defineEval({
  tags: ["requester", "live-model"],
  async test(t) {
    const projection = readRequestProjection({
      details: { ...readRequestProjection().details, language: "ko", mode: null, purpose: null, windows: [] },
      host: { displayName: '"Ada Lovelace"', offer: { durationMinutes: 30, meetingMode: "either", places: "decided per meeting" } },
      missing: ["purpose", "mode"],
      readyForTimes: false,
    });
    const { send } = await requesterSession(t, requesterStubs(projection), { language: "ko" });
    await send("30분정도의 커피챗을 대면으로 하고싶어.");
    const turn = await send("투자상담");
    t.succeeded();
    t.check(turn.message, satisfies((text) => {
      const answer = String(text ?? "");
      return answer.length > 0 && !(/온라인/.test(answer) && /대면|직접/.test(answer));
    }, "does not ask online or in person again"));
  },
});
