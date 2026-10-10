import {createHash} from 'node:crypto';
import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
import {schedulingInterval} from '../../contracts/interval-feasibility.ts';
import {routeLocation,routeMode,travelInstant,type RouteRequest,type RouteResult} from '../../contracts/travel.ts';
import {verifiedTravelAllowance,type VerifiedTravelAllowance} from '../../contracts/travel-allowance.ts';
import {routeFingerprint,type RoutesProvider} from '../routes/google.ts';
const neighbor=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('commitment'),id:z.string().min(1).max(1024),interval:schedulingInterval,location:routeLocation.nullable()}),
 z.strictObject({kind:z.literal('none')}), // Only an authorized complete read can establish absence.
 z.strictObject({kind:z.literal('unknown')}),
]);
export const travelInput=z.strictObject({contextFingerprint:z.string().regex(/^[a-f0-9]{64}$/u),candidate:schedulingInterval,meetingMode:z.enum(['online','in_person']),location:routeLocation.nullable(),previous:neighbor,next:neighbor,
 mode:z.enum(['DRIVE','TRANSIT','WALK','BICYCLE','PER_TRIP','NONE']),inboundMode:routeMode.optional(),outboundMode:routeMode.optional(),bufferMinutes:z.number().int().min(0).max(240),travelBufferMinutes:z.number().int().min(0).max(240)});
export type TravelInput=z.infer<typeof travelInput>;
export type CachedLeg={contextFingerprint:string;estimate:RouteResult};
export type TravelLeg={direction:'inbound'|'outbound';contextFingerprint:string;status:'fits'|'conflict'|'clarification'|'not_required';reason?:'unknown_neighbor'|'location'|'mode'|'overlap'|'estimate'|'insufficient_gap'|'stale_estimate'|'departure_context';request?:RouteRequest;estimate?:RouteResult;availableNanoseconds?:string;requiredNanoseconds?:string;manualAllowanceId?:string};
export type TravelEvaluation={status:'fits'|'conflict'|'clarification';legs:TravelLeg[]};
const instant=(value:string)=>Temporal.Instant.from(value).epochNanoseconds,minute=60n*1000000000n;
export function travelLegFingerprint(input:TravelInput,direction:'inbound'|'outbound'){return createHash('sha256').update(JSON.stringify({input:travelInput.parse(input),direction})).digest('hex');}
export const routeFreshnessMilliseconds=5*60*1000;
function current(result:RouteResult,request:RouteRequest,now:number){
 if(result.status!=='success'||result.fingerprint!==routeFingerprint(request)||!travelInstant.safeParse(result.checkedAt).success||!travelInstant.safeParse(result.departureTime).success||!/^(0|[1-9][0-9]{0,23})$/u.test(result.durationNanoseconds))return false;
 const age=BigInt(now)*1000000n-instant(result.checkedAt);
 return instant(request.departureTime)>=BigInt(now)*1000000n&&instant(result.departureTime)===instant(request.departureTime)&&age>=0n&&age<=BigInt(routeFreshnessMilliseconds)*1000000n;
}
/** Both trips are private intermediate evidence. This function grants no
 * authority, persists no candidate, and cannot waive a hard interval conflict. */
