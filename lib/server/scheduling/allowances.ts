import {Temporal} from '@js-temporal/polyfill';
import {confirmTravelAllowance,revokeTravelAllowance,travelAllowanceReceipt} from '../../contracts/travel-allowance.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {candidateEvidence} from './evidence.ts';
import {travelLegFingerprint} from './travel.ts';

export class TravelAllowances {
 constructor(private readonly database=new Database()){}
 private call(operation:string,credential:Credential,input:unknown){requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);return this.database.rpc('fmat_travel_allowance',{p_operation:operation,p_credential:credential,p_input:input});}
 async confirm(credential:Credential,input:unknown){
  const value=confirmTravelAllowance.parse(input);
  // The database owns replay identity. A lost response must not require a new
  // provider evaluation or a second host decision.
  const replay=await this.call('replay',credential,value);if(replay)return travelAllowanceReceipt.parse(replay);
  try{
  const evidence=candidateEvidence.parse(await this.call('evidence',credential,value));
  const context=evidence.travelContext,allowance=value.allowance,leg=evidence.travel?.legs.find(l=>l.direction===allowance.direction);
  if(evidence.interval!=='fits'||!context||context.meetingMode!=='in_person'||!context.location||!leg||leg.status!=='clarification')throw new ApplicationError('INVALID_INPUT',400);
  if(leg.contextFingerprint!==travelLegFingerprint(context,allowance.direction))throw new ApplicationError('STALE_REVISION',409);
  const neighbor=allowance.direction==='inbound'?context.previous:context.next;
  if(neighbor.kind==='none')throw new ApplicationError('INVALID_INPUT',400);
  if(neighbor.kind==='commitment'){
   const boundary=allowance.direction==='inbound'?neighbor.interval.end:neighbor.interval.start;
   const pastOrigin=allowance.direction==='inbound'&&Temporal.Instant.from(boundary).epochNanoseconds+BigInt(context.bufferMinutes)*60_000_000_000n<BigInt(Date.now())*1_000_000n;
   if(pastOrigin){
    if(Temporal.Instant.from(allowance.boundary.at).epochNanoseconds<BigInt(Date.now())*1_000_000n||Temporal.Instant.compare(allowance.boundary.at,boundary)<0)throw new ApplicationError('INVALID_INPUT',400);
   }else if(Temporal.Instant.compare(boundary,allowance.boundary.at)!==0||neighbor.location&&JSON.stringify(neighbor.location)!==JSON.stringify(allowance.boundary.location))throw new ApplicationError('INVALID_INPUT',400);
  }
  // Confirming an allowance records the host's input, not a feasibility claim.
  // The next complete evaluation rechecks interval, both gaps and buffers.
  return travelAllowanceReceipt.parse(await this.call('confirm',credential,value));
  }catch(error){
   if(error instanceof ApplicationError&&error.code==='STALE_REVISION'){const retry=await this.call('replay',credential,value);if(retry)return travelAllowanceReceipt.parse(retry);}
   throw error;
  }
 }
 async revoke(credential:Credential,input:unknown){return travelAllowanceReceipt.parse(await this.call('revoke',credential,revokeTravelAllowance.parse(input)));}
}
