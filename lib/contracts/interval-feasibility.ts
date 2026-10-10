import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
import {ianaTimezone} from './time.ts';
import {weeklyWindow} from './setup.ts';
const instant=z.iso.datetime({offset:true}).refine(value=>{try{Temporal.Instant.from(value);return true;}catch{return false;}});
export const schedulingInterval=z.strictObject({start:instant,end:instant}).refine(value=>Temporal.Instant.compare(value.start,value.end)<0,'End must follow start.');
const ranges=z.array(schedulingInterval).max(10000);
const requestedWindows=z.array(schedulingInterval).min(1).max(30).refine(values=>values.every(value=>Temporal.Instant.from(value.end).epochNanoseconds-Temporal.Instant.from(value.start).epochNanoseconds<=31n*86400n*1000000000n),'Each window must be at most 31 days.');
// Every provider-derived list is explicit. Missing/failed data cannot default
// to an empty calendar; adapters must obtain complete coverage before calling.
export const intervalFeasibilityInput=z.strictObject({
 now:instant,requesterTimezone:ianaTimezone,durationMinutes:z.number().int().min(5).max(240),
 windows:requestedWindows,requesterAvailability:ranges,requesterBusy:ranges,hostBusy:ranges,
 rules:z.strictObject({timezone:ianaTimezone,availability:z.array(weeklyWindow).min(1).max(21),focusBlocks:z.array(schedulingInterval).max(100),bufferMinutes:z.number().int().min(0).max(240)}),
});
export type IntervalFeasibilityInput=z.infer<typeof intervalFeasibilityInput>;
export type SchedulingInterval=z.infer<typeof schedulingInterval>;
