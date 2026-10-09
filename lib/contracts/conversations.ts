import { z } from 'zod';

export const conversationAudience = z.enum(['host_setup', 'host_private', 'request_shared']);
// Logical history spans retained runtimes; accept safe integer positions only.
export const conversationCursor=z.string().regex(/^\d{1,16}$/u).transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
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

export const incomingMessage = z.strictObject({ clientId:z.uuid(), text:z.string().min(1).max(10_000).refine(v=>v.trim().length>0) });
export const messageReceipt = z.object({ messageId:z.uuid(), status:z.enum(['pending','completed','failed']) });
export const conversationSnapshot = conversationView.extend({messages:z.array(z.object({
  id:z.uuid(),text:z.string(),status:z.enum(['pending','completed','failed']),createdAt:z.string(),mine:z.boolean(),
}))});
export type ConversationSnapshot = z.infer<typeof conversationSnapshot>;

const position={cursor:z.number().int().positive(),id:z.string().optional(),turnId:z.string().optional(),stepIndex:z.number().int().optional(),sequence:z.number().int().optional()};
export const conversationEvent=z.discriminatedUnion('type',[
  z.object({...position,type:z.enum(['user','text','message']),text:z.string()}),
  z.object({...position,type:z.enum(['cursor','turn.started','step.started','turn.completed','turn.cancelled','session.waiting','session.completed'])}),
  z.object({...position,type:z.literal('failed'),message:z.literal('The response could not be completed. Your saved changes are preserved.').optional()}),
  z.object({type:z.literal('error'),error:z.object({code:z.string(),message:z.string()})}),
]);
export type ConversationEvent=z.infer<typeof conversationEvent>;
