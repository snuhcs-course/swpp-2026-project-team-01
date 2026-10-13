import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

type Query=(target:string,sql:string)=>string;
const literal=(value:unknown)=>"'"+String(value).replaceAll("'","''")+"'";
const json=(value:unknown)=>literal(JSON.stringify(value))+'::jsonb';

// Runtime terminal evidence is synthetic. No managed runtime is contacted by
// these network-isolated databases; this verifies the durable recovery boundary.
export function prepareSuccessorRestore(query:Query,source:string,guests:{kind:string;requestId:string;tokenHash:string}[]){
 const fixtures=guests.map((guest,index)=>{
  const access=JSON.parse(query(source,`select public.fmat_conversation_access('open',${json(guest)},${json({audience:'request_shared',requestId:guest.requestId})});`));
  const {grantId,conversationId}=access;
  const call=(target:string,fn:string,operation:string,input:unknown)=>JSON.parse(query(target,
   `select public.${fn}(${literal(operation)},${literal(grantId)},${literal(conversationId)},${json(input)});`));
  const message=call(source,'fmat_runtime_message','accept',{clientId:randomUUID(),text:'Restore the original successor input'});
  const oldSession='wrun_restore_old_'+index,newSession='wrun_restore_new_'+index;
  call(source,'fmat_runtime_message','deliver',{messageId:message.id,sessionId:oldSession});
  const intent={expectedGeneration:0,idempotencyKey:randomUUID()};
  const receipt=call(source,'fmat_conversation_recovery','begin',{...intent,evidence:{generation:0,sessionId:oldSession,eventId:'terminal_restore',tailIndex:5,usage:{inputTokens:400,outputTokens:30,cacheReadTokens:20,cacheWriteTokens:10}}});
  const input={generation:1,messageId:message.id};
  const claim=call(source,'fmat_runtime_successor','claim',input);
  assert.equal(call(source,'fmat_runtime_successor','start',{...input,leaseToken:claim.leaseToken}).dispatch,true);
  const bind={...input,creationKey:claim.creationKey,sessionId:newSession};
  if(index===1)assert.equal(call(source,'fmat_runtime_successor','bind',bind).state,'bound');
  query(source,`update fmat.conversation_successors set lease_until=clock_timestamp()-interval '1 second' where conversation_id=${literal(conversationId)};
   insert into fmat.model_work_attempts(name,attempts) values(${literal('conversation:'+message.id)},3);`);
  const original=query(source,`select jsonb_build_object('message',(select to_jsonb(m) from fmat.runtime_messages m where id=${literal(message.id)}),'grant',(select to_jsonb(g) from fmat.conversation_grants g where id=${literal(grantId)}));`);
  return {call,grantId,conversationId,message,receipt,intent,input,claim,bind,original,index,newSession,oldSession};
 });
 return (target:string)=>{
  for(const f of fixtures){
   const {call,grantId,conversationId,message,receipt,intent,input,claim,bind,index,newSession,oldSession}=f;
   const status=call(target,'fmat_conversation_recovery','read',intent);
   assert.deepEqual(status.receipt,receipt,'lost recovery response retains its exact receipt after restore');
   assert.deepEqual(status.retiredUsage,{inputTokens:400,outputTokens:30});
   assert.equal(status.generation,1);
   const resumed=call(target,'fmat_runtime_successor','claim',input);
   assert.equal(resumed.state,index===0?'creating':'bound');
   assert.equal(resumed.creationKey,claim.creationKey,'restore must retain the one-time creation identity');
   assert.equal(call(target,'fmat_runtime_successor','start',{...input,leaseToken:claim.leaseToken}).dispatch,false,'expired restored lease cannot authorize a second runtime creation');
   assert.throws(()=>call(target,'fmat_runtime_successor','bind',{...bind,creationKey:randomUUID()}),/FORBIDDEN/u);
   const bound=call(target,'fmat_runtime_successor','bind',bind);
   assert.equal(bound.sessionId,newSession);
   assert.deepEqual(call(target,'fmat_runtime_successor','bind',bind),bound);
   assert.throws(()=>call(target,'fmat_runtime_successor','bind',{...bind,sessionId:oldSession}),/FORBIDDEN/u);
   assert.equal(query(target,`select jsonb_build_object('message',(select to_jsonb(m) from fmat.runtime_messages m where id=${literal(message.id)}),'grant',(select to_jsonb(g) from fmat.conversation_grants g where id=${literal(grantId)}));`),f.original,'recovery never rewrites the original input or authority');
   assert.equal(query(target,`select attempts from fmat.model_work_attempts where name=${literal('conversation:'+message.id)};`),'3');
   assert.throws(()=>call(target,'fmat_conversation_recovery','begin',{expectedGeneration:1,idempotencyKey:randomUUID(),evidence:{generation:1,sessionId:newSession,eventId:'second_terminal',tailIndex:5,usage:{inputTokens:99600,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0}}}),/MODEL_LIMIT/u,'restore cannot refund cumulative model usage');
   assert.equal(query(target,`select count(*) from fmat.conversation_recoveries where conversation_id=${literal(conversationId)};`),'1');
   query(target,`update fmat.conversation_grants set revoked_at=clock_timestamp() where id=${literal(grantId)};`);
   assert.throws(()=>call(target,'fmat_conversation_recovery','read',intent),/UNAUTHORIZED/u);
   assert.throws(()=>call(target,'fmat_runtime_successor','bind',bind),/UNAUTHORIZED/u);
  }
 };
}
