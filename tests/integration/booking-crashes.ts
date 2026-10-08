import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {LocalSql} from './local-sql.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';

export async function verifyBookingCrashes(env:NodeJS.ProcessEnv,createApproved:(group:'regular'|'cutoff'|'preinsert')=>Promise<string>){
 const sql=new LocalSql(),events=new Map<string,Record<string,unknown>>(),calls=new Map<string,{posts:number;gets:number}>();
 const server=createServer(async(req,res)=>{
  try{
   assert.equal(req.headers.authorization,'Bearer fixture-access');
   const url=new URL(req.url!,'http://127.0.0.1');assert.ok(url.pathname.startsWith('/calendar/v3/calendars/fixture-calendar/events'));
   let id:string;
   if(req.method==='POST'){
    assert.equal(url.searchParams.get('sendUpdates'),'all');let raw='';for await(const chunk of req)raw+=chunk;
    const payload=JSON.parse(raw);id=payload.id;const count=calls.get(id)??{posts:0,gets:0};count.posts++;calls.set(id,count);
    if(events.has(id)){res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:409,errors:[{reason:'duplicate'}]}}));return;}
    events.set(id,{...payload,organizer:{email:'crash-fixture@example.test'},status:'confirmed',etag:'crash-fixture-etag'});
   }else{assert.equal(req.method,'GET');id=decodeURIComponent(url.pathname.split('/').at(-1)!);const count=calls.get(id)??{posts:0,gets:0};count.gets++;calls.set(id,count);}
   res.writeHead(events.has(id)?200:404,{'content-type':'application/json'});res.end(JSON.stringify(events.get(id)??{error:{code:404,errors:[{reason:'notFound'}]}}));
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const port=address.port;
 async function run(point=''){
  const child=fork(new URL('./booking-crash-child.ts',import.meta.url),[],{execArgv:['--import','tsx'],env:{PATH:process.env.PATH,...env,FMAT_TEST_PROVIDER:`http://127.0.0.1:${port}`,FMAT_TEST_CRASH:point},stdio:['ignore','ignore','pipe','ipc']});
  let fault='',result:{claimed:number;outcome:string}|undefined;
  child.stderr?.resume();child.on('message',(message:unknown)=>{const value=message as {fault?:string;result?:typeof result};if(value.fault)fault=value.fault;if(value.result)result=value.result;});
  const ended=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
   const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Booking fixture child timed out'));},20000);
   child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal});});
  });
  if(point){assert.equal(fault,point);assert.equal(ended.signal,'SIGKILL');assert.equal(result,undefined);}
  else{assert.equal(ended.code,0);assert.equal(result?.claimed,1);}
  return result;
 }
 async function prioritize(jobId:string){await sql.query(`update fmat.jobs set available_at='1900-01-01' where id='${jobId}';`);}
 async function duplicate(jobId:string){const id=await sql.query(`select fmat.enqueue_job('booking','crash-duplicate-${randomUUID()}',payload) from fmat.jobs where id='${jobId}';`);await prioritize(id);return id;}
 try{
  const points=['before:claim','after:claim','after:load','before:evaluation_start','after:evaluation_start','before:evaluation_refresh','after:evaluation_refresh','after:evaluation_destination_checked','after:evaluation_success','after:evaluation_evidence_save','before:access','after:access','before:dispatch','before:lookup','after:lookup','after:insert','before:record','after:record','before:complete','after:complete','lost_wakeup','after:dispatch','before:insert'];
  for(const point of points){
   const unresolved=point==='after:dispatch'||point==='before:insert';
   const requestId=await createApproved(point==='after:dispatch'?'cutoff':point==='before:insert'?'preinsert':'regular');
   const saved=JSON.parse(await sql.query(`select json_build_object('jobId',j.id,'attemptId',a.id,'eventId',a.event_id,'payload',a.payload,'hostId',a.host_id,'connectionId',a.connection_id,'credential',c.encrypted_credential) from fmat.jobs j join fmat.booking_attempts a on a.id=(j.payload->>'attemptId')::uuid join fmat.calendar_connections c on c.id=a.connection_id where j.kind='booking' and a.request_id='${requestId}';`));
   let jobId=saved.jobId;await prioritize(jobId);
   if(point.includes('evaluation_refresh')){
    const cipher=new TokenCipher(env),context='google:host:'+saved.hostId,bundle=cipher.open(saved.credential,context) as Record<string,unknown>;
    const expired=cipher.seal({...bundle,expiresAt:Date.now()-1000},context);await sql.query(`update fmat.calendar_connections set encrypted_credential='${expired}' where id='${saved.connectionId}';`);
   }
   if(point.endsWith(':lookup')){await run('after:insert');await sql.query(`update fmat.jobs set lease_until=clock_timestamp()-interval '1 second' where id='${jobId}' and status='running';`);}
   if(point.endsWith(':complete')){assert.equal((await run())?.outcome,'confirmed');jobId=await duplicate(jobId);}
   if(point==='lost_wakeup'){
    await sql.query(`delete from pgmq.q_fmat_jobs where message->>'jobId'='${jobId}';`);
    assert.equal(await sql.query(`select count(*) from pgmq.q_fmat_jobs where message->>'jobId'='${jobId}';`),'0');
   }else await run(point);
   const phase=await sql.query(`select phase from fmat.booking_attempts where id='${saved.attemptId}';`);
   assert.equal(phase,point==='after:record'||point.endsWith(':complete')?'confirmed':unresolved||point.endsWith(':lookup')||point==='after:insert'||point==='before:record'?'dispatched':'prepared',point);
   if(phase==='confirmed')assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${requestId}';`),'2');
   else assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${requestId}';`),'0');
   const status=await sql.query(`select status from fmat.jobs where id='${jobId}';`);
   if(status==='complete')jobId=await duplicate(jobId);
   // Expire only the dead worker's lease, simulating elapsed recovery time.
   // No attempt, approval, reservation or provider result is patched.
   await sql.query(`update fmat.jobs set lease_until=clock_timestamp()-interval '1 second' where id='${jobId}' and status='running';`);
   assert.equal((await run())?.outcome,unresolved?'uncertain':phase==='confirmed'?'complete':'confirmed',point);
   const expected=unresolved?'uncertain':'confirmed';assert.equal(await sql.query(`select phase from fmat.booking_attempts where id='${saved.attemptId}';`),expected,point);
   assert.deepEqual(JSON.parse(await sql.query(`select payload::text from fmat.booking_attempts where id='${saved.attemptId}';`)),saved.payload);
   assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where request_id='${requestId}';`),'1');
   assert.equal(await sql.query(`select count(*) from fmat.host_reservations where attempt_id='${saved.attemptId}';`),unresolved?'1':'0');
   assert.equal(calls.get(saved.eventId)?.posts??0,unresolved?0:1,point);assert.equal(events.has(saved.eventId),!unresolved);
   if(unresolved||point.endsWith(':lookup')||point==='after:insert'||point==='before:record')assert.ok((calls.get(saved.eventId)?.gets??0)>=1,point);
   assert.equal(await sql.query(`select count(*) from fmat.outbox where payload->>'requestId'='${requestId}';`),unresolved?'0':'2');
  }
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));sql.close();}
}
