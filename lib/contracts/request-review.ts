import {z} from 'zod';
import {requestDetails} from './conversation-tools.ts';
const details=requestDetails.extend({durationMinutes:z.number().int().min(5).max(240).nullable()}).partial();
export const requestReview=z.strictObject({
  id:z.uuid(),baseRevision:z.number().int().nonnegative(),patch:details,details,
  clarifications:z.array(z.string().max(500)).max(10),status:z.enum(['pending','applied','dismissed','superseded']),resultRevision:z.number().int().nullable(),
});
export const requestReviewState=z.strictObject({revision:z.number().int(),details,review:requestReview.nullable()});
export const requestReviewDecision=z.strictObject({reviewId:z.uuid(),expectedRevision:z.number().int().nonnegative(),confirmed:z.literal(true),idempotencyKey:z.uuid()});
export type RequestReviewState=z.infer<typeof requestReviewState>;
