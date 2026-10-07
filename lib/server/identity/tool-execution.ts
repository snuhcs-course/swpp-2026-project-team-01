import { createHash } from 'node:crypto';
import { z } from 'zod';
import {setupGuide} from '../../contracts/setup-guide.ts';
import {setupState} from '../../contracts/setup.ts';
import { conversationTool } from '../../contracts/conversation-tools.ts';
import { Database } from '../database/client.ts';
import { ApplicationError } from '../errors.ts';
import { runtimeAuth } from './runtime-messages.ts';

const callIdentity = z.strictObject({
  sessionId: z.string().min(1).max(200), callId: z.string().min(1).max(200),
});

/** Only pass the current caller from eve's server-owned runtime context here.
 * Never accept this snapshot as browser authentication or use the initiator of
 * a shared session. The RPC revalidates the grant and executes atomically. */
export class ConversationTools {
  constructor(private readonly database = new Database()) {}

  async execute(currentAuth: unknown, call: unknown, command: unknown): Promise<unknown> {
    const auth = runtimeAuth.safeParse(currentAuth);
    if (!auth.success) throw new ApplicationError('UNAUTHORIZED', 401);
    const identity = callIdentity.safeParse(call);
    const parsed = conversationTool.safeParse(command);
    if (!identity.success || !parsed.success) throw new ApplicationError('INVALID_INPUT', 400);
    const { operation, input } = parsed.data;
    // An interrupted model step can regenerate different call IDs. Permit one
    // mutation of each kind per accepted message; retries use that same key,
    // even if the model changes its call ID or re-reads a newer revision.
    const idempotencyKey = 'eve:' + createHash('sha256').update(JSON.stringify([
      auth.data.attributes.conversationId, auth.data.attributes.messageId, operation,
    ])).digest('hex');
    const result=await this.database.rpc('fmat_conversation_tool', {
      p_grant_id: auth.data.principalId, p_conversation_id: auth.data.attributes.conversationId,
      p_operation: operation,
      p_input: operation.endsWith('_read') ? input : { ...input, idempotencyKey },
    });
    if(operation==='setup_read'){const state=setupState.parse(result);return {...state,guide:setupGuide(state)};}
    return result;
  }
}
