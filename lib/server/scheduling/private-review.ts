import {z} from 'zod';
import {Temporal} from '@js-temporal/polyfill';
import {privateReviewTarget,privateReviewCheck,privateReviewState,type PrivateReviewCandidate} from '../../contracts/private-review.ts';
import {routeMode} from '../../contracts/travel.ts';
import {candidateEvidence} from './evidence.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {AvailabilityEvaluation} from './availability.ts';
const rawState=privateReviewState.omit({candidates:true}).extend({evaluations:z.array(z.strictObject({id:z.uuid(),expiresAt:z.string(),status:z.enum(['checks_passed','conflict','clarification']),evidence:candidateEvidence})).max(12)});
export class PrivateReview {
 constructor(private readonly database=new Database(),private readonly evaluation=new AvailabilityEvaluation(database)){}
 private authorize(credential:Credential){requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);}
 private async call(operation:'read'|'complete',credential:Credential,input:unknown){
  this.authorize(credential);const {evaluations,...state}=rawState.parse(await this.database.rpc('fmat_private_review',{p_operation:operation,p_credential:credential,p_input:input}));
  const now=BigInt(Date.now())*1_000_000n;
  const candidates:PrivateReviewCandidate[]=evaluations.map(({id,status,expiresAt,evidence:e})=>({id,status,expiresAt,interval:e.candidate,intervalStatus:e.interval,preferences:e.preferences==='pending'?null:{status:e.preferences.status,checks:e.preferences.checks},canConfirmPreferences:e.interval==='fits'&&e.travel?.status==='fits',travel:(e.travel?.legs??[]).map(leg=>{
   const context=e.travelContext,neighbor=leg.direction==='inbound'?context?.previous:context?.next;
   const at=neighbor?.kind==='commitment'?(leg.direction==='inbound'?neighbor.interval.end:neighbor.interval.start):null;
   const past=leg.direction==='inbound'&&at!==null&&Temporal.Instant.from(at).epochNanoseconds+BigInt(context?.bufferMinutes??0)*60_000_000_000n<now;
   const fixed=neighbor?.kind==='commitment'&&!past;
   return {direction:leg.direction,status:leg.status,reason:leg.reason??null,canConfirm:e.interval==='fits'&&context?.meetingMode==='in_person'&&!!context.location&&neighbor?.kind!=='none'&&leg.status==='clarification',boundary:{at:fixed?at:null,location:fixed?neighbor.location:null,timeLocked:fixed,locationLocked:fixed&&!!neighbor.location},mode:routeMode.safeParse(context?.mode).success?routeMode.parse(context!.mode):null};
  })}));
  return privateReviewState.parse({...state,candidates});
 }
 read(credential:Credential,input:unknown){return this.call('read',credential,privateReviewTarget.parse(input));}
 async evaluate(credential:Credential,input:unknown){
  this.authorize(credential);const target=privateReviewCheck.parse(input);
  const state=await this.read(credential,{requestId:target.requestId});
  if(state.revision!==target.revision)throw new ApplicationError('STALE_REVISION',409);
  if(!state.detailsComplete)throw new ApplicationError('INVALID_INPUT',400);
  const result=target.candidate?await this.evaluation.read(credential,target):await this.evaluation.batch(credential,{...target,sampling:{stepMinutes:15,limit:12}});
  return this.call('complete',credential,{requestId:target.requestId,revision:target.revision,checkId:result.context.checkId,basis:result.context.basis,truncated:result.truncated});
 }
}
