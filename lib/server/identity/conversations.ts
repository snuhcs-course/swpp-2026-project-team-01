import { z } from 'zod';
import { conversationView, openConversation } from '../../contracts/conversations.ts';
import { Database } from '../database/client.ts';
import { ApplicationError } from '../errors.ts';
import { requireCredential, type Credential } from './credentials.ts';

const grantSchema = conversationView.extend({
  grantId: z.uuid(), actorKind: z.enum(['host', 'guest']), expiresAt: z.iso.datetime({ offset: true }),
});
export type ConversationGrant = z.infer<typeof grantSchema>;
function decodeGrant(data: unknown): ConversationGrant {
  const result = grantSchema.safeParse(data);
  if (!result.success) throw new ApplicationError('PROVIDER_UNAVAILABLE', 503);
  return result.data;
}
export class Conversations {
  constructor(private readonly database = new Database()) {}

  async open(credential: Credential, input: unknown): Promise<ConversationGrant> {
    requireCredential(credential);
    const parsed = openConversation.safeParse(input);
    if (!parsed.success) throw new ApplicationError('INVALID_INPUT', 400);
    return decodeGrant(await this.database.rpc('fmat_conversation_access', {
      p_operation: 'open', p_credential: credential, p_input: parsed.data,
    }));
  }
  async authorize(credential: Credential, conversationId: string): Promise<ConversationGrant> {
    requireCredential(credential);
    if (!z.uuid().safeParse(conversationId).success) throw new ApplicationError('NOT_FOUND', 404);
    return decodeGrant(await this.database.rpc('fmat_conversation_access', {
      p_operation: 'authorize', p_credential: credential, p_input: { conversationId },
    }));
  }
  async revoke(credential: Credential, conversationId: string): Promise<void> {
    requireCredential(credential);
    if (!z.uuid().safeParse(conversationId).success) throw new ApplicationError('NOT_FOUND', 404);
    await this.database.rpc('fmat_conversation_access', {
      p_operation: 'revoke', p_credential: credential, p_input: { conversationId },
    });
  }
  // Internal execution check only. Public routes must authorize a credential.
  async checkExecution(grantId: string, conversationId: string): Promise<ConversationGrant> {
    if (![grantId, conversationId].every(id => z.uuid().safeParse(id).success)) throw new ApplicationError('UNAUTHORIZED', 401);
    return decodeGrant(await this.database.rpc('fmat_conversation_check', {
      p_grant_id: grantId, p_conversation_id: conversationId,
    }));
  }
}
