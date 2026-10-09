import { z } from 'zod';
import { Database } from '../database/client.ts';
import { formatPhotonReply } from '../photon/reply-text.ts';
import { ApplicationError } from '../errors.ts';
import type { ConversationGrant } from './conversations.ts';
import {generationTimeline} from './generation-history.ts';

import { incomingMessage } from '../../contracts/conversations.ts';
export { incomingMessage } from '../../contracts/conversations.ts';
const receipt = z.object({ id: z.uuid(), text: z.string(), status: z.enum(['pending', 'completed', 'failed']) });
export const runtimeAuth = z.object({
  authenticator: z.literal('fmat-conversation'), principalType: z.literal('user'), principalId: z.uuid(),
  attributes: z.object({ conversationId: z.uuid(), messageId: z.uuid() }),
});
export type RuntimeAuth = z.infer<typeof runtimeAuth>;
export const runtimeSnapshot = z.object({ sessionId: z.string().nullable(), messages: z.array(z.object({
  id: z.uuid(), text: z.string(), status: z.enum(['pending','completed','failed']), createdAt: z.string(), mine: z.boolean(),
})) });

export class RuntimeMessages {
  constructor(private readonly database = new Database()) {}
  async accept(grant: ConversationGrant, input: unknown) {
    const parsed = incomingMessage.safeParse(input);
    if (!parsed.success) throw new ApplicationError('INVALID_INPUT', 400);
    return receipt.parse(await this.database.rpc('fmat_runtime_message', {
      p_operation: 'accept', p_grant_id: grant.grantId, p_conversation_id: grant.conversationId, p_input: parsed.data,
    }));
  }
  async inspect(grant: ConversationGrant) {
    return runtimeSnapshot.parse(await this.database.rpc('fmat_runtime_message', {
      p_operation: 'inspect', p_grant_id: grant.grantId, p_conversation_id: grant.conversationId, p_input: {},
    }));
  }
  async history(grant:ConversationGrant) {
    const parsed=generationTimeline.safeParse(await this.database.rpc('fmat_runtime_message',{
      p_operation:'history',p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_input:{},
    }));
    if(!parsed.success||parsed.data.conversationId!==grant.conversationId||parsed.data.audience!==grant.audience)
      throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
    return parsed.data;
  }
  async deliver(auth: RuntimeAuth, sessionId: string) {
    return receipt.parse(await this.database.rpc('fmat_runtime_message', {
      p_operation: 'deliver', p_grant_id: auth.principalId, p_conversation_id: auth.attributes.conversationId,
      p_input: { messageId: auth.attributes.messageId, sessionId },
    }));
  }
  async settle(auth: RuntimeAuth, sessionId: string, status: 'completed' | 'failed', reply?: string) {
    await this.database.rpc('fmat_runtime_message', {
      p_operation: 'settle', p_grant_id: auth.principalId, p_conversation_id: auth.attributes.conversationId,
      p_input: { messageId: auth.attributes.messageId, sessionId, status, ...(reply?{reply:formatPhotonReply(reply)}:{}) },
    });
  }
}
