import type { Database } from "./database";

// Bookkeeping for the session index, run from the agent's session-owner hook
// after eve has durably recorded each event. It is not authority: it never
// decides what may run (route auth and the model wrapper do), it only keeps the
// index's view of the runtime current.

// A turn that ended completes the input it served: the session's current
// accepted input, by identity. Timestamps are never compared, since the event
// time is the runtime's clock and the send time the database's. A retired or
// failed generation completes nothing; recovery owns its inputs.
export async function recordTurnEnded(db: Database, sessionId: string) {
  await db`
    update app.conversation_inputs i
    set state = 'completed', completed_at = now()
    from app.agent_sessions s
    where s.session_id = ${sessionId} and s.state = 'active'
      and i.id = s.current_input_id and i.session_id = s.session_id and i.state = 'sent'
  `;
}

// The session received its current accepted input: record the runtime's
// delivery identities for it, and that this session received it, which proves
// the current delivery arrived. One input is in flight per session at a time,
// so the current one is the input received.
export async function recordInputReceived(db: Database, sessionId: string, deliveryIds: readonly string[]) {
  if (deliveryIds.length === 0) return;

  await db`
    update app.conversation_inputs i
    set delivery_ids = array(select distinct unnest(i.delivery_ids || ${deliveryIds as string[]}::text[])),
        received_session_id = s.session_id
    from app.agent_sessions s
    where s.session_id = ${sessionId} and s.state = 'active'
      and i.id = s.current_input_id and i.session_id = s.session_id and i.state = 'sent'
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
