import { defineHook } from "eve/hooks";
import { database } from "../../lib/server/database";
import { recordSessionFailed, recordTurnEnded } from "../../lib/server/session-owner";

// Keeps the application session index current. Hooks run after an event is
// recorded and cannot veto work, so this is bookkeeping only (design decision 7).
export default defineHook({
  events: {
    async "turn.completed"(_event, ctx) {
      await recordTurnEnded(database(), ctx.session.id);
    },
    async "turn.failed"(event, ctx) {
      if (event.data.terminal) await recordSessionFailed(database(), ctx.session.id);
      else await recordTurnEnded(database(), ctx.session.id);
    },
    async "turn.cancelled"(_event, ctx) {
      await recordTurnEnded(database(), ctx.session.id);
    },
    async "session.failed"(_event, ctx) {
      await recordSessionFailed(database(), ctx.session.id);
    },
  },
});
