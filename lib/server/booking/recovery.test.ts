import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {BookingRecovery} from './recovery.ts';
import {Database} from '../database/client.ts';
const project='abcdefghijklmnopqrst',input={project,operator:'operator@example.test',requestId:randomUUID(),action:'reconcile',idempotencyKey:randomUUID()};
test('Recovery pins the explicit project and exposes only audited scheduling operations',async()=>{
 const env={SUPABASE_URL:`https://${project}.supabase.co`,SUPABASE_SECRET_KEY:'fixture-secret'};let calls=0;
 const database=new Database(env,async(url,init)=>{calls++;assert.equal(String(url),env.SUPABASE_URL+'/rest/v1/rpc/fmat_command');assert.deepEqual(JSON.parse(String(init?.body)),{p_operation:'booking_reconcile',p_actor:{kind:'operator',id:input.operator},p_input:{requestId:input.requestId,idempotencyKey:input.idempotencyKey}});return Response.json({ok:true});});
 const recovery=new BookingRecovery(database,env);
 assert.deepEqual(await recovery.run(input),{requestId:input.requestId,action:input.action,idempotencyKey:input.idempotencyKey,ok:true});
 for(const bad of [{...input,project:'local'},{...input,project:'zyxwvutsrqponmlkjihgf'},{...input,action:'confirm'},{...input,approved:true},{...input,operator:''}])await assert.rejects(recovery.run(bad));
 assert.equal(calls,1);
});
test('Recovery allows a loopback target only when explicitly named local',async()=>{
 const env={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'fixture-secret'};
 const recovery=new BookingRecovery(new Database(env,async()=>Response.json({ok:true,retired:true,attemptId:randomUUID(),nextAction:'review_proposal'})),env);
 await assert.rejects(recovery.run(input));const result=await recovery.run({...input,project:'local',action:'retry'});assert.equal(result.retired,true);assert.equal(result.nextAction,'review_proposal');assert.equal('booked' in result,false);
});