export async function evaluateTravel(raw:TravelInput,provider:RoutesProvider,options:{now?:number;cached?:CachedLeg[];allowances?:VerifiedTravelAllowance[]}={}):Promise<TravelEvaluation>{
 const input=travelInput.parse(raw),now=options.now??Date.now();
 const legs=await Promise.all((['inbound','outbound'] as const).map(async direction=>{
  const contextFingerprint=travelLegFingerprint(input,direction);
  const base={direction,contextFingerprint};
  if(input.meetingMode==='online')return {...base,status:'not_required' as const};
  if(!input.location)return {...base,status:'clarification' as const,reason:'location' as const};
  let adjacent=direction==='inbound'?input.previous:input.next;
  const allowance=options.allowances?.map(a=>verifiedTravelAllowance.parse(a)).find(a=>a.direction===direction&&a.contextFingerprint===contextFingerprint);
  if(allowance){
   if(adjacent.kind==='unknown')adjacent={kind:'commitment',id:'manual-boundary',interval:{start:allowance.boundary.at,end:allowance.boundary.at},location:allowance.boundary.location};
   else if(adjacent.kind==='commitment'){
    const boundary=direction==='inbound'?adjacent.interval.end:adjacent.interval.start;
    const pastOrigin=direction==='inbound'&&instant(boundary)+BigInt(input.bufferMinutes)*minute<BigInt(now)*1000000n;
    if(pastOrigin){
     if(instant(allowance.boundary.at)<BigInt(now)*1000000n||instant(allowance.boundary.at)<instant(boundary))return {...base,status:'clarification' as const,reason:'departure_context' as const};
     adjacent={...adjacent,interval:{...adjacent.interval,end:allowance.boundary.at},location:allowance.boundary.location};
    }else{
     if(instant(boundary)!==instant(allowance.boundary.at)||adjacent.location&&JSON.stringify(adjacent.location)!==JSON.stringify(allowance.boundary.location))return {...base,status:'clarification' as const,reason:'stale_estimate' as const};
     adjacent={...adjacent,location:adjacent.location??allowance.boundary.location};
    }
   }
  }
  if(adjacent.kind==='unknown')return {...base,status:'clarification' as const,reason:'unknown_neighbor' as const};
  if(adjacent.kind==='none')return {...base,status:'not_required' as const};
  const start=direction==='inbound'?instant(adjacent.interval.end):instant(input.candidate.end),end=direction==='inbound'?instant(input.candidate.start):instant(adjacent.interval.start);
  if(start>end)return {...base,status:'conflict' as const,reason:'overlap' as const};
  if(!input.location||!adjacent.location)return {...base,status:'clarification' as const,reason:'location' as const};
  const selected=allowance?.mode??(input.mode==='PER_TRIP'?(direction==='inbound'?input.inboundMode:input.outboundMode):input.mode);
  if(!routeMode.safeParse(selected).success)return {...base,status:'clarification' as const,reason:'mode' as const};
  // General transition time precedes departure; extra travel margin follows.
  // A past departure remains unresolved instead of inventing a current location.
  const departure=start+BigInt(input.bufferMinutes)*minute;
  if(departure<BigInt(now)*1000000n)return {...base,status:'clarification' as const,reason:'departure_context' as const};
  const available=end-departure,margin=BigInt(input.travelBufferMinutes)*minute;
  if(available<margin)return {...base,status:'conflict' as const,reason:'insufficient_gap' as const,availableNanoseconds:available.toString(),requiredNanoseconds:margin.toString()};
  const request:RouteRequest={origin:direction==='inbound'?adjacent.location:input.location,destination:direction==='inbound'?input.location:adjacent.location,mode:routeMode.parse(selected),departureTime:Temporal.Instant.fromEpochNanoseconds(departure).toString()};
  if(allowance){
   const required=BigInt(allowance.durationMinutes)*minute+margin;
   return {...base,status:required<=available?'fits' as const:'conflict' as const,...(required>available?{reason:'insufficient_gap' as const}:{}),request,manualAllowanceId:allowance.id,availableNanoseconds:available.toString(),requiredNanoseconds:required.toString()};
  }
  let estimate=options.cached?.find(c=>c.contextFingerprint===contextFingerprint&&current(c.estimate,request,now))?.estimate;
  if(!estimate){try{estimate=await provider.estimate(request);}catch{estimate={status:'failure',reason:'unavailable',fingerprint:routeFingerprint(request),checkedAt:new Date(now).toISOString()};}}
  if(estimate.status!=='success')return {...base,status:'clarification' as const,reason:'estimate' as const,request,estimate};
  if(!current(estimate,request,options.now??Date.now()))return {...base,status:'clarification' as const,reason:'stale_estimate' as const,request};
  const required=BigInt(estimate.durationNanoseconds)+margin;
  return {...base,status:required<=available?'fits' as const:'conflict' as const,...(required>available?{reason:'insufficient_gap' as const}:{}),request,estimate,availableNanoseconds:available.toString(),requiredNanoseconds:required.toString()};
 }));
 return {status:legs.some(l=>l.status==='conflict')?'conflict':legs.some(l=>l.status==='clarification')?'clarification':'fits',legs};
}
