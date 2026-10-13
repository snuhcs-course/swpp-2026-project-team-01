import {z} from 'zod';
export const contactTarget=z.strictObject({requestId:z.uuid()});
export const contactStart=contactTarget.extend({revision:z.number().int().positive(),email:z.email(),idempotencyKey:z.uuid()});
export const contactConfirm=contactTarget.extend({challengeId:z.uuid(),code:z.string().regex(/^[0-9]{6}$/),idempotencyKey:z.uuid()});
export const contactState=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),email:z.email().nullable(),status:z.enum(['unverified','pending','verified','locked','expired','superseded']),challengeId:z.uuid().nullable(),expiresAt:z.string().nullable(),attemptsRemaining:z.number().int().min(0).max(5),nextSendAt:z.string().nullable(),deliveryStatus:z.enum(['pending','sending','sent','failed','uncertain','suppressed']).nullable()});
export const contactResult=z.strictObject({outcome:z.enum(['created','already_verified','verified','invalid_code','locked','expired','superseded']),state:contactState});
export type ContactState=z.infer<typeof contactState>;
