import {z} from 'zod';

import {publicHandle} from './handles.ts';
export {publicHandle} from './handles.ts';
const timezone=z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Choose a valid timezone.');
// Partial intake is intentional: unresolved times and venue remain gathering.
// Identity/contact claims never imply verified contact or Google authority.
export const intakeDetails=z.strictObject({
 requesterName:z.string().trim().min(1).max(200),
 requesterEmail:z.string().trim().toLowerCase().pipe(z.email().max(254)),
 purpose:z.string().trim().min(1).max(5000),timezone,
 durationMinutes:z.number().int().min(5).max(240),
 mode:z.enum(['online','in_person']).optional(),location:z.string().trim().max(2000).optional(),
 windows:z.array(z.strictObject({start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true})})).max(30).default([]),
}).refine(value=>value.mode!=='online'||!value.location||/^https:\/\/[^\s]+$/u.test(value.location),{path:['location'],message:'Use an HTTPS meeting link.'});
export const publicProfile=z.object({handle:publicHandle,displayName:z.string().min(1),timezone:z.string(),durationMinutes:z.number().int()});
export type PublicProfile=z.infer<typeof publicProfile>;
export const intakeProof=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const intakeAttempt=z.string().regex(/^[0-9a-f]{64}$/u);
export const intakeContinuation=z.object({requestId:z.uuid(),tokenExpiresAt:z.iso.datetime({offset:true}),closed:z.boolean()});
export type IntakeContinuation=z.infer<typeof intakeContinuation>;
