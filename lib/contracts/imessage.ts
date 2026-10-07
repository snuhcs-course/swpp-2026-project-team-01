import {z} from 'zod';

export const phoneNumber=z.string().regex(/^\+[1-9][0-9]{7,14}$/u);
export const linkStartInput=z.strictObject({phone:phoneNumber,idempotencyKey:z.uuid()});
export const linkVerifyInput=z.strictObject({challengeId:z.uuid(),code:z.string().regex(/^\d{6}$/u),idempotencyKey:z.uuid()});
export const linkCancelInput=z.strictObject({challengeId:z.uuid()});
export const linkUnlinkInput=z.strictObject({linkId:z.uuid()});
export const imessageState=z.object({
 available:z.boolean(),skipped:z.boolean(),
 link:z.object({id:z.uuid(),maskedPhone:z.string(),linkedAt:z.string()}).nullable(),
 challenge:z.object({id:z.uuid(),maskedPhone:z.string(),expiresAt:z.string(),retryAfter:z.string(),remainingAttempts:z.number().int().min(0).max(5),
  sameBrowser:z.boolean(),status:z.enum(['prepared','uncertain','accepted','delivered','failed','revoked','expired','locked'])}).nullable(),
 outcome:z.enum(['invalid_code','linked']).optional(),
});
export type IMessageState=z.infer<typeof imessageState>;
