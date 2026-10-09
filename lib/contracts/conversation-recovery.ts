import {z} from 'zod';

// The route selects the authorized logical conversation. Neither runtime IDs
// nor evidence of termination can come from the browser.
const generation=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const conversationRecoveryInput=z.strictObject({
 expectedGeneration:generation,
 idempotencyKey:z.uuid(),
});

const scope={conversationId:z.uuid(),generation};
export const conversationRecoveryStatus=z.discriminatedUnion('state',[
 z.strictObject({...scope,state:z.literal('active')}),
 z.strictObject({...scope,state:z.literal('recovery_required')}),
 z.strictObject({...scope,state:z.literal('recovering'),recoveryId:z.uuid()}),
 z.strictObject({...scope,state:z.literal('unavailable')}),
 z.strictObject({...scope,state:z.literal('limit_reached')}),
]);
export type ConversationRecoveryInput=z.infer<typeof conversationRecoveryInput>;
export type ConversationRecoveryStatus=z.infer<typeof conversationRecoveryStatus>;
