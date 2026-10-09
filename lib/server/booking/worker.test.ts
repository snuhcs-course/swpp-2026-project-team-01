import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {BookingWorker} from './worker.ts';
import {Database} from '../database/client.ts';
import {AvailabilityEvaluation} from '../scheduling/availability.ts';
import {GoogleBookingProvider} from '../calendar/booking.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {calendarScopes} from '../calendar/google.ts';

test('Booking worker rejects malformed leases and caller-supplied job context before I/O',async()=>{
 let calls=0;
 const database=new Database({SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic'},async()=>{calls++;throw new Error('Invalid lease reached persistence');});
 const worker=new BookingWorker(database),valid={workerId:'fixture',jobId:randomUUID(),leaseToken:randomUUID()};
 for(const input of [{},{...valid,workerId:''},{...valid,workerId:'x'.repeat(201)},{...valid,jobId:'job'},{...valid,leaseToken:'token'},{...valid,requestId:randomUUID()},{...valid,payload:{requestId:randomUUID(),workerId:'injected'}},{...valid,feasibility:{valid:true}}])await assert.rejects(worker.process(input));
 assert.equal(calls,0);
});

test('Booking reconciliation preserves the claimed lease and SQL fingerprint while stripping worker-only context',async()=>{
 const hostId=randomUUID(),requestId=randomUUID(),attemptId=randomUUID(),connectionId=randomUUID();
 const lease={workerId:'trusted-worker',jobId:randomUUID(),leaseToken:randomUUID()};
 const env={SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,23).toString('base64')};
 const encryptedCredential=new TokenCipher(env).seal({subject:'google-host',accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000,scopes:[...calendarScopes.host]},'google:host:'+hostId);
 const payload={id:'fmat123abc',summary:'Approved meeting',description:'Approved purpose',location:'https://meet.example.test/room',start:{dateTime:'2030-01-02T10:00:00Z',timeZone:'UTC'},end:{dateTime:'2030-01-02T10:30:00Z',timeZone:'UTC'},attendees:[{email:'guest@example.test'}],extendedProperties:{private:{fmatRequestId:requestId,fmatAttemptId:attemptId,fmatProposalVersion:'2'}}};
 const fingerprint='b'.repeat(64),operations:string[]=[],recorded:unknown[]=[];
 const database=new Database(env,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.deepEqual(body.p_lease,lease);operations.push(body.p_operation);
  if(body.p_operation==='load')return Response.json({requestId,attemptId,expectedRevision:7,proposalVersion:2,phase:'uncertain',calendarId:'saved-calendar',eventId:payload.id,connectionProviderSubject:'google-host',payloadFingerprint:fingerprint,payload,workerId:'injected',jobId:'wrong-job',privateNotes:'private-context',feasibility:{valid:true}});
  if(body.p_operation==='access')return Response.json({hostId,connectionId,providerSubject:'google-host',encryptedCredential});
  assert.equal(body.p_operation,'record');recorded.push(body.p_input);return Response.json({recorded:true});
 });
 let lookups=0;
 const provider=new GoogleBookingProvider(async(url,init)=>{
  lookups++;assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(new URL(String(url)).pathname,'/calendar/v3/calendars/saved-calendar/events/fmat123abc');
  return Response.json({...payload,status:'confirmed',etag:'fixture',organizer:{email:'organizer@example.test'}});
 });
 const evaluation=new AvailabilityEvaluation(database,env);evaluation.readForBooking=async()=>{throw new Error('Recovery must not revalidate or authorize replacement creation');};
 assert.equal(await new BookingWorker(database,env,evaluation,provider).process(lease),'confirmed');
 assert.equal(lookups,1);assert.deepEqual(operations,['load','access','access','record']);
 assert.deepEqual(recorded,[{outcome:'confirmed',evidence:{calendarId:'saved-calendar',eventId:payload.id,payloadFingerprint:fingerprint,eventUrl:null,etag:'fixture',organizer:{email:'organizer@example.test'}}}]);
});

test('Revoked booking credentials stop inserts and lookups without clearing dispatched uncertainty',async()=>{
 const requestId=randomUUID(),attemptId=randomUUID(),lease={workerId:'fixture',jobId:randomUUID(),leaseToken:randomUUID()};
 for(const phase of ['prepared','dispatched','uncertain','conflict'] as const){
  let providerCalls=0,evaluations=0;
  const operations:{operation:string;input:unknown}[]=[];
  const state={requestId,attemptId,expectedRevision:7,proposalVersion:2,phase,calendarId:'selected-calendar',eventId:'fmat123abc',connectionProviderSubject:'fixture-google',payloadFingerprint:'a'.repeat(64),payload:{
   id:'fmat123abc',summary:'Approved meeting',description:'Approved purpose',location:'Office',
   start:{dateTime:'2030-01-01T09:00:00Z',timeZone:'UTC'},end:{dateTime:'2030-01-01T09:30:00Z',timeZone:'UTC'},
   attendees:[{email:'guest@example.test'}],extendedProperties:{private:{fmatRequestId:requestId,fmatAttemptId:attemptId,fmatProposalVersion:'2'}},
  }};
  const database=new Database({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'synthetic'},async(url,init)=>{
   assert.ok(String(url).endsWith('/fmat_booking_worker'),'revocation must prevent dispatch');
   const body=JSON.parse(String(init?.body));assert.deepEqual(body.p_lease,lease);
   operations.push({operation:body.p_operation,input:body.p_input});
   if(body.p_operation==='load')return Response.json(state);
   if(body.p_operation==='access')return Response.json({message:'RECONNECT_REQUIRED'},{status:400});
   assert.ok(['record','retry'].includes(body.p_operation));return Response.json({ok:true});
  });
  const evaluation=new AvailabilityEvaluation(database);
  evaluation.readForBooking=async()=>{evaluations++;return {
   receipt:{checked:true,revision:7,checkedAt:'2030-01-01T08:00:00Z',complete:false},
   evaluation:{status:'ready',windows:[],durationMinutes:30,requesterTimezone:'UTC'},candidateEvaluation:null,
   persisted:{status:'checks_passed',evaluationId:randomUUID(),requestId,revision:7,rulesVersion:3,expiresAt:'2030-01-01T08:05:00Z',complete:false},
   context:{requestId,revision:7,checkId:randomUUID(),basis:'a'.repeat(64)},rulesVersion:3,results:[],truncated:false,
  };};
  const transport=new GoogleBookingProvider(async()=>{providerCalls++;throw new Error('Revoked credential reached Google');});
  const worker=new BookingWorker(database,{},evaluation,transport);
  assert.equal(await worker.process(lease),phase==='prepared'?'blocked':'retry');
  assert.equal(providerCalls,0);assert.equal(evaluations,phase==='prepared'?1:0);
  assert.deepEqual(operations.map(v=>v.operation),['load','access','load',phase==='prepared'?'record':'retry']);
  assert.deepEqual(operations.at(-1)?.input,phase==='prepared'?{outcome:'blocked',reason:'authority_unavailable'}:{errorCode:'RECONNECT_REQUIRED'});
 }
});
