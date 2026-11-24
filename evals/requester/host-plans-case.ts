import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { CALENDAR_PRIVACY_REPLY } from "../../lib/contracts/feasibility";
import { OFFERS_WIDER_SEARCH, readRequestProjection, requesterSession, requesterStubs, SAYS_BOTH_CHECKED, THREE_TIMES } from "./support";

// #309, #311 (UAT G01 step 8): with candidate times shown, a guest asking about
// the host's other plans hears that the assistant cannot see the host's
// calendar, that both calendars are checked privately when times are found,
// and an offer to look at other days or a wider window. Offering to choose
// among the listed times fails the offer check.
export function hostPlansEval(language: "en" | "ko", question: string) {
  return defineEval({
    tags: ["requester", "live-model", "capability"],
    async test(t) {
      const projection = readRequestProjection({
        ...THREE_TIMES,
        calendarReply: CALENDAR_PRIVACY_REPLY[language],
        details: { ...readRequestProjection().details, language },
      });
      const { send } = await requesterSession(t, requesterStubs(projection), { language });
      const turn = await send(question);
      const text = (value: unknown) => String(value ?? "");

      t.succeeded();
      t.check(turn.message, satisfies((value) => SAYS_BOTH_CHECKED.test(text(value)), "says both calendars are checked"));
      t.check(turn.message, satisfies((value) => OFFERS_WIDER_SEARCH.test(text(value)), "offers other days or a wider window"));
      t.check(turn.message, satisfies((value) => /[?？]/.test(text(value)), "asks back")).label("offers as a question");
    },
  });
}
