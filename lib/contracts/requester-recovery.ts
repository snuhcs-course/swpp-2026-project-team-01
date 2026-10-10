import {z} from 'zod';
export const recoveryStart=z.strictObject({requestId:z.uuid(),email:z.email().max(254).transform(v=>v.toLowerCase()),idempotencyKey:z.uuid()});
export const recoveryRedeem=z.strictObject({requestId:z.uuid(),challengeId:z.uuid(),proof:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)});
export const recoveryAccepted=z.strictObject({status:z.literal('accepted')});
export const recoveryResult=z.strictObject({status:z.literal('recovered'),requestId:z.uuid(),expiresAt:z.iso.datetime({offset:true})});
