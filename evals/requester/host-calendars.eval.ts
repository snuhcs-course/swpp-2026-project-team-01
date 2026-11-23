import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { readRequestProjection, requesterSession, requesterStubs } from "./support";

// Testing baseline R01 M-2.1 (#334): a guest who is also a host chooses in
// words whether their own host calendars count for this request only. "Don't
// use my calendars for this one" calls use_host_calendars with use false; a
// choice of only some calendars ("skip my work calendar") is not something one
// request can hold, so the assistant says it can use all or none and asks,
// without calling the tool or touching the host's own settings.
const HOST_CALENDARS = { calendars: ["Work", "Personal"], counted: true };
const DROPPED = {
  calendars: ["Work", "Personal"],
  message:
    "Their host calendars no longer count for this request only; their host calendar settings are unchanged. Call evaluate_candidates again, since earlier times counted them.",
  recorded: true,
};
const ALL_OR_NONE = /\ball\b|\bnone\b|both|전부|모두|둘 다|다 /i;

export default defineEval({
  tags: ["requester", "live-model", "capability"],
  async test(t) {
    const projection = readRequestProjection({ yourHostCalendars: HOST_CALENDARS });

    const dropped = await requesterSession(
      t,
      requesterStubs(projection, [{ id: "drop-calendars", outcome: { response: DROPPED }, tool: "use_host_calendars" }]),
    );
    await dropped.send("Don't check my calendars for this one, I'll keep that week clear.");

    const partial = await requesterSession(t, requesterStubs(projection));
    const turn = await partial.send("Skip my work calendar for this meeting, only check my personal one.");
    t.check(turn.message, satisfies((text) => ALL_OR_NONE.test(String(text ?? "")), "says it can use all of them or none")).label(
      "a subset: offers all or none",
    );

    t.succeeded();
    t.calledTool("use_host_calendars", { count: (count) => count === 1, input: { use: false } });
    for (const tool of ["draft_settings", "set_calendar_roles", "change_settings"]) t.notCalledTool(tool);
  },
});
