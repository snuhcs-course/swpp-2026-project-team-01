import {z} from 'zod';
import {routeLocation,routeMode,travelInstant} from './travel.ts';
export const travelAllowanceValue=z.strictObject({direction:z.enum(['inbound','outbound']),durationMinutes:z.number().int().min(1).max(1440),mode:routeMode,
 // For unknown neighbors, the host explicitly supplies the prior available
 // endpoint/time or next required endpoint/time. Known context must match.
 boundary:z.strictObject({at:travelInstant,location:routeLocation}),reason:z.string().trim().min(1).max(2000)});
export const confirmTravelAllowance=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),evaluationId:z.uuid(),confirmed:z.literal(true),idempotencyKey:z.uuid(),allowance:travelAllowanceValue});
export const revokeTravelAllowance=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),allowanceId:z.uuid(),idempotencyKey:z.uuid()});
export const travelAllowanceReceipt=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),allowanceId:z.uuid(),revoked:z.boolean(),complete:z.literal(false)});
export const verifiedTravelAllowance=travelAllowanceValue.extend({id:z.uuid(),contextFingerprint:z.string().regex(/^[a-f0-9]{64}$/u)});
export type VerifiedTravelAllowance=z.infer<typeof verifiedTravelAllowance>;
