import {z} from 'zod';
export const emailLinkTarget=z.strictObject({requestId:z.uuid()});
export const emailLinkStart=emailLinkTarget.extend({revision:z.number().int().positive(),idempotencyKey:z.uuid()});
export const emailLinkRevoke=emailLinkTarget.extend({linkId:z.uuid()});
export const emailLinkState=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),email:z.email().nullable(),status:z.enum(['unavailable','unlinked','pending','linked','revoked','expired']),linkId:z.uuid().nullable(),inboxId:z.email().nullable(),expiresAt:z.string().nullable(),linkingText:z.string().nullable()});
export type EmailLinkState=z.infer<typeof emailLinkState>;
