import {z} from 'zod';
import {publicHandle,intakeProof} from './intake.ts';
export const requesterIdentityTarget=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('intake'),handle:publicHandle}),
 z.strictObject({kind:z.literal('guest'),requestId:z.uuid()}),
]);
export const identityDraft=z.strictObject({
 requesterName:z.string().max(200).default(''),requesterEmail:z.string().max(254).default(''),
 purpose:z.string().max(5000).default(''),timezone:z.string().max(100).default(''),
 durationMinutes:z.number().int().min(5).max(240).optional(),
});
export const identityStart=z.strictObject({draft:identityDraft,revision:z.number().int().positive().optional()});
export const identityProfile=z.object({name:z.string().nullable(),email:z.email(),contactVerified:z.boolean()});
export const requesterIdentityState=z.object({draft:identityDraft,identity:identityProfile.nullable()}).nullable();
export const identityApply=z.strictObject({revision:z.number().int().positive(),email:z.string().trim().toLowerCase().pipe(z.email().max(254))});
export const identityCallback=z.strictObject({state:intakeProof,binding:intakeProof,code:z.string().min(1).max(4096).nullable(),denied:z.boolean()});
