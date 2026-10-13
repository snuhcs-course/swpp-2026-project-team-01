import {z} from 'zod';

export const handoffProof=z.strictObject({handoffId:z.uuid(),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)});
export const handoffState=z.strictObject({maskedPhone:z.string(),expiresAt:z.string()});
export const handoffStartInput=z.strictObject({idempotencyKey:z.uuid()});
export const phoneNumber=z.string().regex(/^\+[1-9][0-9]{7,14}$/u);
export const linkStartInput=z.strictObject({phone:phoneNumber,idempotencyKey:z.uuid()});
export const linkVerifyInput=z.strictObject({challengeId:z.uuid(),code:z.string().regex(/^\d{6}$/u),idempotencyKey:z.uuid()});
export const linkCancelInput=z.strictObject({challengeId:z.uuid()});
export const linkUnlinkInput=z.strictObject({linkId:z.uuid()});
export const imessageState=z.object({
 available:z.boolean(),skipped:z.boolean(),handoff:handoffState.nullable().optional(),
 link:z.object({id:z.uuid(),maskedPhone:z.string(),linkedAt:z.string()}).nullable(),
 challenge:z.object({id:z.uuid(),maskedPhone:z.string(),expiresAt:z.string(),retryAfter:z.string(),remainingAttempts:z.number().int().min(0).max(5),
  sameBrowser:z.boolean(),status:z.enum(['prepared','uncertain','accepted','delivered','failed','revoked','expired','locked'])}).nullable(),
 outcome:z.enum(['invalid_code','linked']).optional(),
});
export type IMessageState=z.infer<typeof imessageState>;

export const contactShareReadInput=z.strictObject({linkId:z.uuid()});
export const contactShareInput=contactShareReadInput.extend({idempotencyKey:z.uuid()});
export const contactShareState=z.strictObject({
 id:z.uuid(),linkId:z.uuid(),requestedAt:z.string(),
 status:z.enum(['queued','accepted','failed','revoked','uncertain']),
});
export type ContactShareState=z.infer<typeof contactShareState>;
