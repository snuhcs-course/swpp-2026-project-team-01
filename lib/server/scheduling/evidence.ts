import {z} from 'zod';
import {schedulingInterval} from '../../contracts/interval-feasibility.ts';
import {routeRequest,travelInstant} from '../../contracts/travel.ts';
import {travelInput,type TravelInput,type TravelEvaluation} from './travel.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/u);
const estimate=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('success'),fingerprint:hash,checkedAt:travelInstant,departureTime:travelInstant,durationNanoseconds:z.string().regex(/^(0|[1-9][0-9]{0,23})$/u),distanceMeters:z.number().int().nonnegative().nullable()}),
 z.strictObject({status:z.literal('no_route'),fingerprint:hash,checkedAt:travelInstant}),
 z.strictObject({status:z.literal('unsupported'),fingerprint:hash.nullable(),checkedAt:travelInstant,reason:z.enum(['mode','departure_context','location','provider_fallback'])}),
 z.strictObject({status:z.literal('failure'),fingerprint:hash.nullable(),checkedAt:travelInstant,reason:z.enum(['invalid_input','configuration','denied','rate_limit','deadline','unavailable','malformed'])}),
]);
const leg=z.strictObject({direction:z.enum(['inbound','outbound']),contextFingerprint:hash,status:z.enum(['fits','conflict','clarification','not_required']),reason:z.enum(['unknown_neighbor','location','mode','overlap','estimate','insufficient_gap','stale_estimate','departure_context']).optional(),request:routeRequest.optional(),estimate:estimate.optional(),availableNanoseconds:z.string().regex(/^-?(0|[1-9][0-9]{0,23})$/u).optional(),manualAllowanceId:z.uuid().optional(),requiredNanoseconds:z.string().regex(/^(0|[1-9][0-9]{0,23})$/u).optional()});
const travel=z.strictObject({status:z.enum(['fits','conflict','clarification']),legs:z.array(leg).length(2)}).refine(v=>v.legs[0].direction==='inbound'&&v.legs[1].direction==='outbound').refine(v=>v.status===(v.legs.some(l=>l.status==='conflict')?'conflict':v.legs.some(l=>l.status==='clarification')?'clarification':'fits'));
// Deliberately excludes credentials, raw provider responses and event titles/descriptions.
// A passed time/travel assessment still has pending private preference checks.
export const candidateEvidence=z.strictObject({candidate:schedulingInterval,interval:z.enum(['fits','conflict','clarification']),contextFingerprint:hash.nullable(),travel:travel.nullable(),travelContext:travelInput.nullable().optional(),preferences:z.literal('pending'),complete:z.literal(false)})
 .refine(v=>v.interval==='fits'||v.travel===null)
 .refine(v=>v.travel===null||v.contextFingerprint!==null);
export type CandidateEvidence=z.infer<typeof candidateEvidence>;
export type CandidateAssessment={interval:'fits'|'conflict'|'clarification';travel:TravelEvaluation|null;contextFingerprint:string|null;travelContext?:TravelInput|null};
export const evidenceReceipt=z.strictObject({evaluationId:z.uuid(),requestId:z.uuid(),revision:z.number().int().positive(),rulesVersion:z.number().int().nonnegative(),status:z.enum(['checks_passed','conflict','clarification']),expiresAt:travelInstant,complete:z.literal(false)});
