import { ApplicationError } from '../errors.ts';
import { RuntimeMessages, runtimeAuth, type RuntimeAuth } from './runtime-messages.ts';

export type DeliveryState = { seen: Record<string, 'running' | 'completed' | 'failed'>; active: RuntimeAuth | null };

// State is checkpointed with eve's turn. A database receipt alone never causes
// an input to be skipped: the runtime may have crashed before its checkpoint.
export async function deliverMessage(currentAuth: unknown, sessionId: string, address: string | undefined,
  state: DeliveryState, messages = new RuntimeMessages()) {
  const parsed = runtimeAuth.safeParse(currentAuth);
  if (!parsed.success || address !== parsed.data.attributes.conversationId) throw new ApplicationError('UNAUTHORIZED', 401);
  const auth = parsed.data;
  const message = await messages.deliver(auth, sessionId);
  const seen = state.seen[message.id];
  if (seen) {
    if (seen !== 'running') await messages.settle(auth, sessionId, seen);
    return; // Installed eve 0.71.3 treats an explicit deliver hook's void as ignored.
  }
  state.seen[message.id] = 'running'; state.active = auth;
  return { message: message.text };
}

export async function settleMessage(state: DeliveryState, sessionId: string, status: 'completed' | 'failed', messages = new RuntimeMessages()) {
  if (!state.active) return;
  state.seen[state.active.attributes.messageId] = status;
  await messages.settle(state.active, sessionId, status);
}
