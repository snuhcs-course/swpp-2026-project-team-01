import {createHash} from 'node:crypto';
import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
import {routeRequest,routeMode,travelInstant,type RouteRequest,type RouteLocation,type RouteResult} from '../../contracts/travel.ts';
const ns=(value:string)=>Temporal.Instant.from(value).epochNanoseconds;
const second=1000000000n,day=86400n*second;
const duration=z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,9})?s$/u);
function durationNs(value:string){const [seconds,fraction='']=duration.parse(value).slice(0,-1).split('.');return BigInt(seconds)*second+BigInt(fraction.padEnd(9,'0'));}
const stopTimes=z.object({departureTime:travelInstant,arrivalTime:travelInstant});
const step=z.object({travelMode:z.enum(['WALK','TRANSIT']),staticDuration:duration,transitDetails:z.object({stopDetails:stopTimes}).optional()});
const geocode=z.object({geocoderStatus:z.object({code:z.number().int().optional()}).optional(),partialMatch:z.boolean().optional(),placeId:z.string().min(1),type:z.array(z.string())});
const responseSchema=z.strictObject({routes:z.array(z.object({duration,distanceMeters:z.number().int().nonnegative().optional(),legs:z.array(z.object({steps:z.array(step).min(1).max(1000)})).max(1).optional()})).max(1).optional(),fallbackInfo:z.unknown().optional(),geocodingResults:z.object({origin:geocode.optional(),destination:geocode.optional()}).optional()});
const preciseTypes=new Set(['street_address','premise','subpremise','establishment','point_of_interest','intersection','airport','transit_station','train_station']);
function waypoint(value:RouteLocation){return 'latitude' in value?{location:{latLng:{latitude:value.latitude,longitude:value.longitude}}}:value;}
export function routeFingerprint(raw:RouteRequest){
 const input=routeRequest.parse(raw);
 return createHash('sha256').update(JSON.stringify({version:1,origin:waypoint(input.origin),destination:waypoint(input.destination),mode:input.mode,departureTime:Temporal.Instant.from(input.departureTime).toString()})).digest('hex');
}
export interface RoutesProvider {estimate(input:RouteRequest):Promise<RouteResult>;}
export class GoogleRoutes implements RoutesProvider {
 constructor(private readonly env=process.env,private readonly fetcher:typeof fetch=fetch,private readonly now:()=>number=Date.now,private readonly timeoutMs=10000){}
 async estimate(raw:RouteRequest):Promise<RouteResult>{
  const checkedAt=new Date(this.now()).toISOString();
  if(raw&&typeof raw==='object'&&'mode' in raw&&!routeMode.safeParse(raw.mode).success)return {status:'unsupported',reason:'mode',fingerprint:null,checkedAt};
  const parsed=routeRequest.safeParse(raw);if(!parsed.success)return {status:'failure',reason:'invalid_input',fingerprint:null,checkedAt};
  const input=parsed.data,fingerprint=routeFingerprint(input),base={fingerprint,checkedAt},departure=ns(input.departureTime),now=ns(checkedAt);
  if(departure<now||(input.mode==='TRANSIT'&&departure>now+100n*day))return {status:'unsupported',reason:'departure_context',...base};
  const key=this.env.GOOGLE_MAPS_API_KEY?.trim();if(!key)return {status:'failure',reason:'configuration',...base};
  const transit=input.mode==='TRANSIT';
  const fields=['routes.duration','routes.distanceMeters','fallbackInfo','geocodingResults',...(transit?['routes.legs.steps.travelMode','routes.legs.steps.staticDuration','routes.legs.steps.transitDetails.stopDetails.departureTime','routes.legs.steps.transitDetails.stopDetails.arrivalTime']:[])].join(',');
  try{
   const response=await this.fetcher('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':fields},body:JSON.stringify({origin:waypoint(input.origin),destination:waypoint(input.destination),travelMode:input.mode,departureTime:Temporal.Instant.from(input.departureTime).toString(),computeAlternativeRoutes:false,...(input.mode==='DRIVE'?{routingPreference:'TRAFFIC_AWARE'}:{})}),signal:AbortSignal.timeout(Math.max(1,Math.min(15000,this.timeoutMs))),cache:'no-store',redirect:'error'});
   if(response.status===501)return {status:'unsupported',reason:'mode',...base};
   if(!response.ok)return {status:'failure',reason:response.status===401||response.status===403?'denied':response.status===429?'rate_limit':'unavailable',...base};
   const reader=response.body?.getReader();if(!reader)return {status:'failure',reason:'malformed',...base};
   let size=0;const chunks:Uint8Array[]=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024){await reader.cancel();return {status:'failure',reason:'malformed',...base};}chunks.push(value);}}finally{reader.releaseLock();}
   const parsedResponse=responseSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));if(!parsedResponse.success)return {status:'failure',reason:'malformed',...base};
   const body=parsedResponse.data;
   if(body.fallbackInfo!==undefined)return {status:'unsupported',reason:'provider_fallback',...base};
   if(!body.routes?.length)return {status:'no_route',...base};
   for(const which of ['origin','destination'] as const){
    if(!('address' in input[which]))continue;const resolved=body.geocodingResults?.[which];
    if(!resolved||resolved.partialMatch||(resolved.geocoderStatus?.code??0)!==0||!resolved.type.some(type=>preciseTypes.has(type)))return {status:'unsupported',reason:'location',...base};
   }
   const route=body.routes[0];let elapsed=durationNs(route.duration);
   if(transit){
    const steps=route.legs?.[0]?.steps;if(!steps)return {status:'failure',reason:'malformed',...base};
    // Walk from the requested departure, wait for each actual transit departure,
    // then include the final walk. A short route.duration must not erase waiting.
    let cursor=departure;
    for(const item of steps){
     if(item.travelMode==='WALK'){if(item.transitDetails)return {status:'failure',reason:'malformed',...base};cursor+=durationNs(item.staticDuration);}
     else {const times=item.transitDetails?.stopDetails;if(!times||ns(times.departureTime)<cursor||ns(times.arrivalTime)<ns(times.departureTime))return {status:'failure',reason:'malformed',...base};cursor=ns(times.arrivalTime);}
    }
    if(cursor-departure>elapsed)elapsed=cursor-departure;
   }
   return {status:'success',...base,departureTime:Temporal.Instant.from(input.departureTime).toString(),durationNanoseconds:elapsed.toString(),distanceMeters:route.distanceMeters??null};
  }catch(error){return {status:'failure',reason:error instanceof SyntaxError?'malformed':error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'deadline':'unavailable',...base};}
 }
}
