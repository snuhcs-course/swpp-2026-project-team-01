import {z} from 'zod';
import {schedulingInterval} from './interval-feasibility.ts';
export const availabilityCheckInput=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),candidate:schedulingInterval.optional()});
// This receipt is deliberately not a feasible candidate or a booking approval.
export const availabilityCheckReceipt=z.strictObject({checked:z.literal(true),revision:z.number().int().positive(),checkedAt:z.iso.datetime({offset:true}),complete:z.literal(false)});
