import {z} from 'zod';
export const requestLifecycleTarget=z.strictObject({requestId:z.uuid()});
export const requestClosure=requestLifecycleTarget.extend({revision:z.number().int().positive(),confirmed:z.literal(true),idempotencyKey:z.uuid()});
export const requestLifecycleState=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),status:z.enum(['gathering','negotiating','awaiting_approval','booking','booked','declined','withdrawn','expired']),closed:z.boolean(),canWithdraw:z.boolean(),canDecline:z.boolean()});
export type RequestLifecycleState=z.infer<typeof requestLifecycleState>;
