import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleCalendarProvider} from './catalog.ts';
import {GoogleFreeBusy} from './freebusy.ts';
import {GoogleAdjacentEvents} from './adjacent.ts';
import {GoogleRoutes} from '../routes/google.ts';
import {calendarScopes} from './google.ts';
import {ApplicationError} from '../errors.ts';
const env={GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_MAPS_API_KEY:'fixture'};
const start='2030-01-02T09:00:00Z',end='2030-01-02T10:00:00Z',interval={start,end};
const bundle={accessToken:'old',refreshToken:'refresh',subject:'subject',expiresAt:1,scopes:[...calendarScopes.host]};
const route={origin:{placeId:'one'},destination:{placeId:'two'},mode:'DRIVE' as const,departureTime:start};
const adapters:{name:string;invoke:(fetcher:typeof fetch,signal:AbortSignal)=>Promise<unknown>}[]=[
 {name:'catalog',invoke:(f,s)=>new GoogleCalendarProvider(env,f).list('token',s)},
 {name:'refresh',invoke:(f,s)=>new GoogleCalendarProvider(env,f).refresh(bundle,'host',s)},
 {name:'freebusy',invoke:(f,s)=>new GoogleFreeBusy(f).read('token',['one'],[interval],s)},
 {name:'adjacent',invoke:(f,s)=>new GoogleAdjacentEvents(f).read('token',['one'],interval,async()=>{},s)},
 {name:'routes',invoke:(f,s)=>new GoogleRoutes(env,f,()=>Date.parse('2030-01-01T00:00:00Z')).estimate(route,s)},
];
async function incomplete(name:string,pending:Promise<unknown>){
 if(name==='routes'){const result=await pending as {status:string;reason:string};assert.equal(result.status,'failure');assert.equal(result.reason,'deadline');}
 else await assert.rejects(pending,(error:unknown)=>error instanceof ApplicationError&&error.code==='PROVIDER_UNAVAILABLE');
}
for(const adapter of adapters){
 test(adapter.name+' shared cancellation rejects before fetch and bounds non-cooperative headers',{timeout:3000},async()=>{
  let calls=0;const expired=new AbortController();expired.abort();
  await incomplete(adapter.name,adapter.invoke(async()=>{calls++;throw new Error('Unexpected');},expired.signal));assert.equal(calls,0);
  const active=new AbortController();let started!:()=>void,observed:AbortSignal|undefined;
  const ready=new Promise<void>(r=>{started=r;});
  const result=incomplete(adapter.name,adapter.invoke(async(_url,init)=>{calls++;observed=init?.signal??undefined;started();return new Promise<Response>(()=>{});},active.signal));
  await ready;active.abort();await result;assert.equal(observed?.aborted,true);assert.equal(calls,1);
  await incomplete(adapter.name,adapter.invoke(async()=>{calls++;throw new Error('Unexpected later call');},active.signal));assert.equal(calls,1);
 });
 test(adapter.name+' shared cancellation cancels a stalled response body',{timeout:3000},async()=>{
  const active=new AbortController();let started!:()=>void,cancelled=false;
  const ready=new Promise<void>(r=>{started=r;});
  const result=incomplete(adapter.name,adapter.invoke(async()=>new Response(new ReadableStream<Uint8Array>({pull(){started();},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}),active.signal));
  await ready;active.abort();await result;assert.equal(cancelled,true);
 });
}
test('Installed Google refresh transport preserves tokens and uses one request without SDK retry',async()=>{
 let calls=0;
 const provider=new GoogleCalendarProvider(env,async(url,init)=>{
  calls++;assert.equal(String(url),'https://oauth2.googleapis.com/token');assert.equal(init?.method,'POST');assert.ok(init?.signal);
  const form=new URLSearchParams(String(init?.body));assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('refresh_token'),'refresh');
  return Response.json({access_token:'new',expires_in:3600});
 });
 const result=await provider.refresh(bundle);assert.equal(result.accessToken,'new');assert.equal(result.refreshToken,'refresh');assert.deepEqual(result.scopes,bundle.scopes);assert.equal(calls,1);
 calls=0;await assert.rejects(new GoogleCalendarProvider(env,async()=>{calls++;return Response.json({error:'temporarily_unavailable'},{status:503});}).refresh(bundle));assert.equal(calls,1);
});
test('Cancellation at a page boundary prevents subsequent Calendar requests',async()=>{
 for(const kind of ['catalog','adjacent'] as const){
  const active=new AbortController();let calls=0;
  const fetcher:typeof fetch=async()=>{calls++;const body=kind==='catalog'?{items:[],nextPageToken:'next'}:{timeZone:'UTC',accessRole:'reader',items:[],nextPageToken:'next'};
   return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close();active.abort();}}));
  };
  await incomplete(kind,kind==='catalog'?new GoogleCalendarProvider(env,fetcher).list('token',active.signal):new GoogleAdjacentEvents(fetcher).read('token',['one'],interval,async()=>{},active.signal));assert.equal(calls,1);
 }
});
