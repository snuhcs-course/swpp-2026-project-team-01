import {z} from 'zod';
import {weeklyWindow} from './setup.ts';
export const analysisScope=z.strictObject({calendarIds:z.array(z.string().min(1).max(1024)).min(1).max(10).refine(v=>new Set(v).size===v.length),startDate:z.iso.date(),endDate:z.iso.date(),timezone:z.string().min(1).max(100)});
export const analysisInput=analysisScope.extend({expectedRevision:z.number().int().nonnegative(),rulesVersion:z.number().int().nonnegative(),generation:z.uuid(),consented:z.literal(true),idempotencyKey:z.uuid()});
export const analysisSummary=z.strictObject({eventCount:z.number().int().nonnegative(),busyCount:z.number().int().nonnegative(),days:z.number().int().min(14).max(56),windowSource:z.enum(['calendar','starter','none']),windows:z.array(weeklyWindow).max(7),onlineCount:z.number().int().nonnegative(),physicalCount:z.number().int().nonnegative(),locations:z.array(z.strictObject({label:z.string().max(500),count:z.number().int().min(2)})).max(5),limitations:z.array(z.enum(['sparse','missing_locations','mixed_timezones','no_pattern'])).max(4)});
export const analysisState=z.object({scan:z.object({id:z.uuid(),status:z.enum(['running','ready','failed','stale','expired','dismissed','applied']),scope:analysisScope,revision:z.number().int(),expiresAt:z.string(),summary:analysisSummary.nullable()}).nullable()});
export const analysisDecision=z.strictObject({scanId:z.uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.uuid()});
export type AnalysisScope=z.infer<typeof analysisScope>;
export type AnalysisSummary=z.infer<typeof analysisSummary>;
export type AnalysisState=z.infer<typeof analysisState>;

const selectedPlace=z.strictObject({index:z.number().int().min(0).max(4).optional(),label:z.string().trim().min(1).max(500)});
export const analysisApplication=analysisDecision.extend({
 schedule:z.boolean().optional(),windows:z.array(weeklyWindow).min(1).max(21).optional(),meetingMode:z.enum(['online','in_person','either']).optional(),
 location:z.discriminatedUnion('policy',[
  z.strictObject({policy:z.literal('per_meeting')}),
  z.strictObject({policy:z.literal('preferred'),places:z.array(selectedPlace).min(1).max(10).refine(values=>new Set(values.map(v=>v.label)).size===values.length,'Choose each place once.').refine(values=>{const indices=values.flatMap(v=>v.index===undefined?[]:[v.index]);return new Set(indices).size===indices.length;},'Choose each candidate once.')}),
 ]).optional(),
}).refine(v=>v.schedule!==false||v.windows===undefined,'Window edits require schedule application.').refine(v=>v.meetingMode!=='online'||v.location===undefined,'Online meetings do not use physical places.');
export type AnalysisApplication=z.infer<typeof analysisApplication>;
