import type { Database } from "./database";

// Bookkeeping for the session index, run from the agent's session-owner hook
// after eve has durably recorded each event. It is not authority: it never
// decides what may run (route auth and the model wrapper do), it only keeps the
// index's view of the runtime current.

// A turn that finished completes every input sent to the session before it.
export async function recordTurnCompleted(db: Database, sessionId: string, at: string) {
  await db`
    update app.conversation_inputs
    set state = 'completed', completed_at = now()
    where session_id = ${sessionId} and state = 'sent' and sent_at <= ${at}::timestamptz
  `;
}

// eve reported the session terminally failed: trusted terminal evidence for
// recovery. A retired generation stays retired.
export async function recordSessionFailed(db: Database, sessionId: string) {
  await db`
    update app.agent_sessions set state = 'failed', updated_at = now()
    where session_id = ${sessionId} and state = 'active'
  `;
}
