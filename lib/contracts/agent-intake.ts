import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
import {intakeDetails,publicHandle} from './intake.ts';
import {ianaTimezone} from './time.ts';

// These contracts do not issue credentials or enable OAuth scope acceptance.
// The authorization adapter must derive this principal from current private state.
export const agentIntakeScope='request:intake' as const;
export const agentIntakeScopes=[agentIntakeScope,'request:read','request:write','request:decide'] as const;
export type AgentIntakeScope=typeof agentIntakeScopes[number];
export type AgentIntakePrincipal=Readonly<{
 actorKind:'intake';intakeId:string;grantId:string;clientId:string;hostId:string;
 reservedRequestId:string;scopes:readonly AgentIntakeScope[];grantExpiresAt:string;
}&({state:'pending';createExpiresAt:string}|{state:'bound';requestId:string})>;

export const agentIntakeTarget=z.strictObject({handle:publicHandle});
const window=z.strictObject({start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true})})
 .refine(value=>{
  try{return Temporal.Instant.compare(value.start,value.end)<0;}catch{return false;}
 },'Choose an end after the start.');
export const agentIntakeDetails=z.strictObject({
 ...intakeDetails.shape,timezone:ianaTimezone,windows:z.array(window).max(30).default([]),
}).refine(value=>value.mode!=='online'||!value.location||/^https:\/\/[^\s]+$/u.test(value.location),
 {path:['location'],message:'Use an HTTPS meeting link.'});
const field=z.enum(['requesterName','requesterEmail','purpose','timezone','durationMinutes','mode','location','windows']);
const guidance={
 requesterName:'Provide the requester name (1–200 characters).',
 requesterEmail:'Provide a valid requester email address.',
 purpose:'Provide the meeting purpose (1–5000 characters).',
 timezone:'Provide an IANA timezone, such as Asia/Seoul.',
 durationMinutes:'Provide a whole-number duration from 5 to 240 minutes.',
 mode:'Choose online or in_person.',
 location:'Provide a location up to 2000 characters; online links must use HTTPS.',
 windows:'Provide at most 30 windows with explicit UTC offsets and an end after each start. Clarify ambiguous local times.',
} as const;
export const agentIntakeClarification=z.strictObject({
 status:z.literal('clarification'),fields:z.array(z.strictObject({
  field,reason:z.enum(['missing','invalid']),message:z.enum(Object.values(guidance)),
 })).min(1).max(field.options.length),
});
// No URL or proof is accepted here: protected browser continuation is a separate
// same-browser operation. Creation does not establish approval or booking.
export const agentIntakeResult=z.discriminatedUnion('status',[
 agentIntakeClarification,z.strictObject({status:z.literal('created'),requestId:z.uuid()}),
]);
export const agentIntakeCreateInput=z.strictObject({
 idempotencyKey:z.uuid(),details:z.record(z.string(),z.unknown()),
});
export type AgentIntakePreparation=
 |z.infer<typeof agentIntakeClarification>
 |{status:'ready';idempotencyKey:string;details:z.infer<typeof agentIntakeDetails>};

/** Invalid envelopes/authority fields are hard failures with no raw input in
 * the error. Missing or invalid known meeting fields receive bounded guidance.
 * Transport adapters must also enforce their normal request-byte limit. */
export function prepareAgentIntake(input:unknown):AgentIntakePreparation {
 const envelope=agentIntakeCreateInput.safeParse(input);
 if(!envelope.success)throw new Error('Invalid intake input.');
 const parsed=agentIntakeDetails.safeParse(envelope.data.details);
 if(parsed.success)return {status:'ready',idempotencyKey:envelope.data.idempotencyKey,details:parsed.data};
 if(parsed.error.issues.some(issue=>issue.code==='unrecognized_keys'))throw new Error('Invalid intake input.');
 const affected=new Set(parsed.error.issues.map(issue=>issue.path[0]));
 const fields=field.options.filter(name=>affected.has(name)).map(name=>({
  field:name,reason:envelope.data.details[name]===undefined?'missing' as const:'invalid' as const,message:guidance[name],
 }));
 if(!fields.length)throw new Error('Invalid intake input.');
 return agentIntakeClarification.parse({status:'clarification',fields});
}
