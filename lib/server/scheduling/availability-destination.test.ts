import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AvailabilityEvaluation} from './availability.ts';
import {Database} from '../database/client.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {calendarScopes} from '../calendar/google.ts';
import {GoogleFreeBusy} from '../calendar/freebusy.ts';
import {routeFingerprint} from '../routes/google.ts';
import {ApplicationError} from '../errors.ts';

function fixture(options:{calendars?:string[];destination?:string|null;physical?:boolean;busy?:boolean;failure?:'busy'|'events'}={}){
 const hostId=randomUUID(),requestId=randomUUID(),checkId=randomUUID();
 const env={SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,21).toString('base64')};
 const candidate={start:'2030-01-02T10:00:00Z',end:'2030-01-02T10:30:00Z'},operations:string[]=[],busyReads:string[][]=[],eventReads:string[][]=[];
 const destination=options.destination===undefined?'booking':options.destination;
 const state={bookingCalendarId:destination,checkId,basis:'a'.repeat(64),travelBasis:'b'.repeat(64),revision:1,rulesVersion:1,preferenceDecisions:[],allowances:[],localBookings:[],localCommitments:[],mode:'manual',guest:null,
  host:{principalId:hostId,providerSubject:'host',calendarIds:options.calendars??['conflict'],encryptedCredential:new TokenCipher(env).seal({subject:'host',accessToken:'host-access',refreshToken:'refresh',expiresAt:Date.now()+3600000,scopes:[...calendarScopes.host]},'google:host:'+hostId)},
  details:{windows:[candidate],timezone:'UTC',durationMinutes:30,mode:options.physical?'in_person':'online',location:options.physical?'Meeting venue':'https://meet.example.test/room'},
  rules:{timezone:'UTC',durationMinutes:30,availability:[{days:[0,1,2,3,4,5,6],start:'08:00',end:'18:00'}],focusBlocks:[],bufferMinutes:0,travelMode:options.physical?'DRIVE':'NONE',preferences:'',meetingMode:options.physical?'in_person':'online',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:0},
 };
 const db=new Database(env,async(_url,init)=>{
  const {p_operation:op}=JSON.parse(String(init?.body));operations.push(op);
  return Response.json(op==='start'?state:op==='success'?{checked:true,revision:1,checkedAt:new Date().toISOString()}:op==='evidence_save'?{evaluationId:randomUUID(),requestId,revision:1,rulesVersion:1,status:'checks_passed',expiresAt:'2030-01-02T10:00:00Z',complete:false}:{});
 });
 // Use the real bounded free/busy adapter to catch the 50-calendar request limit.
 const busy=new GoogleFreeBusy(async(_url,init)=>{
  const body=JSON.parse(String(init?.body)),ids=body.items.map((item:{id:string})=>item.id);busyReads.push(ids);
  assert.ok(ids.length<=50);
  if(options.failure==='busy'&&ids.includes('booking'))throw new Error('Destination unavailable');
  return Response.json({timeMin:body.timeMin,timeMax:body.timeMax,calendars:Object.fromEntries(ids.map((id:string)=>[id,{busy:options.busy&&id==='booking'?[candidate]:[]}]))});
 });
 const evaluation=new AvailabilityEvaluation(db,env,{async refresh(bundle){return bundle;},async list(){return [{id:'booking',name:'Booking',accessRole:'owner',primary:false,timeZone:'UTC',color:null}];}},busy,
  {async read(_access,ids){
   eventReads.push(ids);
   if(options.failure==='events'&&ids.includes('booking'))throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
   return ids.includes('booking')?[
    {id:'prior',calendarId:'booking',eventId:'prior',version:'1',interval:{start:'2030-01-02T08:00:00Z',end:'2030-01-02T09:00:00Z'},location:{address:'Prior venue'}},
    {id:'next',calendarId:'booking',eventId:'next',version:'1',interval:{start:'2030-01-02T10:31:00Z',end:'2030-01-02T11:00:00Z'},location:{address:'Next venue'}},
   ]:[];
  }},
  {async estimate(request){return {status:'success',fingerprint:routeFingerprint(request),checkedAt:new Date().toISOString(),departureTime:request.departureTime,durationNanoseconds:'600000000000',distanceMeters:1000};}},
 );
 return {operations,busyReads,eventReads,run:()=>evaluation.readForBooking({workerId:'fixture',jobId:randomUUID(),leaseToken:randomUUID()},{requestId,revision:1,candidate})};
}
test('A separate booking destination contributes busy time before any travel reads',async()=>{
 const f=fixture({busy:true,physical:true}),result=await f.run();
 assert.equal(result.candidateEvaluation?.interval,'conflict');assert.equal(result.candidateEvaluation?.travel,null);
 assert.deepEqual(f.busyReads,[['conflict'],['booking']]);assert.deepEqual(f.eventReads,[]);
});
test('Destination-only neighboring events constrain both physical travel legs',async()=>{
 const f=fixture({physical:true}),result=await f.run();
 assert.deepEqual(f.eventReads,[['conflict'],['booking']]);
 assert.equal(result.candidateEvaluation?.travel?.status,'conflict');
 assert.deepEqual(result.candidateEvaluation?.travel?.legs.map(leg=>leg.status),['fits','conflict']);
});
test('Destination provider failures never persist successful evaluation or candidate evidence',async()=>{
 for(const failure of ['busy','events'] as const){const f=fixture({failure,physical:true});await assert.rejects(f.run(),{code:'PROVIDER_UNAVAILABLE'});assert.ok(f.operations.includes('failure'));assert.ok(!f.operations.includes('success'));assert.ok(!f.operations.includes('evidence_save'));}
});
test('Fifty selected calendars retain their limit while a distinct destination is checked once',async()=>{
 const calendars=Array.from({length:50},(_,i)=>'calendar-'+i),f=fixture({calendars,physical:true});await f.run();
 assert.deepEqual(f.busyReads,[calendars,['booking']]);assert.deepEqual(f.eventReads,[calendars,['booking']]);
 const included=fixture({calendars:['conflict','booking'],physical:true});await included.run();assert.deepEqual(included.busyReads,[['conflict','booking']]);assert.deepEqual(included.eventReads,[['conflict','booking']]);
 const ordinary=fixture({destination:null});await ordinary.run();assert.deepEqual(ordinary.busyReads,[['conflict']]);
});
