import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {BookingWorker} from '../../lib/server/booking/worker.ts';
import {GoogleBookingProvider} from '../../lib/server/calendar/booking.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {SchedulingPublication} from '../../lib/server/scheduling/publication.ts';
import {CandidateRanking} from '../../lib/server/scheduling/ranking.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';

const literal=(value:unknown)=>"'"+String(value).replaceAll("'","''")+"'";
const json=(value:unknown)=>literal(JSON.stringify(value))+'::jsonb';
type Query=(target:string,sql:string)=>string;

/** Exercise application code on the restored SQL state. Only the RPC transport
 * is replaced: named arguments execute real service-role functions over psql.
 * This is not a PostgREST, Auth HTTP, or live Google acceptance test. */
export async function prepareBookingWorkerRestore(query:Query,origin:string){
 const env={SUPABASE_URL:'https://restore.invalid',SUPABASE_SECRET_KEY:'synthetic-restore-key',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const allowed=new Set(['fmat_scheduling','fmat_availability_evaluation','fmat_candidate_ranking','fmat_booking_approval','fmat_booking_evaluation','fmat_booking_dispatch','fmat_booking_worker']);
 const failures:string[]=[];
 const database=(target:string)=>new Database(env,async(url,init)=>{
  assert.equal(new URL(String(url)).origin,env.SUPABASE_URL);
  const name=new URL(String(url)).pathname.replace('/rest/v1/rpc/','');
  assert.ok(allowed.has(name));assert.equal(init?.method,'POST');
  const args=Object.entries(JSON.parse(String(init.body))).map(([key,value])=>{
   assert.match(key,/^p_(operation|credential|input|lease)$/u);
   return `${key} => ${key==='p_operation'?literal(value)+'::text':json(value)}`;
  });
  try{return Response.json(JSON.parse(query(target,`set role service_role; select public.${name}(${args.join(',')});`)));}
  catch(error){failures.push(name);throw error;}
 });
 const hostId=randomUUID(),sessionId=randomUUID(),inviteId=randomUUID(),requestId=randomUUID();
 const token=randomBytes(32).toString('base64url'),subject='restore-worker-'+hostId;
 const scopes=[...calendarScopes.host],cipher=new TokenCipher(env);
 const encrypted=cipher.seal({accessToken:'synthetic-worker-access',refreshToken:'synthetic-worker-refresh',subject,expiresAt:Date.now()+3600000,scopes},'google:host:'+hostId);
 const rules={timezone:'UTC',availability:[{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59'}],focusBlocks:[],bufferMinutes:0,durationMinutes:30,preferences:'',travelMode:'NONE',meetingMode:'online',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:0};
 const day=new Date(Date.now()+9*86400000).toISOString().slice(0,10);
 const details={requesterName:'Restore worker guest',requesterEmail:'worker-guest@example.test',purpose:'Restored worker reconciliation',durationMinutes:30,timezone:'UTC',windows:[{start:day+'T09:00:00Z',end:day+'T09:30:00Z'}],mode:'online',location:'https://meet.example.test/restore-worker'};
 query(origin,`begin;
  insert into auth.users(id,email,email_confirmed_at) values (${literal(hostId)},'worker-host@example.test',now());
  insert into auth.sessions(id,user_id) values (${literal(sessionId)},${literal(hostId)});
  insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values (${literal(inviteId)},'worker-host@example.test',${literal(createHash('sha256').update(inviteId).digest('hex'))},now()+interval '1 day','restore-worker');
  insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,rules_version,conflict_calendar_ids,booking_calendar_id)
   values (${literal(hostId)},'worker-host@example.test',${literal(inviteId)},'restore-worker','Restore worker',${json(rules)},1,array['worker-calendar'],'worker-calendar');
  insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential)
   values ('host',${literal(hostId)},${literal(subject)},array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],${literal(encrypted)});
  insert into fmat.requests(id,host_id,details,token_hash,expires_at,contact_verified_email)
   values (${literal(requestId)},${literal(hostId)},${json(details)},${literal(createHash('sha256').update(token).digest('hex'))},now()+interval '3 days','worker-guest@example.test');commit;`);
 const calendar={async refresh(){throw new Error('Unexpected refresh');},async list(){return [{id:'worker-calendar',name:'Restore calendar',accessRole:'owner' as const,primary:false,timeZone:'UTC',color:null}];}};
 let reads=0;
 const evaluation=(db:Database)=>new AvailabilityEvaluation(db,env,calendar,{async read(){reads++;return [];}},{async read(){return [];}});
 const db=database(origin),guest=guestCredential(requestId,token);
 const publication=new SchedulingPublication(db,evaluation(db),new CandidateRanking(db,{async rank(input,reserve){await reserve();return {orderedIds:input.candidates.map(candidate=>candidate.id)};}}));
 let state=await publication.evaluate(guest,{requestId,revision:1});
 state=await publication.select(guest,{requestId,revision:state.revision,publicationId:state.publication!.id,candidateId:state.publication!.candidates[0].id,confirmed:true,idempotencyKey:randomUUID()});
 state=await publication.agree(guest,{requestId,revision:state.revision,proposalVersion:state.proposal!.version,confirmed:true,idempotencyKey:randomUUID()});
 await db.rpc('fmat_booking_approval',{p_operation:'approve',p_credential:{kind:'host',subject:hostId,sessionId,expiresAt:new Date(Date.now()+3600000).toISOString()},p_input:{requestId,revision:state.revision,proposalVersion:state.proposal!.version,confirmed:true,idempotencyKey:randomUUID()}});
 let inserts=0,gets=0,visible=false;
 let event:Record<string,unknown>|undefined;
 const provider=new GoogleBookingProvider(async(url,init)=>{
  const parsed=new URL(String(url));assert.equal(parsed.origin,'https://www.googleapis.com');
  if(init?.method==='POST'){
   inserts++;assert.equal(parsed.pathname,'/calendar/v3/calendars/worker-calendar/events');
   assert.equal(parsed.searchParams.get('sendUpdates'),'all');
   event={...JSON.parse(String(init.body)),organizer:{email:'worker-calendar@example.test'},status:'confirmed',etag:'restored-event-etag'};
   throw new Error('Synthetic committed insert with lost response');
  }
  gets++;assert.ok(event);assert.equal(init?.method,'GET');
  assert.equal(parsed.pathname,`/calendar/v3/calendars/worker-calendar/events/${event.id}`);
  return visible?Response.json(event):Response.json({error:{code:404,errors:[{reason:'notFound'}]}},{status:404});
 });
 const worker=(target:string)=>{const selected=database(target);return new BookingWorker(selected,env,evaluation(selected),provider,calendar);};
 query(origin,`update fmat.jobs set available_at='2000-01-01' where kind='booking' and payload->>'requestId'=${literal(requestId)};`);
 const first=await worker(origin).run();
 assert.deepEqual(first,{claimed:1,outcome:'uncertain'},JSON.stringify({inserts,gets,reads,failures,phase:query(origin,`select phase from fmat.booking_attempts where request_id=${literal(requestId)};`)}));
 assert.equal(inserts,1);assert.equal(gets,0);assert.ok(reads>0);assert.deepEqual(failures,[]);
 // Restore a crashed reconciliation owner, not just a freshly queued job.
 query(origin,`update fmat.jobs set status='running',worker_id='retired-restore-worker',lease_token=${literal(randomUUID())},lease_until=now()-interval '1 second',available_at='2000-01-01' where kind='booking_reconcile' and payload->>'requestId'=${literal(requestId)};`);
 const identitySql=`select json_build_object('id',id,'eventId',event_id,'payload',payload,'fingerprint',payload_fingerprint,'calendarId',calendar_id,'approvalId',approval_id) from fmat.booking_attempts where request_id=${literal(requestId)};`;
 const identity=query(origin,identitySql),preRestoreReads=reads;
 return async(destination:string)=>{
  assert.equal(query(destination,identitySql),identity);
  const count=(table:string,where:string)=>query(destination,`select count(*) from fmat.${table} where ${where};`);
  const phase=()=>query(destination,`select phase from fmat.booking_attempts where request_id=${literal(requestId)};`);
  const reservation=()=>count('host_reservations',`attempt_id in(select id from fmat.booking_attempts where request_id=${literal(requestId)})`);
  const receipts=()=>count('outbox',`payload->>'requestId'=${literal(requestId)}`);
  const due=()=>query(destination,`update fmat.jobs set available_at='2000-01-01' where kind='booking_reconcile' and payload->>'requestId'=${literal(requestId)} and status='pending';`);
  assert.equal(phase(),'uncertain');assert.equal(reservation(),'1');assert.equal(receipts(),'0');
  due();assert.deepEqual(await worker(destination).run(),{claimed:1,outcome:'uncertain'});
  assert.equal(phase(),'uncertain');assert.equal(reservation(),'1');assert.equal(receipts(),'0');
  assert.equal(inserts,1);assert.equal(gets,1);assert.equal(reads,preRestoreReads);
  visible=true;due();assert.deepEqual(await worker(destination).run(),{claimed:1,outcome:'confirmed'});
  assert.equal(phase(),'confirmed');assert.equal(reservation(),'0');assert.equal(receipts(),'2');
  assert.equal(query(destination,`select status from fmat.requests where id=${literal(requestId)};`),'booked');
  assert.equal(query(destination,identitySql),identity);assert.equal(inserts,1);assert.equal(gets,2);
  assert.equal(reads,preRestoreReads);assert.deepEqual(failures,[]);
  // A duplicate recovered queue delivery completes without another provider call.
  query(destination,`select fmat.enqueue_job('booking','restored-worker-replay',payload,'2000-01-01') from fmat.jobs where kind='booking' and payload->>'requestId'=${literal(requestId)} limit 1;`);
  assert.deepEqual(await worker(destination).run(),{claimed:1,outcome:'complete'});
  assert.equal(receipts(),'2');assert.equal(inserts,1);assert.equal(gets,2);assert.deepEqual(failures,[]);
 };
}
