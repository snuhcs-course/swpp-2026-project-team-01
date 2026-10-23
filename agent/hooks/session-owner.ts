import { defineHook } from "eve/hooks";
import { agentUrlFromEnvironment, deliverNextAfterTurn, eveRuntime } from "../../lib/server/conversations";
import { database } from "../../lib/server/database";
import { wakeTurnReplies } from "../../lib/server/email-replies";
import { wakeImessageReplies } from "../../lib/server/imessage-outbox";
import { internalSigningKey } from "../../lib/server/internal-bearer";
import { recordInputReceived, recordSessionFailed, recordTurnEnded, retried } from "../../lib/server/session-owner";

// Keeps the application session index current. Hooks run after an event is
// recorded and cannot veto work, so this is bookkeeping only (design decision 7).
// Each write is retried, since eve does not retry a hook that throws.
// Once the session is idle again, the discussion's next accepted input is
// delivered through the same application path as a browser message: a signed
// internal bearer that appAuth checks against the index. A turn that served a
// message forwarded from email makes that message's thread reply due
// (requester-email-channel design 6), and one that served a host's iMessage
// makes its reply in the linked conversation due (host-imessage-channel design 9).
export default defineHook({
  events: {
    async "message.received"(event, ctx) {
      await retried(() => recordInputReceived(database(), ctx.session.id, event.meta.deliveryIds ?? []));
    },
    async "turn.completed"(_event, ctx) {
      await retried(() => recordTurnEnded(database(), ctx.session.id));
      await retried(() => wakeTurnReplies(database(), ctx.session.id));
      await retried(() => wakeImessageReplies(database(), ctx.session.id));
    },
    async "turn.failed"(event, ctx) {
      if (event.data.terminal) await retried(() => recordSessionFailed(database(), ctx.session.id));
      else await retried(() => recordTurnEnded(database(), ctx.session.id));
      await retried(() => wakeTurnReplies(database(), ctx.session.id));
      await retried(() => wakeImessageReplies(database(), ctx.session.id));
    },
    async "turn.cancelled"(_event, ctx) {
      await retried(() => recordTurnEnded(database(), ctx.session.id));
      await retried(() => wakeTurnReplies(database(), ctx.session.id));
      await retried(() => wakeImessageReplies(database(), ctx.session.id));
    },
    async "session.waiting"(_event, ctx) {
      await deliverNextAfterTurn(
        { db: database(), runtime: eveRuntime(agentUrlFromEnvironment()), signingKey: internalSigningKey() },
        ctx.session.id,
      );
    },
    async "session.failed"(_event, ctx) {
      await retried(() => recordSessionFailed(database(), ctx.session.id));
    },
  },
});
