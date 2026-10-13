import {createHash} from 'node:crypto';
import {z} from 'zod';
import {schedulingInterval} from '../../contracts/interval-feasibility.ts';
import {setupRules} from '../../contracts/setup.ts';
import {preferenceEvaluation,verifiedPreferenceDecision,type PreferenceEvaluation,type VerifiedPreferenceDecision} from '../../contracts/preference-decision.ts';
const inputSchema=z.strictObject({basis:z.string().regex(/^[a-f0-9]{64}$/u),candidate:schedulingInterval,details:z.object({mode:z.string().optional(),location:z.string().optional()}),rules:setupRules.pick({meetingMode:true,locationPolicy:true,locations:true,preferences:true}).strip()});
/** No model interprets free-form policy into permission. The host explicitly
 * reviews applicability/classification or makes a private preference exception. */
export function evaluatePreferences(raw:z.input<typeof inputSchema>,decisions:VerifiedPreferenceDecision[]=[]):PreferenceEvaluation{
 const input=inputSchema.parse(raw),{details,rules}=input;
 const contextFingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const knownMode=details.mode==='online'||details.mode==='in_person';
 const outcomes={meeting_mode:knownMode&&(rules.meetingMode==='either'||rules.meetingMode===details.mode),
  location:knownMode&&(details.mode==='online'||rules.locationPolicy==='per_meeting'||rules.locations.some(l=>l.normalize('NFC').trim()===details.location?.normalize('NFC').trim())),additional:rules.preferences.trim()===''};
 const current=decisions.map(d=>verifiedPreferenceDecision.parse(d)).filter(d=>d.contextFingerprint===contextFingerprint);
 const checks=(['meeting_mode','location','additional'] as const).map(key=>{
  if(outcomes[key])return {key,status:'satisfied' as const};
  // A preference decision cannot fill missing shared meeting details.
  const decision=knownMode&&(details.mode!=='in_person'||Boolean(details.location?.trim()))?current.find(d=>d.key===key):undefined;
  return decision?{key,status:decision.decision,decisionId:decision.id}:{key,status:'unresolved' as const};
 });
 return preferenceEvaluation.parse({contextFingerprint,status:checks.some(c=>c.status==='unresolved')?'requires_confirmation':'satisfied',checks});
}
