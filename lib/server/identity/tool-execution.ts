import { createHash } from 'node:crypto';
import { z } from 'zod';
import { conversationTool } from '../../contracts/conversation-tools.ts';
import { Database } from '../database/client.ts';
import { ApplicationError } from '../errors.ts';

const executionAuth = z.object({
  authenticator: z.literal('fmat-conversation'), principalType: z.literal('user'),
  principalId: z.uuid(), attributes: z.object({ conversationId: z.uuid() }),
});
const callIdentity = z.strictObject({
  sessionId: z.string().min(1).max(200), callId: z.string().min(1).max(200),
});

/** Only pass the current caller from eve's server-owned runtime context here.
 * Never accept this snapshot as browser authentication or use the initiator of
 * a shared session. The RPC revalidates the grant and executes atomically. */
export class ConversationTools {
  constructor(private readonly database = new Database()) {}

  async execute(currentAuth: unknown, call: unknown, command: unknown): Promise<unknown> {
    const auth = executionAuth.safeParse(currentAuth);
    if (!auth.success) throw new ApplicationError('UNAUTHORIZED', 401);
    const identity = callIdentity.safeParse(call);
    const parsed = conversationTool.safeParse(command);
    if (!identity.success || !parsed.success) throw new ApplicationError('INVALID_INPUT', 400);
    const { operation, input } = parsed.data;
    // The model cannot choose a fresh retry key. A replay of the same durable
    // call uses the same key; changed arguments fail the database fingerprint.
    const idempotencyKey = 'eve:' + createHash('sha256').update(JSON.stringify([
      auth.data.attributes.conversationId, identity.data.sessionId, identity.data.callId,
    ])).digest('hex');
    return this.database.rpc('fmat_conversation_tool', {
      p_grant_id: auth.data.principalId, p_conversation_id: auth.data.attributes.conversationId,
      p_operation: operation,
      p_input: operation.endsWith('_read') ? input : { ...input, idempotencyKey },
    });
  }
}
