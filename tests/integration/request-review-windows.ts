import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Database} from '../../lib/server/database/client.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import type {RequestReview} from '../../lib/server/identity/request-review.ts';
import {LocalSql} from './local-sql.ts';

export async function verifyReviewWindowLocks(database:Database,sql:LocalSql,service:RequestReview,credential:Credential,request:string,grant:{grantId:string;conversationId:string}){
 const propose=(input:unknown)=>database.rpc('fmat_conversation_tool',{p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_operation:'details_propose',p_input:input});
 const input=(revision:number,start:number)=>({expectedRevision:revision,patch:{durationMinutes:30,windows:[{start:new Date(start).toISOString(),end:new Date(start+1800000).toISOString()}]},clarifications:[],idempotencyKey:randomUUID()});
 async function expiredWhileBlocked(start:number,operation:()=>Promise<unknown>){
  const lock=new LocalSql();let pending:Promise<void>|undefined;
  try{
   const pid=await lock.query(`begin;select id from fmat.requests where id='${request}' for update;select pg_backend_pid();`),blocker=Number(pid.split('\n').at(-1));assert.ok(Number.isInteger(blocker));
   pending=assert.rejects(operation(),{code:'INVALID_INPUT'});
   let observed=false;
   for(let n=0;n<100;n++){observed=await sql.query(`select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and ${blocker}=any(pg_blocking_pids(pid)));`)==='t';if(observed)break;await delay(20);}
   assert.ok(observed,'RPC must actually wait on the held request lock');
   await delay(Math.max(0,start-Date.now()+100));await lock.query('commit;');await pending;
  }finally{await lock.query('rollback;').catch(()=>{});lock.close();await pending;}
 }
 const original=await service.read(credential),start=Date.now()+2500;
 await expiredWhileBlocked(start,()=>propose(input(original.revision,start)));
 assert.deepEqual(await service.read(credential),original,'Expired blocked proposal preserves existing review and details');
 const applyStart=Date.now()+2500,proposal=input(original.revision,applyStart);
 await propose(proposal);const pending=await service.read(credential);
 const decision={reviewId:pending.review!.id,expectedRevision:pending.revision,confirmed:true as const,idempotencyKey:randomUUID()};
 await expiredWhileBlocked(applyStart,()=>service.decide('apply',credential,decision));
 assert.deepEqual(await service.read(credential),pending,'Expired blocked apply cannot consume decision or mutate review');
 const replay=await propose(proposal) as {review:{id:string}};assert.equal(replay.review.id,pending.review!.id,'Exact proposal replay remains available after expiry');
 await service.decide('dismiss',credential,decision);await service.decide('dismiss',credential,decision);
 const freshStart=Date.now()+2500;
 await propose(input(original.revision,freshStart));const fresh=await service.read(credential);
 const approved={reviewId:fresh.review!.id,expectedRevision:fresh.revision,confirmed:true as const,idempotencyKey:randomUUID()};
 const applied=await service.decide('apply',credential,approved);
 await delay(Math.max(0,freshStart-Date.now()+100));
 assert.deepEqual(await service.decide('apply',credential,approved),applied,'Committed apply replay survives real elapsed time without another mutation');
}
