import {z} from 'zod';
import {publicHandle} from './handles.ts';
const minute=z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/u);
export const weeklyWindow=z.strictObject({days:z.array(z.number().int().min(0).max(6)).min(1).max(7),start:minute,end:minute}).refine(v=>v.start<v.end,'End must follow start.');
const instantWindow=z.strictObject({start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true})}).refine(v=>Date.parse(v.start)<Date.parse(v.end));
export const setupRules=z.strictObject({
 timezone:z.string().min(1).max(100),durationMinutes:z.number().int().min(5).max(240),availability:z.array(weeklyWindow).min(1).max(21),focusBlocks:z.array(instantWindow).max(100),bufferMinutes:z.number().int().min(0).max(240),
 travelMode:z.enum(['DRIVE','TRANSIT','WALK','BICYCLE','PER_TRIP','NONE']),homeLocation:z.string().max(2000).optional(),preferences:z.string().max(5000),
 meetingMode:z.enum(['online','in_person','either']),locationPolicy:z.enum(['per_meeting','preferred']),locations:z.array(z.string().trim().min(1).max(500)).max(10),travelBufferMinutes:z.number().int().min(0).max(240),
});
export const setupPatch=z.strictObject({handle:publicHandle.optional(),displayName:z.string().trim().min(1).max(120).optional(),rules:setupRules.partial().optional()}).refine(v=>Object.keys(v).length>0,'Supply at least one preference.');
export const draftInput=z.strictObject({expectedRevision:z.number().int().nonnegative(),patch:setupPatch,unresolved:z.array(z.string().trim().min(1).max(200)).max(20)});
export const starterField=z.enum(['timezone','durationMinutes','availability','bufferMinutes','focusBlocks','preferences','meetingMode','travelBufferMinutes']);
export const browserDraftInput=draftInput.extend({idempotencyKey:z.uuid(),starterFields:z.array(starterField).max(8).refine(v=>new Set(v).size===v.length).optional()});
export const setupProgressInput=z.strictObject({expectedRevision:z.number().int().nonnegative(),choice:z.enum(['skip_analysis','dismiss_schedule','dismiss_mode','offer_schedule','offer_mode']),idempotencyKey:z.uuid()});
export const rebaseSetupInput=z.strictObject({expectedRevision:z.number().int().nonnegative(),rulesVersion:z.number().int().nonnegative(),idempotencyKey:z.uuid()});
export const confirmSetupInput=z.strictObject({expectedRevision:z.number().int().nonnegative(),draftRevision:z.number().int().positive(),reviewRevision:z.number().int().positive(),rulesVersion:z.number().int().nonnegative(),calendarGeneration:z.uuid(),confirmed:z.literal(true),idempotencyKey:z.uuid()});
export const preferenceOrigin=z.object({source:z.enum(['host','assistant','confirmed','calendar','calendar_edited','starter']),scanId:z.uuid().optional(),startDate:z.iso.date().optional(),endDate:z.iso.date().optional(),timezone:z.string().optional()});
const settings=z.object({handle:z.string().nullable().optional(),displayName:z.string().nullable().optional(),rules:setupRules.partial().nullable().optional()});
export const setupState=z.object({analysisStatus:z.enum(['running','ready','failed','stale','expired','dismissed','applied']).nullable().default(null),progress:z.object({analysisDecided:z.boolean(),dismissedSuggestions:z.array(z.enum(['schedule','mode']))}).default({analysisDecided:false,dismissedSuggestions:[]}),revision:z.number().int().nonnegative(),rulesVersion:z.number().int().nonnegative(),calendarGeneration:z.uuid().nullable(),calendarSelected:z.boolean(),confirmed:settings,
 draft:z.object({revision:z.number().int().positive(),baseRulesVersion:z.number().int().nonnegative(),settings,origins:z.record(z.string(),preferenceOrigin).default({}),provenance:z.record(z.string(),z.enum(['host','assistant','confirmed'])),unresolved:z.array(z.string()),clarifications:z.array(z.string()),status:z.enum(['active','superseded','confirmed'])}).nullable(),
 review:z.object({revision:z.number().int().positive(),draftRevision:z.number().int().positive(),settings,status:z.enum(['pending','confirmed','superseded'])}).nullable(),nextAction:z.string()});
export type SetupState=z.infer<typeof setupState>;
export type SetupPatch=z.infer<typeof setupPatch>;
export const setupReadiness=z.discriminatedUnion('ready',[
 z.strictObject({ready:z.literal(false),reason:z.enum(['setup','calendar'])}),
 z.strictObject({ready:z.literal(true),handle:publicHandle}),
]);
export type SetupReadiness=z.infer<typeof setupReadiness>;
