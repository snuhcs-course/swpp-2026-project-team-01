import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleRoutes,routeFingerprint} from './google.ts';
import type {RouteRequest} from '../../contracts/travel.ts';
const now=Date.parse('2030-01-01T00:00:00Z'),env={GOOGLE_MAPS_API_KEY:'private-fixture-key'},clock=()=>now;
const request:RouteRequest={origin:{latitude:37.56,longitude:126.98},destination:{placeId:'place-fixture'},mode:'DRIVE',departureTime:'2030-01-02T09:00:00+09:00'};
const provider=(body:unknown)=>new GoogleRoutes(env,async()=>Response.json(body),clock);
test('Routes uses exact mode/instant, private header, field mask, deadline and conservative fractional duration',async()=>{
 const instance=new GoogleRoutes(env,async(url,init)=>{assert.equal(url,'https://routes.googleapis.com/directions/v2:computeRoutes');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.ok(init?.signal);const headers=new Headers(init?.headers);assert.equal(headers.get('X-Goog-Api-Key'),env.GOOGLE_MAPS_API_KEY);assert.ok(!headers.get('X-Goog-FieldMask')?.includes('*'));const body=JSON.parse(init!.body as string);assert.equal(body.travelMode,'DRIVE');assert.equal(body.departureTime,'2030-01-02T00:00:00Z');assert.equal(body.routingPreference,'TRAFFIC_AWARE');assert.equal(body.computeAlternativeRoutes,false);assert.deepEqual(body.origin,{location:{latLng:{latitude:37.56,longitude:126.98}}});return Response.json({routes:[{duration:'123.000000001s',distanceMeters:900,description:'private ignored provider text'}]});},clock);
 const result=await instance.estimate(request);assert.equal(result.status,'success');if(result.status==='success')assert.equal(result.durationNanoseconds,'123000000001');assert.ok(!JSON.stringify(result).includes('private'));assert.equal(result.fingerprint,routeFingerprint({...request,departureTime:'2030-01-02T00:00:00Z'}));
 for(const mode of ['WALK','BICYCLE','TRANSIT'] as const){let body:Record<string,unknown>={};const p=new GoogleRoutes(env,async(_url,init)=>{body=JSON.parse(init!.body as string);return Response.json({routes:[]});},clock);await p.estimate({...request,mode});assert.equal(body.travelMode,mode);assert.ok(!('routingPreference' in body));}
});
test('Routes separates empty, unsupported, denied, throttled and malformed results without provider text',async()=>{
 for(const body of [{},{routes:[]}])assert.equal((await provider(body).estimate(request)).status,'no_route');
 for(const body of [{routes:[{}]},{routes:[{duration:'-1s'}]},{routes:[{duration:'1.0000000001s'}]},{error:{message:'private'}}])assert.equal((await provider(body).estimate(request)).status,'failure');
 assert.equal((await provider({routes:[{duration:'10s'}],fallbackInfo:{reason:'private'}}).estimate(request)).status,'unsupported');
 for(const [status,reason] of [[401,'denied'],[403,'denied'],[429,'rate_limit'],[503,'unavailable']] as const){const result=await new GoogleRoutes(env,async()=>new Response('private provider error',{status}),clock).estimate(request);assert.equal(result.status,'failure');if(result.status==='failure')assert.equal(result.reason,reason);assert.ok(!JSON.stringify(result).includes('private'));}
 assert.equal((await new GoogleRoutes(env,async()=>new Response('',{status:501}),clock).estimate(request)).status,'unsupported');
});
test('Unsupported mode, past departure, transit horizon and configuration stop before network calls',async()=>{
 let calls=0;const p=new GoogleRoutes(env,async()=>{calls++;throw new Error();},clock);
 for(const mode of ['PER_TRIP','NONE','FLY'])assert.equal((await p.estimate({...request,mode} as unknown as RouteRequest)).status,'unsupported');
 assert.equal((await p.estimate({...request,departureTime:'2029-12-31T23:59:59Z'})).status,'unsupported');
 assert.equal((await p.estimate({...request,mode:'TRANSIT',departureTime:'2030-05-01T00:00:00Z'})).status,'unsupported');
 assert.equal((await p.estimate({...request,origin:{latitude:91,longitude:0}})).status,'failure');assert.equal(calls,0);
 const missing=await new GoogleRoutes({},async()=>{throw new Error();},clock).estimate(request);assert.equal(missing.status,'failure');if(missing.status==='failure')assert.equal(missing.reason,'configuration');
});
test('Address routing requires a precise complete match and never accepts partial city-level locations',async()=>{
 const input={...request,origin:{address:'A specific venue'}},base={routes:[{duration:'123s'}]},resolved={placeId:'resolved',type:['premise'],geocoderStatus:{}};
 const good=await provider({...base,geocodingResults:{origin:resolved}}).estimate(input);assert.equal(good.status,'success');
 for(const origin of [undefined,{...resolved,partialMatch:true},{...resolved,type:['locality','political']},{...resolved,geocoderStatus:{code:5}}])assert.equal((await provider({...base,geocodingResults:{origin}}).estimate(input)).status,'unsupported');
});
test('Transit accounts for the initial wait, transfers and final walk; impossible transfers stay unresolved',async()=>{
 const input={...request,mode:'TRANSIT' as const,departureTime:'2030-01-02T10:00:00Z'};
 const steps=[{travelMode:'WALK',staticDuration:'300s'},{travelMode:'TRANSIT',staticDuration:'600s',transitDetails:{stopDetails:{departureTime:'2030-01-02T10:10:00Z',arrivalTime:'2030-01-02T10:20:00Z'}}},{travelMode:'WALK',staticDuration:'120s'},{travelMode:'TRANSIT',staticDuration:'600s',transitDetails:{stopDetails:{departureTime:'2030-01-02T10:25:00Z',arrivalTime:'2030-01-02T10:35:00Z'}}},{travelMode:'WALK',staticDuration:'300s'}];
 const result=await provider({routes:[{duration:'1920s',legs:[{steps}]}]}).estimate(input);assert.equal(result.status,'success');if(result.status==='success')assert.equal(result.durationNanoseconds,'2400000000000','Waiting plus both trips and final walking requires forty minutes');
 const impossible=structuredClone(steps);impossible[3].transitDetails!.stopDetails.departureTime='2030-01-02T10:21:00Z';assert.equal((await provider({routes:[{duration:'1900s',legs:[{steps:impossible}]}]}).estimate(input)).status,'failure');
 assert.equal((await provider({routes:[{duration:'10s'}]}).estimate(input)).status,'failure','Missing timing detail is not a zero wait');
});
test('Routes bounds payloads and aborts slow providers without automatic retries',async()=>{
 assert.equal((await new GoogleRoutes(env,async()=>new Response('x'.repeat(512*1024+1)),clock).estimate(request)).status,'failure');
 let calls=0;const p=new GoogleRoutes(env,async(_url,init)=>new Promise<Response>((_resolve,reject)=>{calls++;const keepAlive=setTimeout(()=>reject(new Error('Fixture exceeded timeout')),100);init!.signal!.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(init!.signal!.reason);},{once:true});}),clock,5);
 const result=await p.estimate(request);assert.equal(result.status,'failure');if(result.status==='failure')assert.equal(result.reason,'deadline');assert.equal(calls,1);
});
