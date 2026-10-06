import { z } from 'zod';

export const conversationAudience = z.enum(['host_setup', 'host_private', 'request_shared']);
export const openConversation = z.discriminatedUnion('audience', [
  z.strictObject({ audience: z.literal('host_setup') }),
  z.strictObject({ audience: z.literal('host_private'), requestId: z.uuid() }),
  z.strictObject({ audience: z.literal('request_shared'), requestId: z.uuid() }),
]);
// Execution grant IDs are deliberately absent from the browser projection.
export const conversationView = z.object({
  conversationId: z.uuid(), audience: conversationAudience, hostId: z.uuid(),
  requestId: z.uuid().nullable(), readOnly: z.boolean(),
});
export type ConversationView = z.infer<typeof conversationView>;
