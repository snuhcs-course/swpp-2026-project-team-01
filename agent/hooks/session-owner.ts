import { defineHook } from "eve/hooks";
import { agentUrlFromEnvironment, deliverNextAfterTurn, eveRuntime } from "../../lib/server/conversations";
import { database } from "../../lib/server/database";
import { internalSigningKey } from "../../lib/server/internal-bearer";
import { recordSessionFailed, recordTurnEnded } from "../../lib/server/session-owner";

// Keeps the application session index current. Hooks run after an event is
// recorded and cannot veto work, so this is bookkeeping only (design decision 7).
// Once the session is idle again, the discussion's next accepted input is
// delivered through the same application path as a browser message: a signed
// internal bearer that appAuth checks against the index.
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
    async "session.waiting"(_event, ctx) {
      await deliverNextAfterTurn(
        { db: database(), runtime: eveRuntime(agentUrlFromEnvironment()), signingKey: internalSigningKey() },
        ctx.session.id,
      );
    },
    async "session.failed"(_event, ctx) {
      await recordSessionFailed(database(), ctx.session.id);
    },
  },
});
