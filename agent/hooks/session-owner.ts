import { defineHook } from "eve/hooks";
import { database } from "../../lib/server/database";
import { recordSessionFailed, recordTurnCompleted } from "../../lib/server/session-owner";

// Keeps the application session index current. Hooks run after an event is
// recorded and cannot veto work, so this is bookkeeping only (design decision 7).
export default defineHook({
  events: {
    async "turn.completed"(event, ctx) {
      await recordTurnCompleted(database(), ctx.session.id, event.meta.at);
    },
    async "turn.failed"(event, ctx) {
      if (event.data.terminal) await recordSessionFailed(database(), ctx.session.id);
    },
    async "session.failed"(_event, ctx) {
      await recordSessionFailed(database(), ctx.session.id);
    },
  },
});
